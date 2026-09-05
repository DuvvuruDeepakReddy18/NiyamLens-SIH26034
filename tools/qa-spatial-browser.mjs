import { readFile, mkdir, open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { recognizeThroughUi, localPilotOrigin } from './run-browser-field-pilot.mjs'
import { verifyCriticalSourceImages } from './score-critical-fields.mjs'
import { validateCriticalFieldManifest, scoreCriticalFields } from '../src/lib/criticalFieldBenchmark.mjs'
import { parsePaddleOutput } from '../src/lib/paddleOcr.mjs'
import { associateSpatialOcrRows } from '../src/lib/spatialOcr.mjs'
import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from '../src/lib/ocrReadingOrder.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4191/')
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes))
if (manifest.datasetId !== 'niyamlens-critical-fields-v1' || manifest.samples.length !== 8 || manifest.isHoldout !== false) throw new Error('Only the fixed eight-photo development corpus is permitted.')
const sourceVerification = await verifyCriticalSourceImages(manifest, root)
const html = await (await fetch(`${origin}/`)).text()
const source = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/)?.[1]
if (!source || new URL(source, origin).origin !== origin) throw new Error('Local app module not found.')
const appModule = { url: new URL(source, origin).href }
const appBytes = Buffer.from(await (await fetch(appModule.url)).arrayBuffer())
Object.assign(appModule, { sha256: sha256(appBytes), bytes: appBytes.length })
const startedAt = new Date().toISOString()
const directory = resolve(root, 'reports/readiness-2026-09-05')
await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `spatial-browser-${startedAt.replace(/[:.]/g, '-')}.json`)
const file = await open(outputPath, 'wx')
const report = { schemaVersion: 1, kind: 'actual-browser-development-paddle-geometry', startedAt, finishedAt: null, datasetId: manifest.datasetId, isHoldout: false, humanReviewed: false, manifestSha256: sha256(manifestBytes), sourceVerification, execution: { origin, appModule, status: 'running', plannedPhotos: 8, source: 'Original whole-image UI upload; passive capture of the actual Paddle predict worker response; no mocked recognition, crop, rotation, review or edited text.' }, sourceFiles: Object.fromEntries(await Promise.all(['src/lib/spatialOcr.mjs', 'src/lib/ocrReadingOrder.mjs', 'src/lib/paddleOcr.mjs'].map(async path => [path, sha256(await readFile(resolve(root, path)))]))), rows: [], rawScoring: null, limitations: ['Previously used eight-photo development corpus with AI-provisional labels; not independent accuracy or a legal verdict.', 'Spatial derivations are system proposals, not raw OCR, and are kept outside the raw-only score.', 'Cold-browser-context elapsed time includes UI startup and model initialization; not mobile latency.'] }
const checkpoint = async () => {
  report.rawScoring = scoreCriticalFields(manifest, report.rows.map(({ sampleId, sourcePath, sourceSha256, rawText, error }) => ({ sampleId, sourcePath, sourceSha256, rawText, error, mode: 'browser-paddle', transcriptKind: 'raw-ocr-unedited', manuallyEdited: false })))
  await file.truncate(0); await file.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await file.sync()
}
let browser
try {
  await checkpoint()
  browser = await launchTestBrowser()
  for (const sample of manifest.samples) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
    const blockedRequests = []; const pageErrors = []
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort() })
    // Observe the same message delivered to the application's SDK. The
    // listener does not replace messages, change worker inputs or invoke OCR.
    await context.addInitScript(() => {
      const OriginalWorker = window.Worker
      window.__spatialDiagnostic = []
      window.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(url, options)
          const requests = new Map()
          const originalPost = this.postMessage.bind(this)
          this.postMessage = (message, ...rest) => { if (message?.kind === 'worker-transport-request') requests.set(message.requestId, message.type); return originalPost(message, ...rest) }
          this.addEventListener('message', event => {
            if (event.data?.kind === 'worker-transport-response' && requests.get(event.data.requestId) === 'predict') window.__spatialDiagnostic.push(structuredClone(event.data))
          })
        }
      }
    })
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.message.slice(0, 2000)))
    const before = performance.now()
    const row = { sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, rawText: '', error: null, elapsedMs: null, originalOutput: null, lines: [], baseline: null, pageErrors, blockedRequests }
    try {
      if (sha256(await readFile(resolve(root, sample.sourcePath))) !== sample.sha256) throw new Error('SOURCE_BYTES_CHANGED')
      const observed = await recognizeThroughUi(page, resolve(root, sample.sourcePath), 'browser-paddle', `${origin}/`)
      row.rawText = observed.rawText; row.qualityCaution = observed.qualityCaution
      const messages = await page.evaluate(() => window.__spatialDiagnostic)
      if (messages.length !== 1 || messages[0].status !== 'success' || messages[0].payload?.length !== 1) throw new Error('Expected exactly one successful unmodified Paddle page output.')
      row.originalOutput = messages[0].payload[0]
      const parsed = parsePaddleOutput(row.originalOutput, sample.id, row.originalOutput.image)
      if (parsed.text !== row.rawText) throw new Error('Worker geometry transcript differs from visible raw UI output.')
      row.lines = parsed.lines
      const sameRow = associateSpatialOcrRows(row.lines)
      const readingOrder = reconstructOcrReadingOrder(row.lines)
      const reviewed = reviewableDeclarationProposals(readingOrder)
      row.baseline = { sameRow, readingOrder, reviewed, rawFields: extractDeclarations(row.rawText).byId, sameRowFields: extractDeclarations(sameRow.transcript).byId, readingOrderFields: extractDeclarations(readingOrder.transcript).byId }
      if (pageErrors.length) row.error = 'BROWSER_PAGE_ERROR'
    } catch (error) { row.error = String(error.message || error).slice(0, 2000) }
    finally { row.elapsedMs = Math.round(performance.now() - before); await context.close() }
    report.rows.push(row); await checkpoint()
    console.log(JSON.stringify({ photo: report.rows.length, planned: 8, sampleId: row.sampleId, elapsedMs: row.elapsedMs, error: row.error, lines: row.lines.length, sameRow: row.baseline?.sameRow.associations.length, reviewable: row.baseline?.reviewed.proposals.length }))
  }
  report.execution.appModuleUnchanged = sha256(Buffer.from(await (await fetch(appModule.url)).arrayBuffer())) === appModule.sha256
  report.finishedAt = new Date().toISOString(); report.execution.status = 'complete'; await checkpoint()
  console.log(JSON.stringify({ outputPath, completePhotos: report.rows.length, errors: report.rows.filter(row => row.error).length, appModuleUnchanged: report.execution.appModuleUnchanged }))
} finally { await browser?.close(); await file.close() }
