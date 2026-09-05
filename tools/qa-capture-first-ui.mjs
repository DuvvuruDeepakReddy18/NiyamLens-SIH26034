import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { localPilotOrigin } from './run-browser-field-pilot.mjs'
import { validateOcrHistory } from '../src/lib/ocrHistory.mjs'

const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4193/')
const directory = resolve('reports/capture-first-2026-09-05')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const hash = data => createHash('sha256').update(data).digest('hex')
const source = resolve('datasets/openfoodfacts-india/real-labels/8901262260121/6.jpg')
const manifest = JSON.parse(await readFile('datasets/critical-fields.v1.json', 'utf8'))
const expected = manifest.samples.find(row => row.id === 'CF-001').sha256
assert.equal(hash(await readFile(source)), expected)
const sources = ['src/App.jsx', 'src/CaptureCoach.jsx', 'src/PackageEvidenceViewer.jsx', 'src/lib/captureCoach.mjs', 'src/lib/labelParser.mjs', 'src/lib/paddleOcr.mjs', 'src/lib/focusOcr.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async name => [name, hash(await readFile(name))])))
const report = { kind: 'actual-Chrome-capture-first-workflow-NOT-ACCURACY', startedAt: new Date().toISOString(), source: 'CF-001', originalSha256: expected, sourceHashes, appBundleSha256: null, checks: [], readings: [], errors: [], limitations: ['Known development photo, not an independent or human evaluation.', 'Fixed 3%-97% rectangle tests crop mechanics, not an expert-selected declaration ROI.', 'No typed transcript, confirmation, selected layout suggestions or expected-field scoring.', 'Fresh isolated local browser; no hosted-account or offline claim.'] }
await mkdir(directory, { recursive: true })
const browser = await launchTestBrowser()
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.errors.push('EXTERNAL_REQUEST_BLOCKED'), route.abort()))
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('response', async response => { if (/\/assets\/index-[^/]+\.js$/.test(new URL(response.url()).pathname) && !report.appBundleSha256) report.appBundleSha256 = hash(await response.body()) })
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByText('Local workspace', { exact: true }).waitFor()
  await page.locator('input[type=file]').setInputFiles(source)
  await page.getByText(/panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  report.qualityCautionByTestPolicy = await caution.count() > 0
  if (report.qualityCautionByTestPolicy) await caution.click()
  const editor = page.getByRole('textbox', { name: 'Declaration evidence text', exact: true })
  assert.equal(await editor.inputValue(), '')
  const coach = page.getByRole('region', { name: 'Capture guidance', exact: true })
  assert.equal(await coach.getByText(/Not read yet/).count(), 3)
  assert.equal(await coach.getByRole('button').count(), 3)
  const digest = await page.locator('.hash-readout').innerText()
  await coach.getByRole('button', { name: 'Select MRP region', exact: true }).click()
  await page.getByText('Select opposite corners around the complete declaration, including its heading', { exact: true }).waitFor()
  const layer = page.locator('.image-layer'); const box = await layer.boundingBox()
  await layer.click({ position: { x: box.width * .03, y: box.height * .03 } })
  await layer.click({ position: { x: box.width * .97, y: box.height * .97 } })
  const card = page.getByRole('region', { name: 'Focused OCR rescan', exact: true })
  assert.equal(await card.evaluate(node => node === document.activeElement), true)
  report.checks.push('three declaration selectors available before OCR; selection moves keyboard focus to scan controls')
  const assertLocked = async () => {
    for (const name of ['Run browser OCR', 'Scan selected region', 'Try Paddle on selected region', 'Finalize inspection', 'Rotate', 'Remove panel']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true, name)
    assert.equal(await page.getByRole('button', { name: /^Add package panel/ }).isDisabled(), true)
    for (const button of await coach.getByRole('button').all()) assert.equal(await button.isDisabled(), true)
    for (const button of await page.locator('.package-face-controls').getByRole('button').all()) assert.equal(await button.isDisabled(), true)
    // Programmatic keyboard input also cannot navigate the custom non-button control.
    const navigator = page.getByRole('group', { name: /^Package panel navigator/ })
    const before = await navigator.getAttribute('aria-label')
    await navigator.dispatchEvent('keydown', { key: 'ArrowRight' })
    assert.equal(await navigator.getAttribute('aria-label'), before)
  }
  await page.getByRole('button', { name: 'Scan selected region', exact: true }).click()
  await page.getByText('Focus OCR ready for review — transcript not changed', { exact: true }).waitFor({ timeout: 245000 })
  report.readings.push({ mode: 'focused-tesseract-three-pass-dismissed', rawText: await card.locator(':scope > pre').innerText() })
  await assertLocked()
  assert.equal(await editor.inputValue(), '')
  await page.getByRole('button', { name: 'Dismiss crop preview', exact: true }).click()
  assert.equal(await editor.inputValue(), '')
  assert.equal(await page.getByRole('button', { name: 'Run browser OCR', exact: true }).isEnabled(), true)
  report.checks.push('real three-pass crop OCR remains a preview; scans/image mutations/navigation/sealing blocked; dismiss preserves empty transcript')
  await page.getByRole('button', { name: 'Try Paddle on selected region', exact: true }).click()
  await page.getByRole('region', { name: 'Paddle OCR preview', exact: true }).waitFor({ timeout: 180000 })
  await assertLocked()
  const raw = await page.locator('.paddle-review details > pre').first().innerText()
  report.readings.push({ mode: 'focused-paddle-original-no-layout-selection', rawText: raw })
  assert.equal(await editor.inputValue(), '')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  report.screenshot = resolve(directory, `mobile-preview-${stamp}.png`)
  await page.getByRole('region', { name: 'Paddle OCR preview', exact: true }).screenshot({ path: report.screenshot })
  await page.getByRole('button', { name: /^Append raw Paddle OCR/ }).click()
  await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
  assert.equal(await page.locator('.hash-readout').innerText(), digest)
  assert.ok((await editor.inputValue()).endsWith(raw))
  let draft
  for (let attempt = 0; attempt < 30; attempt++) {
    draft = await page.evaluate(async () => new Promise((resolve, reject) => {
      const request = indexedDB.open('niyamlens-evidence-v1', 2)
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('drafts', 'readonly'); const get = tx.objectStore('drafts').get('active'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close() }
      request.onerror = () => reject(request.error)
    }))
    if (draft?.evidenceItems?.[0]?.ocrPasses?.length === 1) break
    await page.waitForTimeout(200)
  }
  validateOcrHistory(draft.evidenceItems)
  assert.equal(draft.evidenceItems[0].sha256, expected)
  assert.equal(draft.evidenceItems[0].ocrPasses.length, 1, 'Dismissed preview must not enter evidence history')
  assert.equal(draft.evidenceItems[0].ocrPasses[0].text, raw)
  assert.ok(Object.values(draft.meta.fieldReviews || {}).every(field => field.state !== 'confirmed'))
  report.checks.push('real Paddle crop preview has no mobile overflow; raw append preserves original hash and only chosen preview enters draft; no confirmations fabricated')
  assert.deepEqual(report.errors, [])
  report.sourceFilesUnchanged = (await Promise.all(sources.map(async name => hash(await readFile(name)) === sourceHashes[name]))).every(Boolean)
  assert.equal(report.sourceFilesUnchanged, true)
} catch (error) { report.errors.push(error.message); process.exitCode = 1 }
finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  const output = resolve(directory, `chrome-${stamp}.json`)
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output, checks: report.checks, errors: report.errors, appBundleSha256: report.appBundleSha256 }, null, 2))
}
