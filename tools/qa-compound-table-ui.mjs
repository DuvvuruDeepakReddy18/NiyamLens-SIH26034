import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { localPilotOrigin, recognizeThroughUi } from './run-browser-field-pilot.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = localPilotOrigin('http://127.0.0.1:4195/')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = JSON.parse(manifestBytes)
const sample = manifest.samples.find(sample => sample.id === 'CF-003')
assert.equal(manifest.datasetId, 'niyamlens-critical-fields-v1'); assert.equal(manifest.isHoldout, false)
assert.equal(sample.sourcePath, 'datasets/openfoodfacts-india/real-labels/8906014888868/5.jpg')
const photoPath = resolve(root, sample.sourcePath)
assert.equal(hash(await readFile(photoPath)), sample.sha256)
async function sourceFiles(directory = 'src') {
  return (await Promise.all((await readdir(resolve(root, directory), { withFileTypes: true })).map(entry => entry.isDirectory() ? sourceFiles(`${directory}/${entry.name}`) : /\.(?:m?js|jsx|css)$/.test(entry.name) ? [`${directory}/${entry.name}`] : []))).flat().sort()
}
const sourcePaths = [...await sourceFiles(), 'tools/qa-compound-table-ui.mjs', 'tools/run-browser-field-pilot.mjs', 'tools/browser-runtime.mjs']
const modelPaths = ['public/ocr/paddle-v1/worker.js', 'public/ocr/paddle-v1/models/PP-OCRv6_small_det_onnx_infer.tar', 'public/ocr/paddle-v1/models/PP-OCRv6_small_rec_onnx_infer.tar', 'public/ocr/paddle-v1/runtime/ort-wasm-simd-threaded.jsep.wasm', 'node_modules/@paddleocr/paddleocr-js/dist/index.mjs']
const hashes = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(resolve(root, path)))])))
const startedAt = new Date().toISOString(); const stamp = startedAt.replace(/[:.]/g, '-')
const directory = resolve(root, 'reports/root-cause-2026-09-06'); await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `compound-table-ui-${stamp}.json`); const file = await open(outputPath, 'wx')
const report = { kind: 'actual-Chrome-compound-table-diagnostic-NOT-ACCURACY', startedAt, finishedAt: null, source: { sampleId: sample.id, path: sample.sourcePath, sha256: sample.sha256, manifestSha256: hash(manifestBytes) }, sourceHashes: await hashes(sourcePaths), modelHashes: await hashes(modelPaths), checks: [], viewports: [], screenshots: [], errors: [], blockedRequests: [], isHoldout: false, humanReviewed: false, typedCorrections: false, fieldConfirmations: false, rawOutputs: [] }
const checkpoint = async () => { await file.truncate(0); await file.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await file.sync() }
const readDraft = page => page.evaluate(async () => new Promise((resolve, reject) => {
  const request = indexedDB.open('niyamlens-evidence-v1', 2)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => { const db = request.result; const tx = db.transaction('drafts', 'readonly'); const get = tx.objectStore('drafts').get('active'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close() }
}))
let browser
try {
  await checkpoint(); browser = await launchTestBrowser(); report.browserVersion = browser.version()
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => {
    const url = new URL(route.request().url()); if (url.origin === origin) return route.continue()
    report.blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort()
  })
  await context.addInitScript(() => {
    const OriginalWorker = window.Worker
    window.__compoundProbe = { frames: [], outputs: [], error: null }
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options)
        const requests = new Set(); const originalPost = this.postMessage.bind(this)
        this.addEventListener('message', event => {
          if (event.data?.kind === 'worker-transport-response' && requests.has(event.data.requestId)) {
            if (event.data.status !== 'success') window.__compoundProbe.error = 'Paddle worker returned an error.'
            else window.__compoundProbe.outputs.push(structuredClone(event.data.payload))
          }
        })
        this.postMessage = (message, ...rest) => {
          if (message?.kind === 'worker-transport-request' && message.type === 'predict') {
            requests.add(message.requestId)
            try {
              for (const source of message.payload.sources) {
                if (source.kind !== 'imageBitmap' || !(source.imageBitmap instanceof ImageBitmap)) throw new Error('Unknown Paddle input transport.')
                const bitmap = source.imageBitmap; const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext('2d')
                context.drawImage(bitmap, 0, 0)
                const bytes = context.getImageData(0, 0, bitmap.width, bitmap.height).data
                const frame = { width: bitmap.width, height: bitmap.height, rgbaSha256: null }; window.__compoundProbe.frames.push(frame)
                crypto.subtle.digest('SHA-256', bytes).then(buffer => { frame.rgbaSha256 = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
              }
            } catch (error) { window.__compoundProbe.error = error.message }
          }
          // Forward original messages unchanged; observations never supply answers.
          return originalPost(message, ...rest)
        }
      }
    }
  })
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message.slice(0, 1800)))
  const recognized = await recognizeThroughUi(page, photoPath, 'browser-paddle', `${origin}/`)
  report.qualityCaution = recognized.qualityCaution
  const digest = await page.locator('.hash-readout').innerText()
  const diagnostic = page.getByRole('region', { name: 'Compound declaration diagnostic', exact: true })
  await diagnostic.waitFor()
  assert.match(await diagnostic.innerText(), /Unverified MRP candidate: 90\.00/)
  assert.match(await diagnostic.innerText(), /USP remains unresolved/)
  assert.match(await diagnostic.innerText(), /RS 0\.18\/9/)
  assert.equal(await diagnostic.locator('ol li').count(), 3)
  assert.equal(await diagnostic.locator('button,input,select,textarea,form,[contenteditable=true]').count(), 0)
  assert.match(await diagnostic.innerText(), /not automatic extraction/)
  report.diagnosticText = await diagnostic.innerText()
  assert.equal(await page.locator('.evidence-editor').inputValue(), '')
  const firstObserved = await page.evaluate(() => window.__compoundProbe)
  assert.equal(firstObserved.error, null); assert.equal(firstObserved.outputs.length, 1); assert.equal(firstObserved.frames.length, 1)
  assert.equal(firstObserved.outputs[0][0].items.map(line => line.text).join('\n'), recognized.rawText)
  report.rawOutputs.push(firstObserved.outputs[0][0]); report.actualInput = firstObserved.frames[0]
  assert.match(report.actualInput.rgbaSha256, /^[a-f0-9]{64}$/)
  report.displayedFrames = await diagnostic.locator('svg image').evaluateAll(async elements => Promise.all(elements.map(async element => {
    const url = element.getAttribute('href')
    if (!/^data:image\/png;base64,/.test(url)) throw new Error('Nonlocal or non-PNG diagnostic image.')
    const blob = new Blob([Uint8Array.from(atob(url.split(',')[1]), character => character.charCodeAt(0))], { type: 'image/png' })
    const bitmap = await createImageBitmap(blob); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    const rgbaSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, bitmap.width, bitmap.height).data))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const result = { width: bitmap.width, height: bitmap.height, rgbaSha256 }; bitmap.close(); return result
  })))
  assert.equal(report.displayedFrames.length, 3)
  for (const frame of report.displayedFrames) assert.deepEqual(frame, report.actualInput)
  report.checks.push('real worker output unchanged; all three diagnostic PNGs decode to the actual worker input pixels', 'compound90.00 remains only a diagnostic; USP /9 stays invalid; all three supporting pairs visible; no mutation controls')
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile390', 390, 844], ['mobile320', 320, 760]]) {
    await page.setViewportSize({ width, height }); await diagnostic.scrollIntoViewIfNeeded()
    assert.ok(await diagnostic.locator('svg').first().isVisible())
    const layout = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }))
    report.viewports.push({ name, ...layout })
    assert.ok(layout.documentWidth <= layout.viewport + 1, `${name} must not overflow horizontally.`)
    const path = resolve(directory, `compound-table-${stamp}-${name}.png`); await diagnostic.screenshot({ path }); report.screenshots.push({ name, path })
    assert.equal(await page.locator('.evidence-editor').inputValue(), '')
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: 'Dismiss preview', exact: true }).click()
  assert.equal(await page.locator('.evidence-editor').inputValue(), '')
  assert.equal(await page.locator('.hash-readout').innerText(), digest)
  const dismissed = await readDraft(page)
  assert.equal(dismissed?.rawOcrText || '', ''); assert.equal(dismissed?.evidenceItems[0]?.ocrPasses?.length || 0, 0)
  report.checks.push('preview inspection and dismissal did not edit text or append a raw pass')
  await page.getByRole('button', { name: 'Try Paddle OCR · local', exact: true }).click()
  await page.getByRole('region', { name: 'Paddle OCR preview', exact: true }).waitFor({ timeout: 180000 })
  const secondObserved = await page.evaluate(() => window.__compoundProbe)
  assert.equal(secondObserved.error, null); assert.equal(secondObserved.outputs.length, 2)
  const secondRaw = secondObserved.outputs[1][0].items.map(line => line.text).join('\n')
  report.rawOutputs.push(secondObserved.outputs[1][0])
  assert.equal(secondRaw, recognized.rawText)
  assert.equal(await page.locator('.paddle-proposals input:checked').count(), 0)
  await page.getByRole('button', { name: 'Append raw Paddle OCR', exact: true }).click()
  await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
  const expectedRaw = `\n\n[PADDLE RAW OCR · PANEL 1]\n${secondRaw}`
  assert.equal(await page.locator('.evidence-editor').inputValue(), expectedRaw)
  assert.equal(await page.locator('.transcript-original').textContent(), expectedRaw)
  const parsed = extractDeclarations(expectedRaw).byId.mrp
  assert.equal(parsed.candidates.some(candidate => candidate.valid), false, 'Diagnostic must not silently resolve the parser field.')
  report.parserMrpAfterRawAppend = parsed
  let draft
  for (let attempt = 0; attempt < 30; attempt++) { draft = await readDraft(page); if (draft?.rawOcrText === expectedRaw) break; await page.waitForTimeout(200) }
  assert.equal(draft.rawOcrText, expectedRaw); assert.equal(draft.evidenceItems[0].ocrPasses.length, 1)
  assert.equal(draft.evidenceItems[0].ocrPasses[0].text, secondRaw)
  assert.equal(draft.evidenceItems[0].sha256, sample.sha256)
  assert.equal(hash(Buffer.from(draft.evidenceItems[0].originalUrl.split(',')[1], 'base64')), sample.sha256)
  assert.ok(Object.values(draft.meta.fieldReviews || {}).every(review => review.state !== 'confirmed'))
  for (const key of ['allPanelsCaptured', 'classificationConfirmed', 'rule3ApplicabilityConfirmed', 'pdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed']) assert.notEqual(draft.meta[key], true)
  report.checks.push('second actual run appends raw only; no diagnostic candidate or layout checkbox silently enters working text', 'saved original image/hash and raw pass match; MRP parser remains unresolved; no officer confirmations')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.blockedRequests, [])
} catch (error) { report.errors.push(String(error.message || error).slice(0, 2500)); process.exitCode = 1 }
finally {
  await browser?.close(); report.finishedAt = new Date().toISOString()
  report.sourceFilesUnchanged = JSON.stringify(await hashes(sourcePaths)) === JSON.stringify(report.sourceHashes)
  report.modelsUnchanged = JSON.stringify(await hashes(modelPaths)) === JSON.stringify(report.modelHashes)
  report.originalImageUnchanged = hash(await readFile(photoPath)) === sample.sha256
  report.passed = !report.errors.length && !report.blockedRequests.length && report.sourceFilesUnchanged && report.modelsUnchanged && report.originalImageUnchanged
  if (!report.passed) process.exitCode = 1
  await checkpoint(); await file.close()
  console.log(JSON.stringify({ outputPath, passed: report.passed, checks: report.checks, errors: report.errors, viewports: report.viewports, sourceFilesUnchanged: report.sourceFilesUnchanged, modelsUnchanged: report.modelsUnchanged }, null, 2))
}
