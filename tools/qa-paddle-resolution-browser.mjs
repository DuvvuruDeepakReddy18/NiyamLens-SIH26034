import { readFile, mkdir, open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { verifyCriticalSourceImages } from './score-critical-fields.mjs'
import { validateCriticalFieldManifest, scoreCriticalFields, normalizeCriticalValue, CRITICAL_FIELDS } from '../src/lib/criticalFieldBenchmark.mjs'
import { collectPaddleLayoutProposals } from '../src/lib/paddleLayoutProposals.mjs'
import { buildPaddleWorkingAddition } from '../src/lib/paddleWorkingText.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = process.argv[2]
if (!['det960', 'det1536', 'det2000', 'quad960', 'ink960', 'ink90', 'focus960'].includes(profile)) throw new Error('Specify a fixed development profile: det960/det1536/det2000/quad960/ink960/ink90/focus960.')
const origin = 'http://127.0.0.1:4191'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes))
if (manifest.datasetId !== 'niyamlens-critical-fields-v1' || manifest.samples.length !== 8 || manifest.isHoldout !== false) throw new Error('Fixed eight development photos only.')
const sourceVerification = await verifyCriticalSourceImages(manifest, root)
const startedAt = new Date().toISOString(); const directory = resolve(root, 'reports/readiness-2026-09-05'); await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `paddle-resolution-${profile}-${startedAt.replace(/[:.]/g, '-')}.json`); const file = await open(outputPath, 'wx')
const sourcePaths = ['tools/qa-paddle-resolution-browser.mjs', 'tools/paddle-development-entry.mjs', 'src/lib/paddleOcr.mjs', 'src/lib/paddleWorkingText.mjs', 'src/lib/extraction.mjs', 'src/lib/labelParser.mjs', 'src/lib/paddleLayoutProposals.mjs', 'src/lib/ocrReadingOrder.mjs', 'src/lib/spatialOcr.mjs', 'src/lib/criticalFieldBenchmark.mjs', 'src/lib/ocrFocusGuidance.mjs', 'src/lib/focusOcr.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(resolve(root, path)))])))
const report = { kind: 'actual-Chrome-development-OCR-resolution-experiment', startedAt, finishedAt: null, profile, model: 'PP-OCRv6_small@paddleocr-js-0.4.2', sourceHashes, sourceVerification, manifestSha256: hash(manifestBytes), datasetId: manifest.datasetId, isHoldout: false, humanReviewed: false, rows: [], rawScoring: null, derivedPotential: null, limitations: ['Fixed 8 previously used development photos and AI-provisional references only; not independent accuracy.', 'Actual local Chrome model execution via a development harness, not an app UI or deployment claim.', 'No digit/unit/heading repair, reference-specific crop, product dictionary, or confidence-based selection.', 'Every fixed-profile observation remains raw and separately recorded. Derived source-once proposals are explicitly automated test policy, not human review.', 'For tiled runs all four original observations are concatenated in fixed order; contradictory OCR remains a conflict, never selected using reference answers.'] }
function derivedScore() {
  const perField = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { denominator: 0, exact: 0, wrongValid: 0, unresolved: 0 }]))
  for (const sample of manifest.samples) for (const field of CRITICAL_FIELDS) {
    if (!sample.fields[field].metricEligible) continue
    const stat = perField[field]; stat.denominator++
    const row = report.rows.find(row => row.sampleId === sample.id); const actual = row?.derived?.fields?.[field]
    const valid = !row?.error && actual?.candidates?.length === 1 && actual.candidates[0].valid && !actual.conflict
    if (valid && normalizeCriticalValue(field, actual.value) === normalizeCriticalValue(field, sample.fields[field].value)) stat.exact++
    else if (valid) stat.wrongValid++; else stat.unresolved++
  }
  return { label: 'automated-selection-derived-potential-NOT-RAW-ACCURACY', photos: report.rows.length, planned: 8, perField }
}
const checkpoint = async () => {
  report.rawScoring = scoreCriticalFields(manifest, report.rows.map(row => ({ sampleId: row.sampleId, sourcePath: row.sourcePath, sourceSha256: row.sourceSha256, mode: `browser-paddle-${profile}`, rawText: row.rawText, error: row.error, transcriptKind: 'raw-ocr-unedited', manuallyEdited: false })))
  report.derivedPotential = derivedScore()
  await file.truncate(0); await file.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await file.sync()
}
let browser
try {
  await checkpoint(); browser = await launchTestBrowser()
  for (const sample of manifest.samples) {
    const context = await browser.newContext({ serviceWorkers: 'block' }); const blockedRequests = []; const pageErrors = []
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort() })
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message.slice(0, 1000)))
    const row = { sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, error: null, rawText: '', observations: [], derived: null, elapsedMs: null, pageErrors, blockedRequests }; const before = performance.now()
    try {
      const bytes = await readFile(resolve(root, sample.sourcePath)); if (hash(bytes) !== sample.sha256) throw new Error('SOURCE_BYTES_CHANGED')
      await page.goto(origin, { waitUntil: 'networkidle' })
      const observed = await page.evaluate(async ({ dataUrl, sampleId, profile }) => { const { recognizeDevelopmentPixels } = await import('/tools/paddle-development-entry.mjs'); return recognizeDevelopmentPixels(dataUrl, sampleId, profile) }, { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, sampleId: sample.id, profile })
      Object.assign(row, observed)
      const derived = []
      for (const observation of observed.observations) {
        const reading = { id: sample.id, text: observation.text, lines: observation.lines, width: observation.originalOutput.image.width, height: observation.originalOutput.image.height, crop: observation.region }
        const collected = collectPaddleLayoutProposals([reading]); const proposals = collected.proposals
        const addition = buildPaddleWorkingAddition([reading], proposals)
        if (!addition.rawAddition.endsWith(observation.text)) throw new Error('RAW_TEXT_MUTATED')
        derived.push({ workingText: addition.workingAddition, proposals })
      }
      const workingText = derived.map(item => item.workingText).join('\n\n')
      row.derived = { workingText, observations: derived, fields: extractDeclarations(workingText).byId }
      if (pageErrors.length || blockedRequests.length) row.error = 'BROWSER_OR_NETWORK_SCOPE_ERROR'
    } catch (error) { row.error = String(error.message || error).slice(0, 1800) }
    finally { row.elapsedMs = Math.round(performance.now() - before); await context.close() }
    report.rows.push(row); await checkpoint(); console.log(JSON.stringify({ profile, sampleId: sample.id, completed: report.rows.length, planned: 8, elapsedMs: row.elapsedMs, error: row.error }))
  }
  report.finishedAt = new Date().toISOString(); report.sourceFilesUnchanged = (await Promise.all(sourcePaths.map(async path => hash(await readFile(resolve(root, path))) === sourceHashes[path]))).every(Boolean); await checkpoint()
  console.log(JSON.stringify({ outputPath, sourceFilesUnchanged: report.sourceFilesUnchanged, raw: report.rawScoring.runs.map(run => ({ attempted: run.attemptedPhotos, correct: run.exactMatchCorrect, denominator: run.exactMatchSamples })), derivedPotential: report.derivedPotential }))
} finally { await browser?.close(); await file.close() }
