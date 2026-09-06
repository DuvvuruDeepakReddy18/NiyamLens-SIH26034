import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { validateOcrHistory } from '../src/lib/ocrHistory.mjs'
import { verifyAuditChain } from '../src/lib/audit.mjs'

assert.ok(process.argv.length === 3 && ['--run', '--sensitive-only'].includes(process.argv[2]), 'Use --run or the remaining --sensitive-only pass; no baseline repetition.')
const sensitiveOnly = process.argv[2] === '--sensitive-only'
const root = resolve(import.meta.dirname, '..'), origin = 'http://127.0.0.1:4195'
const path = 'datasets/recapture-discovery-2026-09-06-retry1/photos/8906080603938-7.jpg'
const sourceSha256 = '5cba83833d175fd0b8ca29b547f17389050fb3126dfd252d014bcc0d158bf8f3'
const hash = data => createHash('sha256').update(data).digest('hex')
assert.equal(hash(await readFile(resolve(root, path))), sourceSha256)
const corePaths = ['src/App.jsx', 'src/lib/paddleOcr.mjs', 'src/lib/paddleWorkingText.mjs', 'src/lib/paddleLayoutProposals.mjs', 'src/lib/extraction.mjs', 'src/lib/labelParser.mjs', 'src/PaddleReview.jsx', 'src/lib/ocrHistory.mjs']
const fingerprint = async () => Object.fromEntries(await Promise.all(corePaths.map(async path => [path, hash(await readFile(resolve(root, path)))])))
const startedAt = new Date().toISOString(), stamp = startedAt.replace(/[:.]/g, '-')
const directory = resolve(root, 'reports/recapture-2026-09-06')
await mkdir(directory, { recursive: true })
const report = { kind: 'RD005-follow-up-worker-and-UI-diagnostic-NOT-FRESH-ACCURACY', startedAt, source: { path, sha256: sourceSha256 }, beforeCore: await fingerprint(), plan: { baselinePrimaryPasses: sensitiveOnly ? 0 : 1, sensitiveWholePhotoRetries: 1, manualCrops: 0, typedCorrections: false, expectedAnswerSupplied: false, fieldConfirmations: false }, pageErrors: [], blockedRequests: [], stages: [], errors: [] }
if (sensitiveOnly) {
  const priorPath = 'reports/recapture-2026-09-06/rd005-recovery-2026-09-06T08-29-28-654Z.json'
  const priorBytes = await readFile(resolve(root, priorPath)), prior = JSON.parse(priorBytes)
  const baseline = prior.stages.find(stage => stage.name === 'baseline-primary')
  assert.equal(baseline.outcome, 'warning'); assert.equal(baseline.observations.requests.length, 1)
  assert.equal(baseline.rawOutputs.length, 1); assert.deepEqual(baseline.rawOutputs[0].items, [])
  assert.equal(baseline.workingText, ''); assert.equal(baseline.originalText, '')
  report.priorBaseline = { path: priorPath, sha256: hash(priorBytes), separateBrowserContext: true, note: 'Baseline completed with zero detected text and a terminal UI warning. The earlier harness sampled an initial draft at 300ms, racing the application\'s 350ms autosave debounce. Null was a premature snapshot, not an intended empty-text storage policy. This run performs only the remaining sensitive pass; no baseline replay and no transcript injection.' }
}
let browser
async function readDraft(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('niyamlens-evidence-v1', 2)
    request.onsuccess = () => { const db = request.result, tx = db.transaction('drafts', 'readonly'), get = tx.objectStore('drafts').get('active'); get.onsuccess = () => resolve(get.result || null); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close() }
    request.onerror = () => reject(request.error)
  }))
}
async function capture(page, name, outcome) {
  const observations = await page.evaluate(() => window.__rd005Observed)
  const workingText = await page.locator('.evidence-editor').inputValue()
  const originalText = await page.locator('.transcript-original').count() ? await page.locator('.transcript-original').textContent() : ''
  // Empty-text images are also autosaved. Never mistake a pre-debounce null
  // snapshot for a storage policy or for proof that evidence was preserved.
  await page.locator('.draft-bar').filter({ hasText: /Draft saved on this device|Draft NOT saved/ }).waitFor({ timeout: 15000 })
  const draftStatus = await page.locator('.draft-bar').innerText()
  let draft = await readDraft(page)
  for (let attempt = 0; attempt < 30 && !/Draft NOT saved/.test(draftStatus) && (!draft || draft.text !== workingText || draft.evidenceItems?.[0]?.sha256 !== sourceSha256); attempt++) { await page.waitForTimeout(200); draft = await readDraft(page) }
  if (!/Draft NOT saved/.test(draftStatus)) assert.ok(draft && draft.text === workingText && draft.evidenceItems?.[0]?.sha256 === sourceSha256, 'Saved status must agree with the actual current draft')
  if (draft) validateOcrHistory(draft.evidenceItems)
  const rawOutputs = observations.responses.filter(response => response.status === 'success').flatMap(response => Array.isArray(response.payload) ? response.payload : []).map(output => ({ ...output, literalRawText: Array.isArray(output.items) ? output.items.map(line => line.text).join('\n') : null }))
  const stage = { name, outcome, at: new Date().toISOString(), warning: await page.locator('.inline-warning').allTextContents(), progress: await page.locator('.ocr-progress').allTextContents(), observations, rawOutputs, workingText, originalText, workingSha256: hash(workingText), originalSha256: hash(originalText), unverifiedParse: extractDeclarations(workingText).byId.packDate, draft: draft ? { text: draft.text, rawOcrText: draft.rawOcrText, fieldReviews: draft.meta.fieldReviews || {}, auditChain: draft.auditChain, panels: draft.evidenceItems.map(item => ({ id: item.id, sha256: item.sha256, originalBytesSha256: hash(Buffer.from(item.originalUrl.split(',')[1], 'base64')), rawPasses: item.ocrPasses || [], ocrWords: item.ocrWords || [] })) } : null }
  if (stage.draft) { assert.equal(stage.draft.panels[0].sha256, sourceSha256); assert.equal(stage.draft.panels[0].originalBytesSha256, sourceSha256); assert.ok(Object.values(stage.draft.fieldReviews).every(value => value.state !== 'confirmed')); assert.equal(await verifyAuditChain(stage.draft.auditChain), true) }
  stage.draftStatus = draftStatus
  report.stages.push(stage); return stage
}
async function finishOrWarning(page, preview = false) {
  return Promise.race([
    (preview ? page.getByRole('region', { name: 'Paddle OCR preview', exact: true }) : page.getByText(/Label fields ready/)).waitFor({ timeout: 180000 }).then(() => preview ? 'preview' : 'ready'),
    page.locator('.inline-warning').filter({ hasText: /Paddle|OCR|source|reading|image|layout|text|polygon|evidence/i }).first().waitFor({ timeout: 180000 }).then(() => 'warning')
  ])
}
try {
  browser = await launchTestBrowser(); report.browserVersion = browser.version()
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.blockedRequests.push(route.request().url()), route.abort()))
  await context.addInitScript(() => {
    const OriginalWorker = window.Worker
    window.__rd005Observed = { requests: [], frames: [], responses: [], errors: [] }
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options)
        const ids = new Set(), post = this.postMessage.bind(this)
        this.addEventListener('error', event => window.__rd005Observed.errors.push(String(event.message).slice(0, 2000)))
        this.addEventListener('message', event => {
          if (event.data?.kind === 'worker-transport-response' && ids.has(event.data.requestId)) window.__rd005Observed.responses.push({ requestId: event.data.requestId, at: new Date().toISOString(), status: event.data.status, payload: structuredClone(event.data.payload), error: event.data.error ?? null })
        })
        this.postMessage = (message, ...rest) => {
          if (message?.kind === 'worker-transport-request' && message.type === 'predict') {
            ids.add(message.requestId)
            window.__rd005Observed.requests.push({ id: message.requestId, at: new Date().toISOString(), payloadKeys: Object.keys(message.payload || {}) })
            try {
              for (const source of message.payload.sources) {
                if (source.kind !== 'imageBitmap' || !(source.imageBitmap instanceof ImageBitmap)) throw new Error('Unexpected Paddle image transport')
                const bitmap = source.imageBitmap, canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d')
                ctx.drawImage(bitmap, 0, 0)
                const bytes = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
                const frame = { requestId: message.requestId, width: bitmap.width, height: bitmap.height, rgbaSha256: null }
                window.__rd005Observed.frames.push(frame)
                crypto.subtle.digest('SHA-256', bytes).then(buffer => { frame.rgbaSha256 = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
              }
            } catch (error) { window.__rd005Observed.errors.push(error.message) }
          }
          return post(message, ...rest)
        }
      }
    }
  })
  const page = await context.newPage(); page.on('pageerror', error => report.pageErrors.push(error.message))
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
  await page.getByText('Local workspace', { exact: true }).waitFor()
  await page.locator('input[type="file"]').setInputFiles(resolve(root, path))
  await page.getByText(/panel ready for OCR/i).waitFor({ timeout: 30000 })
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  report.qualityCaution = await caution.count() > 0
  if (report.qualityCaution) await caution.click()
  await page.waitForTimeout(300)
  const before = await capture(page, 'uploaded-before-recognition', 'captured')
  let baseline = before
  const passes = stage => stage.draft?.panels?.[0]?.rawPasses || []
  if (!sensitiveOnly) {
    await page.getByRole('button', { name: 'Read label fields', exact: true }).click()
    const baselineOutcome = await finishOrWarning(page)
    await page.waitForTimeout(400)
    baseline = await capture(page, 'baseline-primary', baselineOutcome)
    assert.equal(baseline.observations.requests.length, 1)
    if (baselineOutcome === 'warning') {
      assert.equal(baseline.workingText, before.workingText)
      assert.equal(baseline.originalText, before.originalText)
      assert.deepEqual(passes(baseline), passes(before))
    }
  }
  await page.getByText('More OCR options', { exact: true }).click()
  await page.getByRole('button', { name: 'Retry faint stamp detection', exact: true }).click()
  await page.waitForTimeout(150)
  const retryOutcome = await finishOrWarning(page, true)
  await page.waitForTimeout(300)
  const retry = await capture(page, 'sensitive-whole-photo-preview', retryOutcome)
  assert.equal(retry.observations.requests.length, sensitiveOnly ? 1 : 2)
  assert.equal(retry.workingText, baseline.workingText)
  assert.equal(retry.originalText, baseline.originalText)
  assert.deepEqual(passes(retry), passes(baseline))
  if (retryOutcome === 'preview') {
    assert.equal(await page.locator('.paddle-proposals input:checked').count(), 0)
    report.retryPreviewRaw = await page.locator('.paddle-review details > pre').first().innerText()
    report.retryComparison = await page.getByRole('region', { name: 'Candidate readings table', exact: true }).innerText()
    await page.getByRole('button', { name: 'Append raw Paddle OCR', exact: true }).click()
    await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
    await page.waitForTimeout(500)
    const final = await capture(page, 'sensitive-raw-appended', 'appended')
    const priorPasses = passes(baseline)
    assert.deepEqual(final.draft.panels[0].rawPasses.slice(0, priorPasses.length), priorPasses)
    assert.equal(final.draft.panels[0].rawPasses.length, priorPasses.length + 1)
    assert.equal(final.draft.panels[0].rawPasses.at(-1).strategy, 'local-alternative-original-sensitive-detector')
    assert.equal(final.draft.panels[0].rawPasses.at(-1).text, report.retryPreviewRaw)
    assert.deepEqual(final.draft.auditChain.filter(event => event.type === 'ocr_completed').at(-1).payload.reviewedRows, [])
  }
  report.afterCore = await fingerprint(); assert.deepEqual(report.afterCore, report.beforeCore)
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.blockedRequests, [])
  report.workflowPassed = true
} catch (error) { report.errors.push(String(error.message).slice(0, 3000)); report.workflowPassed = false; process.exitCode = 1 }
finally {
  await browser?.close(); report.finishedAt = new Date().toISOString()
  const outputPath = resolve(directory, `rd005-recovery-${stamp}.json`)
  await writeFile(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ outputPath, workflowPassed: report.workflowPassed, stages: report.stages.map(stage => ({ name: stage.name, outcome: stage.outcome, warning: stage.warning, rawOutputs: stage.rawOutputs.map(output => output.literalRawText), packDate: stage.unverifiedParse.value })), errors: report.errors }, null, 2))
}
