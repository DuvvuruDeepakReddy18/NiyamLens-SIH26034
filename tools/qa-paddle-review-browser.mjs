import assert from 'node:assert/strict'
import { readFile, mkdir, open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { recognizeThroughUi, localPilotOrigin } from './run-browser-field-pilot.mjs'
import { verifyCriticalSourceImages } from './score-critical-fields.mjs'
import { validateCriticalFieldManifest, scoreCriticalFields, normalizeCriticalValue, CRITICAL_FIELDS } from '../src/lib/criticalFieldBenchmark.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4191/')
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes))
if (manifest.datasetId !== 'niyamlens-critical-fields-v1' || manifest.samples.length !== 8 || manifest.isHoldout !== false) throw new Error('Only the fixed eight-photo development corpus is permitted.')
const sourceVerification = await verifyCriticalSourceImages(manifest, root)
const regressionBaselinePath = resolve(root, 'reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T05-58-57-738Z.json')
const regressionBaselineBytes = await readFile(regressionBaselinePath)
const regressionBaseline = JSON.parse(regressionBaselineBytes)
if (regressionBaseline.rows.length !== 8 || regressionBaseline.execution.status !== 'complete') throw new Error('The preserved eight-photo pre-preview-fix UI baseline is required.')
const html = await (await fetch(`${origin}/`)).text()
const source = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/)?.[1]
if (!source || new URL(source, origin).origin !== origin) throw new Error('Local app module not found.')
const appModule = { url: new URL(source, origin).href }
const appBytes = Buffer.from(await (await fetch(appModule.url)).arrayBuffer())
Object.assign(appModule, { sha256: hash(appBytes), bytes: appBytes.length })
const startedAt = new Date().toISOString(); const stamp = startedAt.replace(/[:.]/g, '-')
const directory = resolve(root, 'reports/readiness-2026-09-05'); await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `paddle-review-browser-${stamp}.json`)
const file = await open(outputPath, 'wx')
const report = { schemaVersion: 1, kind: 'actual-browser-development-paddle-review-TEST-SELECTION-NOT-HUMAN-VALIDATION', startedAt, finishedAt: null, isHoldout: false, humanReviewed: false, manifestSha256: hash(manifestBytes), sourceVerification, execution: { origin, appModule, status: 'running', plannedPhotos: 8, automaticTestSelection: true, typedCorrections: false, crop: false, policy: 'Actual Chrome UI upload and Paddle recognition. Automation selects every available source-mapped checkbox solely to test its workflow, NOT to assert a human inspected it. No field confirmations or typed corrections.' }, rows: [], rawScoring: null, selectedWorkingScoring: null,
  regressionBaseline: { path: regressionBaselinePath, sha256: hash(regressionBaselineBytes) }, limitations: ['Eight previously used development photos with AI-provisional labels, not independent accuracy.', 'Selecting layout checkboxes here is explicitly automated test behavior; never report this as officer verification.', 'Selected working text is derived and separately measured; raw OCR remains immutable.', 'No legal verdict, field inspection, holdout run, mobile OCR speed or cloud workflow is validated.'] }

