import { readFile, mkdir, open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { recognizeThroughUi, localPilotOrigin, BROWSER_PILOT_MODES } from './run-browser-field-pilot.mjs'
import { verifyCriticalSourceImages } from './score-critical-fields.mjs'
import { validateCriticalFieldManifest, scoreCriticalFields } from '../src/lib/criticalFieldBenchmark.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4191/')
const manifestPath = resolve(root, 'datasets/critical-fields.v1.json')
const manifestBytes = await readFile(manifestPath)
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes.toString('utf8')))
// Deliberately fixed development corpus. This diagnostic cannot consume the
// reserved field-pilot images or turn provisional annotations into a holdout.
if (manifest.datasetId !== 'niyamlens-critical-fields-v1' || manifest.samples.length !== 8 || manifest.isHoldout !== false) throw new Error('This runner requires the existing eight-photo development manifest.')
const sourceVerification = await verifyCriticalSourceImages(manifest, root)
const html = await (await fetch(`${origin}/`)).text()
const moduleSource = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/)?.[1]
if (!moduleSource || new URL(moduleSource, origin).origin !== origin) throw new Error('Unable to identify the local application module.')
const moduleUrl = new URL(moduleSource, origin).href
const moduleBytes = Buffer.from(await (await fetch(moduleUrl)).arrayBuffer())
const startedAt = new Date().toISOString()
const modes = ['browser-paddle', 'browser-standard']
const outputDirectory = resolve(root, 'reports/readiness-2026-09-05')
await mkdir(outputDirectory, { recursive: true })
const outputPath = resolve(outputDirectory, `critical-browser-${startedAt.replace(/[:.]/g, '-')}.json`)
const file = await open(outputPath, 'wx')
const report = {
  schemaVersion: 1, kind: 'actual-browser-development-critical-fields', startedAt, finishedAt: null,
  datasetId: manifest.datasetId, isHoldout: false, humanReviewed: false, annotationStatus: manifest.annotation.status,
  manifest: { sourcePath: 'datasets/critical-fields.v1.json', sha256: hash(manifestBytes) }, sourceVerification,
  execution: { runner: 'actual-headless-Chrome-UI', origin, appModule: { url: moduleUrl, sha256: hash(moduleBytes), bytes: moduleBytes.length }, plannedModes: modes.map(id => BROWSER_PILOT_MODES[id]), plannedRows: manifest.samples.length * modes.length, order: 'Paddle eight photos followed by standard eight; original manifest order within each mode', qualityPolicy: 'Proceed on every capture-quality warning; evaluation policy, not an officer attestation.', manuallyEdited: false, manualRoi: false, status: 'running' },
  rows: [], scoring: null,
  limitations: ['Previously used eight-photo development set purposefully selected across six product codes; not representative or independent.', 'Reference annotations are AI-provisional and require two humans to review them.', 'Whole-image standard and whole-image Paddle raw preview only; no correction, answer dictionary, manual crop, rotation or reading-order suggestion.', 'Full UI elapsed time includes a new browser context, page loading and model initialization for every photo.', 'No legal compliance, false-clearance, measurement, hosted cloud, mobile or field-effectiveness outcome is measured.'],
}
const checkpoint = async () => {
  report.scoring = scoreCriticalFields(manifest, report.rows)
  const text = `${JSON.stringify(report, null, 2)}\n`
  await file.truncate(0); await file.write(text, 0, 'utf8'); await file.sync()
}
let browser
try {
  await checkpoint()
  browser = await launchTestBrowser()
  for (const mode of modes) {
    for (const sample of manifest.samples) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
      const blockedRequests = []; const pageErrors = []; const consoleErrors = []
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin) return route.continue()
        blockedRequests.push(`${url.origin}${url.pathname}`.slice(0, 2000)); return route.abort()
      })
      const page = await context.newPage()
      page.on('pageerror', issue => pageErrors.push(issue.message.slice(0, 2000)))
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000)) })
      const rowStarted = new Date().toISOString(); const clockStart = performance.now()
      let rawText = ''; let error = null; let qualityCaution = null
      try {
        // Check the original bytes again immediately before each real file
        // picker operation; no new photograph variant is generated or selected.
        if (hash(await readFile(resolve(root, sample.sourcePath))) !== sample.sha256) throw new Error('SOURCE_BYTES_CHANGED')
        const observed = await recognizeThroughUi(page, resolve(root, sample.sourcePath), mode, `${origin}/`)
        rawText = observed.rawText; qualityCaution = observed.qualityCaution
        if (pageErrors.length) error = 'BROWSER_PAGE_ERROR'
      } catch (issue) { error = String(issue.message || issue).slice(0, 2000) }
      const elapsedMs = Math.round(performance.now() - clockStart)
      await context.close()
      report.rows.push({ sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, mode, rawText, error, startedAt: rowStarted, finishedAt: new Date().toISOString(), elapsedMs, manuallyEdited: false, transcriptKind: 'raw-ocr-unedited', metadata: { qualityCaution, fullImage: true, manualRoi: false, browserPageErrors: pageErrors, browserConsoleErrors: consoleErrors, blockedExternalRequests: blockedRequests } })
      await checkpoint()
      console.log(JSON.stringify({ row: report.rows.length, plannedRows: report.execution.plannedRows, sampleId: sample.id, mode, elapsedMs, rawCharacters: rawText.length, error, blockedExternalRequests: blockedRequests.length }))
    }
  }
  report.execution.status = 'complete'; report.finishedAt = new Date().toISOString(); await checkpoint()
  console.log(JSON.stringify({ outputPath, observedRows: report.rows.length, complete: true, provisionalDevelopmentOnly: true, scores: report.scoring.runs.map(({ mode, attemptedPhotos, failedPhotos, exactMatchCorrect, exactMatchSamples, perField }) => ({ mode, attemptedPhotos, failedPhotos, exactMatchCorrect, exactMatchSamples, perField })) }, null, 2))
} finally { await browser?.close(); await file.close() }
