import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { recognizeThroughUi } from './run-browser-field-pilot.mjs'
import { validateOcrHistory } from '../src/lib/ocrHistory.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

// One rectangle chosen from the exact original photograph BEFORE recognition.
// The lower end contains PKD; the upper edge separates its printed date from
// the adjacent EXP prefix. It is a manual pixel selection, not localization.
// Do not adjust this rectangle after reading the result. No answer is passed
// to the page or OCR engine; assertions concern workflow integrity, not success.
const RECT = Object.freeze({ x0: .425, y0: .025, x1: .473, y1: .180 })
const SOURCE = 'datasets/openfoodfacts-india/real-labels/8904083301837/3.jpg'
const SOURCE_SHA = 'b9cd89914094ebe8f591b9c5b29e5451872720c63c9ee15461926d1dd72302d2'
const origin = 'http://127.0.0.1:4195'
const repo = resolve(import.meta.dirname, '..')
const hash = data => createHash('sha256').update(data).digest('hex')
const mode = process.argv[2]
assert.ok(['--plan', '--run'].includes(mode) && process.argv.length === 3, 'Use --plan or --run. Wait for the source-ready signal before --run.')
const plan = { sourcePath: SOURCE, sourceSha256: SOURCE_SHA, imageSize: { width: 1916, height: 2685 }, normalizedRect: RECT, recoveryMode: 'dark-ink-90', focusedPassCount: 1, priorReading: 'One fresh full-image raw Paddle pass, appended without reviewed suggestions', expectedAnswerSupplied: false, manualTextEdits: false, referenceUsedByEngine: false, knownDevelopmentPhoto: true, isAccuracyBenchmark: false }
if (mode === '--plan') { console.log(JSON.stringify(plan, null, 2)); process.exit(0) }
assert.equal(hash(await readFile(resolve(repo, SOURCE))), SOURCE_SHA)
const startedAt = new Date().toISOString()
const stamp = startedAt.replace(/[:.]/g, '-')
const outputDirectory = resolve(repo, 'reports/root-cause-2026-09-06')
await mkdir(outputDirectory, { recursive: true })
const reportPath = resolve(outputDirectory, `known-stamp-focus-${stamp}.json`)
async function sourceFingerprint() {
  const names = (await readdir(resolve(repo, 'src'), { recursive: true })).filter(name => /\.(?:jsx|mjs|css)$/.test(name)).sort()
  assert.ok(names.length < 500)
  const files = []
  for (const name of names) files.push({ path: `src/${name.replaceAll('\\', '/')}`, sha256: hash(await readFile(resolve(repo, 'src', name))) })
  return { sha256: hash(JSON.stringify(files)), files }
}
const fingerprint = await sourceFingerprint()
const freeze = { kind: 'one-visual-ROI-before-OCR', frozenAt: new Date().toISOString(), plan, sourceFingerprint: fingerprint, statement: 'No OCR for this run occurred before this freeze. This known development image and its label have prior project exposure; no blind-accuracy claim. One fixed crop only, with no expected transcript supplied.' }
await writeFile(resolve(outputDirectory, `known-stamp-focus-${stamp}.freeze.json`), JSON.stringify(freeze, null, 2), { flag: 'wx' })
const report = { kind: 'known-development-selected-stamp-UI-workflow-NOT-ACCURACY', startedAt, plan, sourceFingerprintBefore: fingerprint.sha256, checks: [], errors: [], browser: null, raw: null, comparison: null, persisted: null }
let browser
async function draftWithPasses(page, count) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const draft = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('niyamlens-evidence-v1', 2)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('drafts', 'readonly')
        const get = transaction.objectStore('drafts').get('active')
        get.onsuccess = () => resolve(get.result)
        get.onerror = () => reject(get.error)
        transaction.oncomplete = () => db.close()
      }
      request.onerror = () => reject(request.error)
    }))
    if (draft?.evidenceItems?.[0]?.ocrPasses?.length === count) return draft
    await page.waitForTimeout(200)
  }
  throw new Error(`Expected ${count} actual persisted raw passes`)
}
try {
  browser = await launchTestBrowser(); report.browser = browser.version()
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1100 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.errors.push('EXTERNAL_REQUEST_BLOCKED'), route.abort()))
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  const observed = await recognizeThroughUi(page, resolve(repo, SOURCE), 'browser-paddle', `${origin}/`)
  report.browserUserAgent = await page.evaluate(() => navigator.userAgent)
  const append = () => page.getByRole('button', { name: 'Append raw Paddle OCR', exact: true })
  assert.equal(await page.locator('.paddle-proposals input:checked').count(), 0)
  await append().click()
  await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
  const before = await draftWithPasses(page, 1)
  validateOcrHistory(before.evidenceItems)
  assert.equal(before.evidenceItems[0].ocrPasses[0].text, observed.rawText)
  const originalText = await page.locator('.transcript-original').textContent()
  const workingText = await page.locator('.evidence-editor').inputValue()
  const digest = await page.locator('.hash-readout').innerText()
  report.prior = { rawText: observed.rawText, originalTranscript: originalText, rawTextSha256: hash(observed.rawText), originalTranscriptSha256: hash(originalText), workingTextSha256: hash(workingText), qualityCaution: observed.qualityCaution, passes: before.evidenceItems[0].ocrPasses, parse: extractDeclarations(workingText).byId.packDate }
  await page.getByRole('button', { name: 'Select Pack date region', exact: true }).click()
  await page.getByText('Select opposite corners around the complete declaration, including its heading', { exact: true }).waitFor()
  const layer = page.locator('.image-layer')
  const box = await layer.boundingBox(); assert.ok(box)
  await layer.click({ position: { x: box.width * RECT.x0, y: box.height * RECT.y0 } })
  await layer.click({ position: { x: box.width * RECT.x1, y: box.height * RECT.y1 } })
  const focusCard = page.getByRole('region', { name: 'Focused OCR rescan', exact: true })
  await focusCard.waitFor()
  await focusCard.getByText('Recover this selected stamp', { exact: true }).click()
  await focusCard.getByLabel('Selected stamp recovery direction', { exact: true }).selectOption('dark-ink-90')
  await focusCard.getByRole('button', { name: 'Read selected dark stamp', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Paddle OCR preview', exact: true })
  await preview.waitFor({ timeout: 245000 })
  const displayedRaw = await preview.locator('details > pre').first().innerText()
  const raw = displayedRaw === '(no readable text on this panel)' ? '' : displayedRaw
  const input = preview.getByAltText('Exact dark-ink and orientation derivative used by OCR', { exact: true })
  assert.ok(await input.isVisible())
  report.exactInput = await input.evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight, source: img.src }))
  const inputBytes = Buffer.from(report.exactInput.source.split(',')[1], 'base64')
  report.exactInput.sha256 = hash(inputBytes)
  report.exactInput.path = resolve(outputDirectory, `known-stamp-focus-${stamp}.input.png`)
  await writeFile(report.exactInput.path, inputBytes, { flag: 'wx' })
  delete report.exactInput.source
  assert.equal(await page.locator('.evidence-editor').inputValue(), workingText)
  assert.equal(await page.locator('.transcript-original').textContent(), originalText)
  assert.equal(await page.locator('.paddle-proposals input:checked').count(), 0)
  report.raw = { text: raw, sha256: hash(raw), packDate: extractDeclarations(raw).byId.packDate }
  report.comparison = await preview.getByRole('region', { name: 'Candidate readings table', exact: true }).innerText()
  report.checks.push('One fixed two-click ROI and exactly one 90-degree dark-ink recovery pass', 'Preview exposes the exact transformed pixels while both existing transcripts remain unchanged', 'No proposal selection, typed correction or answer passed to OCR')
  if (raw.trim()) {
    await append().click()
    await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
  } else {
    await preview.getByRole('button', { name: 'Dismiss preview', exact: true }).click()
    report.checks.push('Empty recognition result retained in report and dismissed; no fabricated transcript appended')
  }
  const after = await draftWithPasses(page, raw.trim() ? 2 : 1)
  validateOcrHistory(after.evidenceItems)
  const panel = after.evidenceItems[0]
  assert.equal(panel.sha256, SOURCE_SHA)
  assert.equal(hash(Buffer.from(panel.originalUrl.split(',')[1], 'base64')), SOURCE_SHA)
  assert.deepEqual(panel.ocrPasses[0], before.evidenceItems[0].ocrPasses[0])
  assert.equal(hash(panel.ocrPasses[0].text), report.prior.rawTextSha256)
  assert.equal(await page.locator('.hash-readout').innerText(), digest)
  if (raw.trim()) {
    assert.equal(panel.ocrPasses[1].text, raw)
    assert.equal(panel.ocrPasses[1].strategy, 'local-alternative-dark-ink-90-focus')
    assert.equal(await page.locator('.transcript-original').textContent(), `${originalText}\n\n[PADDLE FOCUSED RAW OCR · PANEL 1]\n${raw}`)
  }
  assert.ok(Object.values(after.meta.fieldReviews || {}).every(field => field.state !== 'confirmed'))
  const completed = (after.auditChain || []).filter(event => event.type === 'ocr_completed' || event.action === 'ocr_completed')
  report.persisted = { sourceSha256: panel.sha256, priorRawPassUnchanged: true, originalFileBytesUnchanged: true, rawPasses: panel.ocrPasses, rawWords: panel.ocrWords, fieldReviews: after.meta.fieldReviews || {}, completionEvents: completed, workingText: await page.locator('.evidence-editor').inputValue(), originalText: await page.locator('.transcript-original').textContent() }
  report.persisted.unverifiedPackDate = extractDeclarations(report.persisted.workingText).byId.packDate
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  report.checks.push('Original file digest, first raw pass and appended raw history preserved in IndexedDB', 'Field remains unconfirmed regardless of parser outcome', '390px viewport has no horizontal document overflow')
  report.sourceFingerprintAfter = (await sourceFingerprint()).sha256
  assert.equal(report.sourceFingerprintAfter, report.sourceFingerprintBefore, 'Application source changed while testing; no reproducible run claim')
  assert.deepEqual(report.errors, [])
  report.workflowPassed = true
} catch (error) { report.errors.push(String(error.message).slice(0, 2000)); report.workflowPassed = false; process.exitCode = 1 }
finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ reportPath, workflowPassed: report.workflowPassed, raw: report.raw, errors: report.errors, checks: report.checks }, null, 2))
}