function selectedWorkingScore() {
  const perField = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { readableDenominator: 0, exactCandidateMatches: 0, wrongValidCandidates: 0, unresolvedReadable: 0, missingReadable: 0, excludedLabels: 0, excludedWithValidCandidates: 0 }]))
  for (const sample of manifest.samples) {
    const row = report.rows.find(row => row.sampleId === sample.id)
    for (const field of CRITICAL_FIELDS) {
      const label = sample.fields[field]; const actual = row?.workingFields?.[field]
      const valid = Boolean(actual && actual.candidates.length === 1 && actual.candidates[0].valid && !actual.conflict)
      if (label.metricEligible) {
        const metric = perField[field]; metric.readableDenominator += 1
        if (!row) metric.missingReadable += 1
        else if (valid && normalizeCriticalValue(field, actual.value) === normalizeCriticalValue(field, label.value)) metric.exactCandidateMatches += 1
        else if (valid) metric.wrongValidCandidates += 1
        else metric.unresolvedReadable += 1
      } else { perField[field].excludedLabels += 1; if (valid) perField[field].excludedWithValidCandidates += 1 }
    }
  }
  return { kind: 'actual-appended-derived-working-candidates-NOT-RAW-ACCURACY', humanReviewed: false, completePhotos: report.rows.length, plannedPhotos: 8, failedPhotos: report.rows.filter(row => row.error).length, exactCandidateMatches: Object.values(perField).reduce((sum, field) => sum + field.exactCandidateMatches, 0), readableDenominator: Object.values(perField).reduce((sum, field) => sum + field.readableDenominator, 0), perField }
}
const checkpoint = async () => {
  report.rawScoring = scoreCriticalFields(manifest, report.rows.map(row => ({ sampleId: row.sampleId, sourcePath: row.sourcePath, sourceSha256: row.sourceSha256, rawText: row.rawText, error: row.error, mode: 'browser-paddle', transcriptKind: 'raw-ocr-unedited', manuallyEdited: false })))
  report.selectedWorkingScoring = selectedWorkingScore()
  await file.truncate(0); await file.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await file.sync()
}
const readDraft = page => page.evaluate(async () => {
  const draft = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('niyamlens-evidence-v1', 2)
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const db = opening.result; const tx = db.transaction('drafts', 'readonly'); const request = tx.objectStore('drafts').get('active')
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => db.close()
    }
  })
  if (!draft) return null
  const digest = async dataUrl => {
    const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0))
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return { text: draft.text, rawOcrText: draft.rawOcrText, fieldReviews: draft.meta.fieldReviews, confirmations: Object.fromEntries(['allPanelsCaptured', 'classificationConfirmed', 'rule3ApplicabilityConfirmed', 'pdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed'].map(key => [key, draft.meta[key]])), ocrConfidence: draft.meta.ocrConfidence, panels: await Promise.all(draft.evidenceItems.map(async item => ({ id: item.id, sha256: item.sha256, originalBytesSha256: await digest(item.originalUrl), rawPasses: item.ocrPasses || [] }))), reviewedAudit: draft.auditChain.filter(event => event.type === 'ocr_completed' || event.action === 'ocr_completed') }
})
let browser
try {
  await checkpoint(); browser = await launchTestBrowser()
  for (const sample of manifest.samples) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
    const pageErrors = []; const blockedRequests = []
    await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); blockedRequests.push(`${url.origin}${url.pathname}`); return route.abort() })
    await context.addInitScript(() => {
      const OriginalWorker = window.Worker
      window.__paddleInputFrames = []; window.__paddleInputFrameError = null
      window.Worker = class extends OriginalWorker {
        constructor(url, options) {
          super(url, options)
          const originalPost = this.postMessage.bind(this)
          this.postMessage = (message, ...rest) => {
            if (message?.kind === 'worker-transport-request' && message.type === 'predict') {
              try {
                for (const source of message.payload.sources) {
                  if (source.kind !== 'imageBitmap' || !(source.imageBitmap instanceof ImageBitmap)) throw new Error('Unknown actual Paddle input transport.')
                  const bitmap = source.imageBitmap; const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
                  const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
                  const bytes = context.getImageData(0, 0, bitmap.width, bitmap.height).data
                  const captured = { width: bitmap.width, height: bitmap.height, rgbaSha256: null }
                  window.__paddleInputFrames.push(captured)
                  crypto.subtle.digest('SHA-256', bytes).then(buffer => { captured.rgbaSha256 = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
                }
              } catch (error) { window.__paddleInputFrameError = error.message }
            }
            // Read-only pixel observation above happens before transfer; this
            // forwards the original message and transfer list without changes.
            return originalPost(message, ...rest)
          }
        }
      }
    })
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message.slice(0, 2000)))
    const before = performance.now()
    const row = { sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, rawText: '', workingText: '', error: null, proposals: [], selectedCount: 0, tableBefore: null, tableAfter: null, screenshots: [], pageErrors, blockedRequests, verification: null }
    try {
      assert.equal(hash(await readFile(resolve(root, sample.sourcePath))), sample.sha256)
      const recognized = await recognizeThroughUi(page, resolve(root, sample.sourcePath), 'browser-paddle', `${origin}/`)
      row.rawText = recognized.rawText; row.rawSha256 = hash(row.rawText); row.qualityCaution = recognized.qualityCaution
      const baseline = regressionBaseline.rows.find(row => row.sampleId === sample.id && row.sourceSha256 === sample.sha256)
      row.rawIdenticalToPrePreviewFix = baseline?.rawText === row.rawText
      assert.equal(row.rawIdenticalToPrePreviewFix, true, 'The same development image must retain its unmodified raw OCR output after the display-only fix.')
      const digestBefore = await page.locator('.hash-readout').innerText()
      const editorBefore = await page.locator('.evidence-editor').inputValue(); assert.equal(editorBefore, '')
      row.tableBefore = await page.locator('.paddle-field-comparison table').innerText()
      const articles = page.locator('.paddle-proposals article')
      row.proposals = await articles.locator('strong').allTextContents()
      const frames = await page.evaluate(() => ({ items: window.__paddleInputFrames, error: window.__paddleInputFrameError }))
      assert.equal(frames.error, null); assert.equal(frames.items.length, 1)
      assert.match(frames.items[0].rgbaSha256, /^[a-f0-9]{64}$/)
      row.actualPaddleInput = frames.items[0]
      row.displayedSourceFrames = await page.locator('.proposal-closeup image').evaluateAll(async elements => Promise.all(elements.map(async element => {
        const url = element.getAttribute('href')
        if (!/^data:image\/png;base64,/.test(url)) throw new Error('Displayed source must be the exact local PNG OCR frame.')
        const blob = new Blob([Uint8Array.from(atob(url.split(',')[1]), character => character.charCodeAt(0))], { type: 'image/png' })
        const bitmap = await createImageBitmap(blob); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0)
        const bytes = context.getImageData(0, 0, bitmap.width, bitmap.height).data
        const rgbaSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        const result = { width: bitmap.width, height: bitmap.height, rgbaSha256 }; bitmap.close(); return result
      })))
      for (const displayed of row.displayedSourceFrames) assert.deepEqual(displayed, row.actualPaddleInput, 'Displayed source pixels must exactly match the real OCR input frame.')
      const choices = articles.locator('input[type=checkbox]')
      for (let index = 0; index < await choices.count(); index += 1) { if (await choices.nth(index).isEnabled()) { await choices.nth(index).check(); row.selectedCount += 1 } }
      row.tableAfter = await page.locator('.paddle-field-comparison table').innerText()
      if (sample.id === 'CF-001' && row.selectedCount) {
        await page.locator('.paddle-review > details > summary').first().click()
        for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
          await page.setViewportSize({ width, height })
          await articles.first().scrollIntoViewIfNeeded()
          const path = resolve(directory, `paddle-source-closeup-${stamp}-${name}.png`)
          await page.locator('.paddle-review').screenshot({ path })
          row.screenshots.push({ name, width, height, path })
          const closeupPath = resolve(directory, `paddle-exact-source-${stamp}-${name}.png`)
          await page.locator('.proposal-closeup').first().screenshot({ path: closeupPath })
          row.screenshots.push({ name: `${name}-exact-source`, width, height, path: closeupPath })
          assert.ok(await page.locator('.proposal-closeup').first().isVisible())
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Proposal view must not overflow viewport.')
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
      }
      await page.getByRole('button', { name: /^Append raw Paddle OCR/ }).click()
      await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor({ timeout: 15000 })
      row.workingText = await page.locator('.evidence-editor').inputValue()
      row.workingFields = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, extractDeclarations(row.workingText).byId[field]]))
      const expectedRaw = `\n\n[PADDLE RAW OCR · PANEL 1]\n${row.rawText}`
      assert.equal(await page.locator('.transcript-original').textContent(), expectedRaw)
      assert.equal(await page.locator('.hash-readout').innerText(), digestBefore)
      const states = await page.locator('select[id^="verify-"]').evaluateAll(selects => selects.map(select => ({ id: select.id, value: select.value })))
      row.observedFieldReviewStates = states
      assert.ok(states.length > 0)
      assert.ok(states.every(state => state.value === 'unreviewed'))
      let draft = null
      for (let attempt = 0; attempt < 30; attempt += 1) {
        draft = await readDraft(page)
        if (draft?.text === row.workingText && draft?.rawOcrText === expectedRaw) break
        await page.waitForTimeout(200)
      }
      assert.equal(draft?.text, row.workingText); assert.equal(draft?.rawOcrText, expectedRaw)
      assert.equal(draft.panels.length, 1)
      assert.equal(draft.panels[0].sha256, sample.sha256)
      assert.equal(draft.panels[0].originalBytesSha256, sample.sha256)
      assert.equal(draft.panels[0].rawPasses.length, 1)
      assert.equal(draft.panels[0].rawPasses[0].text, row.rawText)
      assert.ok(Object.values(draft.fieldReviews || {}).every(review => review.state !== 'confirmed'))
      assert.ok(Object.values(draft.confirmations).every(value => value !== true))
      assert.deepEqual(pageErrors, [])
      row.verification = { rawUiUnchanged: true, rawPassUnchanged: true, rawPassSha256: hash(draft.panels[0].rawPasses[0].text), originalFileSha256: draft.panels[0].originalBytesSha256, fieldReviewsUnconfirmed: true, confirmationFlagsRemainFalse: true, visibleFieldReviewStates: states, draftPersisted: true, draft: { fieldReviews: draft.fieldReviews, confirmations: draft.confirmations, ocrConfidence: draft.ocrConfidence }, workingKind: row.selectedCount ? 'officer-selected-layout-in-automated-TEST' : 'raw-Paddle-only', noTypedCorrection: true }
    } catch (error) { row.error = String(error.message || error).slice(0, 2000) }
    finally { row.elapsedMs = Math.round(performance.now() - before); await context.close() }
    report.rows.push(row); await checkpoint()
    console.log(JSON.stringify({ photo: report.rows.length, planned: 8, sampleId: row.sampleId, selected: row.selectedCount, error: row.error, verified: Boolean(row.verification), elapsedMs: row.elapsedMs }))
  }
  report.execution.appModuleUnchanged = hash(Buffer.from(await (await fetch(appModule.url)).arrayBuffer())) === appModule.sha256
  report.execution.status = 'complete'; report.finishedAt = new Date().toISOString(); await checkpoint()
  console.log(JSON.stringify({ outputPath, rows: report.rows.length, failed: report.rows.filter(row => row.error).length, raw: report.rawScoring.runs.map(({ exactMatchCorrect, exactMatchSamples }) => ({ exactMatchCorrect, exactMatchSamples })), derivedWorking: report.selectedWorkingScoring }, null, 2))
} finally { await browser?.close(); await file.close() }
