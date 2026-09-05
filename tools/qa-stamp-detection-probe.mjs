// This is a diagnostic harness, NOT the shipped app pipeline or a blind test.
import { readFile, mkdir, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = 'http://127.0.0.1:4195'
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if (!existsSync(chromePath)) throw new Error('This diagnostic requires the installed Google Chrome executable.')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = JSON.parse(manifestBytes)
if (manifest.datasetId !== 'niyamlens-critical-fields-v1' || manifest.isHoldout !== false || manifest.samples?.length !== 8 || manifest.samples.some((sample, index) => sample.id !== `CF-${String(index + 1).padStart(3, '0')}`)) throw new Error('Only the fixed eight development samples are allowed.')
// Deliberately strip all labels, names, expected values and field status before
// iteration. The browser receives only JPEG bytes and a global configuration.
const samples = manifest.samples.map(({ id, sourcePath, sha256 }) => ({ id, sourcePath, sha256 }))
const configs = ['baseline', 'lower']
const sourcePaths = ['tools/stamp-detection-entry.mjs', 'tools/qa-stamp-detection-probe.mjs', 'node_modules/@paddleocr/paddleocr-js/package.json', 'node_modules/@paddleocr/paddleocr-js/dist/index.mjs']
const modelPaths = ['public/ocr/paddle-v1/worker.js', 'public/ocr/paddle-v1/models/PP-OCRv6_small_det_onnx_infer.tar', 'public/ocr/paddle-v1/models/PP-OCRv6_small_rec_onnx_infer.tar', 'public/ocr/paddle-v1/runtime/ort-wasm-simd-threaded.jsep.mjs', 'public/ocr/paddle-v1/runtime/ort-wasm-simd-threaded.jsep.wasm']
const hashPaths = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(resolve(root, path)))])))
const sourceHashes = await hashPaths(sourcePaths)
const modelHashes = await hashPaths(modelPaths)
const sourceImages = await Promise.all(samples.map(async sample => {
  const bytes = await readFile(resolve(root, sample.sourcePath))
  if (hash(bytes) !== sample.sha256) throw new Error(`Source bytes changed: ${sample.id}`)
  return { ...sample, bytes }
}))
const startedAt = new Date().toISOString()
const outputDirectory = resolve(root, 'reports/readiness-2026-09-05')
await mkdir(outputDirectory, { recursive: true })
const outputPath = resolve(outputDirectory, `stamp-detection-probe-${startedAt.replace(/[:.]/g, '-')}.json`)
const handle = await open(outputPath, 'wx')
const report = {
  kind: 'actual-Chrome-development-detector-threshold-isolation', startedAt, finishedAt: null,
  model: 'PP-OCRv6_small@paddleocr-js-0.4.2', browserExecutable: chromePath, browserVersion: null,
  datasetId: manifest.datasetId, manifestSha256: hash(manifestBytes), isHoldout: false, humanReviewed: false,
  sourceHashes, modelHashes, planned: 16, rows: [], errors: [],
  limitations: [
    'Eight previously used development photos only; not blind, representative, independently labelled, or field validation.',
    'Each original is tested under both fixed global configurations; no reference-specific tuning, crop, text repair, or field confirmation.',
    'Preserves the complete raw SDK output; imports no app parser or field association code, so concurrent parser fixes cannot change detector observations.',
    'Lower detector thresholds are an experiment, not a shipped recommendation. More boxes can introduce false positives.',
    'Actual local Chrome model execution through an isolated harness, not an app UI or deployment test.',
  ],
}
const checkpoint = async () => { await handle.truncate(0); await handle.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await handle.sync() }
let browser
try {
  await checkpoint()
  browser = await chromium.launch({ headless: true, executablePath: chromePath })
  report.browserVersion = browser.version()
  for (const configId of configs) for (const sample of sourceImages) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const blockedRequests = []; const pageErrors = []; const assetRequests = new Set()
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin !== origin) { blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort() }
      if (url.pathname === '/__stamp-detection-probe__') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Local detector isolation</title></head><body>Fixed development diagnostic</body></html>' })
      if (url.pathname.startsWith('/ocr/')) assetRequests.add(url.pathname)
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 1200)))
    const row = { configId, sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, error: null, elapsedMs: null, rawText: '', originalOutput: null, blockedRequests, pageErrors, assetRequests: [] }
    const start = performance.now()
    try {
      await page.goto(`${origin}/__stamp-detection-probe__`, { waitUntil: 'load' })
      const observation = await page.evaluate(async ({ dataUrl, configId }) => {
        const { probeStampDetection } = await import('/tools/stamp-detection-entry.mjs')
        return probeStampDetection({ dataUrl, configId })
      }, { dataUrl: `data:image/jpeg;base64,${sample.bytes.toString('base64')}`, configId })
      Object.assign(row, observation)
      if (blockedRequests.length || pageErrors.length) row.error = 'BROWSER_OR_NETWORK_SCOPE_ERROR'
    } catch (error) { row.error = String(error.message || error).slice(0, 1800) }
    finally { row.elapsedMs = Math.round(performance.now() - start); row.assetRequests = [...assetRequests]; await context.close() }
    report.rows.push(row); await checkpoint()
    console.log(JSON.stringify({ sampleId: sample.id, configId, completed: report.rows.length, planned: report.planned, elapsedMs: row.elapsedMs, lines: row.originalOutput?.items?.length ?? null, error: row.error }))
  }
} catch (error) { report.errors.push(String(error.message || error).slice(0, 1800)) }
finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  report.sourceFilesUnchanged = JSON.stringify(await hashPaths(sourcePaths)) === JSON.stringify(sourceHashes)
  report.modelsUnchanged = JSON.stringify(await hashPaths(modelPaths)) === JSON.stringify(modelHashes)
  report.sourceImagesUnchanged = (await Promise.all(samples.map(async sample => hash(await readFile(resolve(root, sample.sourcePath))) === sample.sha256))).every(Boolean)
  report.inputPixelsMatchAcrossConfigurations = samples.every(sample => {
    const pair = report.rows.filter(row => row.sampleId === sample.id)
    return pair.length === 2 && pair.every(row => !row.error && row.input?.rgbaSha256) && pair[0].input.rgbaSha256 === pair[1].input.rgbaSha256
  })
  report.complete = report.rows.length === report.planned && !report.errors.length && !report.rows.some(row => row.error) && report.sourceFilesUnchanged && report.modelsUnchanged && report.sourceImagesUnchanged && report.inputPixelsMatchAcrossConfigurations
  await checkpoint(); await handle.close()
  console.log(JSON.stringify({ outputPath, complete: report.complete, completed: report.rows.length, failed: report.rows.filter(row => row.error).length, errors: report.errors, inputPixelsMatchAcrossConfigurations: report.inputPixelsMatchAcrossConfigurations }))
  if (!report.complete) process.exitCode = 1
}
