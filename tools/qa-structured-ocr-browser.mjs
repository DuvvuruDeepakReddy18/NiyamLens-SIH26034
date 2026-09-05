// Actual primary-button OCR workflow. Source pixels and engine responses are
// observed read-only; no labels or desired answers enter the browser pipeline.
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchTestBrowser } from './browser-runtime.mjs'
import { localPilotOrigin } from './run-browser-field-pilot.mjs'
import { verifyCriticalSourceImages } from './score-critical-fields.mjs'
import { CRITICAL_FIELDS, validateCriticalFieldManifest, scoreCriticalFields, normalizeCriticalValue } from '../src/lib/criticalFieldBenchmark.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { verifyAuditChain } from '../src/lib/audit.mjs'
import { PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.argv.slice(2).some(value => value !== '--checkset') || process.argv.length > 3) throw new Error('Only optional --checkset is supported.')
const checkset = process.argv.includes('--checkset')
const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4195/')
const hash = value => createHash('sha256').update(value).digest('hex')
const manifestPath = checkset ? 'datasets/critical-fields.checkset.v1.json' : 'datasets/critical-fields.v1.json'
const manifestBytes = await readFile(resolve(root, manifestPath))
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes))
assert.equal(manifest.datasetId, checkset ? 'niyamlens-critical-fields-checkset-v1' : 'niyamlens-critical-fields-v1')
assert.equal(manifest.samples.length, checkset ? 6 : 8)
if (checkset) assert.ok(manifest.samples.every(sample => CRITICAL_FIELDS.every(field => !sample.fields[field].metricEligible)))
const sourceVerification = await verifyCriticalSourceImages(manifest, root)
async function listSourceFiles(directory = 'src') {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? listSourceFiles(`${directory}/${entry.name}`) : entry.isFile() ? [`${directory}/${entry.name}`] : []))
  return nested.flat().sort()
}
const sourcePaths = await listSourceFiles()
const fingerprintSources = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(resolve(root, path)))])))
const beforeSources = await fingerprintSources()
const html = await (await fetch(`${origin}/`)).text()
const entry = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/)?.[1]
if (!entry || new URL(entry, origin).origin !== origin) throw new Error('Local application module not found.')
const appModule = { url: new URL(entry, origin).href }
const appBytes = Buffer.from(await (await fetch(appModule.url)).arrayBuffer())
Object.assign(appModule, { bytes: appBytes.length, sha256: hash(appBytes) })
const startedAt = new Date().toISOString(); const stamp = startedAt.replace(/[:.]/g, '-')
const directory = resolve(root, 'reports/root-cause-2026-09-05')
await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `structured-ocr-browser-${checkset ? 'checkset-' : ''}${stamp}.json`)
const file = await open(outputPath, 'wx')
const report = { schemaVersion: 1, kind: 'actual-Chrome-primary-structured-candidates-NOT-RAW-OR-HUMAN-ACCURACY', startedAt, finishedAt: null,
  datasetId: manifest.datasetId, isHoldout: false, humanReviewed: false, positiveRecognitionEvaluationReady: !checkset,
  manifest: { path: manifestPath, sha256: hash(manifestBytes) }, sourceVerification,
  execution: { origin, appModule, beforeSources, afterSources: null, status: 'running', plannedPhotos: manifest.samples.length,
    model: PADDLE_MODEL, settings: { textDetLimitSideLen: 960, textDetLimitType: 'max', textDetMaxSideLimit: 2000, maximumInputSide: 2000, backend: 'wasm', numThreads: 1 },
    policy: 'Actual upload → Read label fields → source-mapped machine candidates → auto-saved draft. No suggestion checkboxes, field confirmations, typed corrections, crops, alternative passes or expected-answer lookup. Continue on every capture-quality caution solely as an evaluation policy.',
    manualSuggestionSelections: 0, typedCorrections: false, fieldConfirmations: false }, rows: [], rawScoring: null, structuredScoring: null,
  limitations: ['Known availability-selected development photographs with AI-provisional labels; not representative independent accuracy.',
    'Machine-derived candidates use literal OCR strings and geometry, and still require officer verification. They are not unchanged raw OCR.',
    'Zero-denominator checkset outcomes are not measurable positive recognition accuracy; candidates on excluded fields are listed for review, not automatically called false declarations.',
    'No legal verdict, physical measurement, new-user workflow timing, hosted permissions or cold-offline OCR is validated.'] }

function structuredScore() {
  const perField = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { readableDenominator: 0, exactCandidateMatches: 0, wrongValidCandidates: 0, unresolvedReadable: 0, missingOrFailedReadable: 0, excludedLabels: 0, excludedWithValidCandidates: 0 }]))
  for (const sample of manifest.samples) {
    const row = report.rows.find(row => row.sampleId === sample.id)
    for (const field of CRITICAL_FIELDS) {
      const label = sample.fields[field]; const actual = row?.workingFields?.[field]
      const valid = Boolean(actual && actual.candidates.length === 1 && actual.candidates[0].valid && !actual.conflict)
      if (label.metricEligible) {
        const metric = perField[field]; metric.readableDenominator += 1
        if (!row || row.error) metric.missingOrFailedReadable += 1
        else if (valid && normalizeCriticalValue(field, actual.value) === normalizeCriticalValue(field, label.value)) metric.exactCandidateMatches += 1
        else if (valid) metric.wrongValidCandidates += 1
        else metric.unresolvedReadable += 1
      } else { perField[field].excludedLabels += 1; if (!row?.error && valid) perField[field].excludedWithValidCandidates += 1 }
    }
  }
  const readableDenominator = Object.values(perField).reduce((sum, field) => sum + field.readableDenominator, 0)
  const exactCandidateMatches = Object.values(perField).reduce((sum, field) => sum + field.exactCandidateMatches, 0)
  return { kind: 'automatic-unconfirmed-structured-candidates-not-raw-accuracy', humanReviewed: false, completedPhotos: report.rows.filter(row => !row.error).length,
    attemptedPhotos: report.rows.length, plannedPhotos: manifest.samples.length, failedPhotos: report.rows.filter(row => row.error).length,
    exactCandidateMatches, readableDenominator, exactCandidateRate: readableDenominator && report.rows.length === manifest.samples.length && report.rows.every(row => !row.error) ? exactCandidateMatches / readableDenominator : null,
    positiveRecognitionAccuracy: null, positiveRecognitionAccuracyReason: checkset ? 'No readable positive reference fields; denominator zero.' : 'Provisional development candidate recovery, not independent recognition accuracy.', perField }
}
const checkpoint = async () => {
  report.rawScoring = scoreCriticalFields(manifest, report.rows.map(row => ({ sampleId: row.sampleId, sourcePath: row.sourcePath, sourceSha256: row.sourceSha256, rawText: row.rawText, error: row.error, mode: 'primary-Paddle-raw-engine-output', transcriptKind: 'raw-ocr-unedited', manuallyEdited: false })))
  report.structuredScoring = structuredScore()
  await file.truncate(0); await file.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await file.sync()
}
async function readDraft(page) {
  return page.evaluate(async () => {
    const draft = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('niyamlens-evidence-v1', 2)
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => {
        const db = opening.result; const tx = db.transaction('drafts', 'readonly'); const request = tx.objectStore('drafts').get('active')
        request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
      }
    })
    if (!draft) return null
    const digest = async dataUrl => {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0))
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    }
    return { text: draft.text, rawOcrText: draft.rawOcrText, meta: { fieldReviews: draft.meta.fieldReviews || {},
      confirmations: Object.fromEntries(['allPanelsCaptured', 'classificationConfirmed', 'rule3ApplicabilityConfirmed', 'pdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed'].map(key => [key, draft.meta[key]])),
      ocrSource: draft.meta.ocrSource, ocrConfidence: draft.meta.ocrConfidence }, auditChain: draft.auditChain,
      panels: await Promise.all(draft.evidenceItems.map(async item => ({ id: item.id, sha256: item.sha256, originalBytesSha256: await digest(item.originalUrl), ocrText: item.ocrText, rawPasses: item.ocrPasses || [], ocrWords: item.ocrWords || [] }))) }
  })
}
let browser
try {
  await checkpoint(); browser = await launchTestBrowser()
  for (const sample of manifest.samples) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
    const pageErrors = []; const blockedRequests = []
    await context.route('**/*', route => {
      const url = new URL(route.request().url()); if (url.origin === origin) return route.continue()
      blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort()
    })
    await context.addInitScript(() => {
      const OriginalWorker = window.Worker
      window.__structuredOcrObserved = { frames: [], outputs: [], error: null }
      window.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(url, options)
          const requests = new Set(); const originalPost = this.postMessage.bind(this)
          this.addEventListener('message', event => {
            if (event.data?.kind === 'worker-transport-response' && requests.has(event.data.requestId)) {
              if (event.data.status !== 'success') window.__structuredOcrObserved.error = 'Paddle worker returned an error.'
              else window.__structuredOcrObserved.outputs.push(structuredClone(event.data.payload))
            }
          })
          this.postMessage = (message, ...rest) => {
            if (message?.kind === 'worker-transport-request' && message.type === 'predict') {
              requests.add(message.requestId)
              try {
                for (const source of message.payload.sources) {
                  if (source.kind !== 'imageBitmap' || !(source.imageBitmap instanceof ImageBitmap)) throw new Error('Unknown actual Paddle input transport.')
                  const bitmap = source.imageBitmap; const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const context = canvas.getContext('2d')
                  context.drawImage(bitmap, 0, 0)
                  const bytes = context.getImageData(0, 0, bitmap.width, bitmap.height).data
                  const frame = { width: bitmap.width, height: bitmap.height, rgbaSha256: null }; window.__structuredOcrObserved.frames.push(frame)
                  crypto.subtle.digest('SHA-256', bytes).then(buffer => { frame.rgbaSha256 = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
                }
              } catch (error) { window.__structuredOcrObserved.error = error.message }
            }
            return originalPost(message, ...rest)
          }
        }
      }
    })
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message.slice(0, 2000)))
    const before = performance.now()
    const row = { sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, rawText: '', workingText: '', error: null, verification: null, pageErrors, blockedRequests }
    try {
      assert.equal(hash(await readFile(resolve(root, sample.sourcePath))), sample.sha256)
      await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
      await page.getByText('Local workspace', { exact: true }).waitFor()
      await page.locator('input[type="file"]').setInputFiles(resolve(root, sample.sourcePath))
      await page.getByText(/panel ready for OCR/i).waitFor({ timeout: 30000 })
      const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
      row.qualityCaution = await caution.count() > 0
      if (row.qualityCaution) await caution.click()
      const digestBefore = await page.locator('.hash-readout').innerText()
      assert.equal(await page.locator('.evidence-editor').inputValue(), '')
      await page.getByRole('button', { name: 'Read label fields', exact: true }).click()
      await page.getByText(/Label fields ready/).waitFor({ timeout: 180000 })
      row.workingText = await page.locator('.evidence-editor').inputValue()
      const observed = await page.evaluate(() => window.__structuredOcrObserved)
      assert.equal(observed.error, null); assert.equal(observed.outputs.length, 1); assert.equal(observed.frames.length, 1)
      assert.match(observed.frames[0].rgbaSha256, /^[a-f0-9]{64}$/)
      assert.ok(Array.isArray(observed.outputs[0]) && observed.outputs[0].length === 1, 'One actual engine result is required.')
      const enginePage = observed.outputs[0][0]
      assert.ok(Array.isArray(enginePage.items))
      row.rawText = enginePage.items.map(line => line.text).join('\n')
      row.rawSha256 = hash(row.rawText); row.actualPaddleInput = observed.frames[0]
      row.rawEngineOutput = enginePage
      const expectedRaw = `\n\n[PADDLE RAW OCR · PANEL 1]\n${row.rawText}`
      let draft = null
      for (let attempt = 0; attempt < 30; attempt++) {
        draft = await readDraft(page)
        if (draft?.text === row.workingText && draft?.rawOcrText === expectedRaw) break
        await page.waitForTimeout(200)
      }
      assert.equal(draft?.text, row.workingText); assert.equal(draft?.rawOcrText, expectedRaw)
      assert.equal(await page.locator('.transcript-original').textContent(), expectedRaw)
      assert.equal(await page.locator('.hash-readout').innerText(), digestBefore)
      assert.equal(draft.panels.length, 1)
      const panel = draft.panels[0]
      assert.equal(panel.sha256, sample.sha256); assert.equal(panel.originalBytesSha256, sample.sha256)
      assert.equal(panel.ocrText, row.rawText); assert.equal(panel.rawPasses.length, 1)
      assert.equal(panel.rawPasses[0].text, row.rawText); assert.equal(panel.rawPasses[0].model, PADDLE_MODEL)
      assert.equal(panel.rawPasses[0].strategy, 'local-alternative-original')
      assert.ok(Object.values(draft.meta.fieldReviews).every(review => review.state !== 'confirmed'))
      assert.ok(Object.values(draft.meta.confirmations).every(value => value !== true))
      const audit = draft.auditChain.filter(event => event.type === 'ocr_completed')
      assert.equal(audit.length, 1); assert.equal(await verifyAuditChain(draft.auditChain), true)
      assert.equal(audit[0].payload.strategy, 'machine-structured-candidates-v1')
      assert.equal(audit[0].payload.detectionProfile, 'baseline')
      assert.equal(audit[0].payload.requiresOfficerReview, true)
      assert.equal(audit[0].payload.rawHistoryUnchanged, true)
      assert.equal(draft.meta.ocrSource, 'local-paddle-structured')
      assert.deepEqual(audit[0].payload.reviewedRows, [])
      assert.ok(Array.isArray(audit[0].payload.candidateRows))
      const candidateRows = audit[0].payload.candidateRows
      for (const candidate of candidateRows) {
        assert.equal(candidate.method, 'system-derived-geometric-candidate')
        assert.equal(candidate.requiresOfficerReview, true); assert.equal(candidate.eligibleForAutomaticVerdict, false)
        assert.equal(candidate.text, candidate.parts.map(part => part.text).join(' '))
        for (const part of candidate.parts) {
          const index = Number(part.id.split(':line-').at(-1)); const original = enginePage.items[index]
          assert.equal(part.text, original?.text); assert.deepEqual(part.box, original.poly)
        }
      }
      for (const mapping of audit[0].payload.workingMappings) {
        assert.equal(mapping.sourceOnce, true)
        const ids = mapping.rows.flatMap(row => row.sourceIds)
        assert.equal(ids.length, enginePage.items.length); assert.equal(new Set(ids).size, enginePage.items.length)
      }
      const states = await page.locator('select[id^="verify-"]').evaluateAll(selects => selects.map(select => ({ id: select.id, value: select.value })))
      assert.ok(states.every(state => state.value === 'unreviewed'))
      row.workingFields = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, extractDeclarations(row.workingText).byId[field]]))
      row.candidateRows = candidateRows; row.observedFieldReviewStates = states; row.audit = audit[0]
      row.verification = { rawMatchesActualWorkerOutput: true, originalFileSha256: panel.originalBytesSha256, rawPassSha256: hash(panel.rawPasses[0].text), auditChainValid: true,
        rawHistoryUnchanged: true, machineCandidatesNotHumanAccepted: true, noTypedCorrections: true, fieldConfirmationsRemainUnset: true, draftPersisted: true }
      const details = page.getByTestId('machine-layout-candidates')
      await details.locator('summary').click()
      const historyText = await details.innerText()
      assert.doesNotMatch(historyText, /Association summary unavailable/i)
      assert.equal(await details.locator('li').count(), candidateRows.length)
      for (const candidate of candidateRows) assert.ok(historyText.includes(candidate.text), 'Every retained machine association must be available in the displayed history.')
      if (!candidateRows.length) assert.match(historyText, /recorded scan found no unambiguous geometric associations/i)
      row.verification.machineHistoryAvailable = true
      if (!checkset && sample.id === 'CF-001') {
        row.screenshots = []
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
          await page.setViewportSize({ width, height }); await details.scrollIntoViewIfNeeded()
          const screenshotPath = resolve(directory, `structured-result-${stamp}-${name}.png`)
          await page.screenshot({ path: screenshotPath })
          const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth))
          row.screenshots.push({ name, width, height, path: screenshotPath, horizontalOverflowPixels: overflow })
          assert.ok(overflow <= 1, 'The structured result must not overflow the viewport.')
        }
      }
      assert.deepEqual(pageErrors, []); assert.deepEqual(blockedRequests, [])
    } catch (error) { row.error = String(error.message || error).slice(0, 2000) }
    finally { row.elapsedMs = Math.round(performance.now() - before); await context.close() }
    report.rows.push(row); await checkpoint()
    console.log(JSON.stringify({ sampleId: row.sampleId, photo: report.rows.length, planned: manifest.samples.length, machineCandidates: row.candidateRows?.length, error: row.error, elapsedMs: row.elapsedMs }))
  }
  report.execution.afterSources = await fingerprintSources()
  report.execution.sourceUnchanged = JSON.stringify(report.execution.afterSources) === JSON.stringify(beforeSources)
  report.execution.appModuleUnchanged = hash(Buffer.from(await (await fetch(appModule.url)).arrayBuffer())) === appModule.sha256
  report.execution.status = 'complete'; report.finishedAt = new Date().toISOString(); await checkpoint()
  if (report.rows.some(row => row.error || row.blockedRequests.length) || !report.execution.sourceUnchanged || !report.execution.appModuleUnchanged) process.exitCode = 1
  console.log(JSON.stringify({ outputPath, failed: report.rows.filter(row => row.error).length, raw: report.rawScoring.runs.map(run => ({ correct: run.exactMatchCorrect, denominator: run.exactMatchSamples })), structured: report.structuredScoring }, null, 2))
} finally { await browser?.close(); await file.close() }
