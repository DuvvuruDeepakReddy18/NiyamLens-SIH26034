import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchTestBrowser } from './browser-runtime.mjs'

// Isolated local Chrome profile. Real first-image OCR; second-image text is an
// explicitly manual persistence fixture, not a recognition/accuracy result.
const origin = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4201/'
const reportDir = path.resolve('reports/draft-switch-2026-09-10')
await mkdir(reportDir, { recursive: true })
const browser = await launchTestBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const toolbar = () => page.getByRole('region', { name: 'Inspection drafts', exact: true })
const newButton = () => page.getByRole('button', { name: 'Save draft & new inspection', exact: true })
const drafts = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('niyamlens-evidence-v1', 2)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
    const db = request.result; const tx = db.transaction(['drafts'], 'readonly')
    const read = tx.objectStore('drafts').getAll()
    read.onsuccess = () => resolve(read.result)
    read.onerror = () => reject(read.error)
    tx.oncomplete = () => db.close()
  }
}))
const waitForDraft = async predicate => {
  for (let i = 0; i < 100; i++) {
    const rows = await drafts()
    if (predicate(rows)) return rows
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Expected committed draft state did not arrive')
}
const resume = async filename => {
  const list = page.locator('.saved-drafts')
  if (await list.getAttribute('open') === null) await list.locator('summary').click()
  await list.locator('li').filter({ hasText: filename }).getByRole('button', { name: 'Resume draft', exact: true }).click()
}
const upload = async filename => {
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('docs/demo-video/judge-images-2026-09-09', filename))
  await page.getByText(/panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) await caution.click()
}
const verifySameEvidence = (actual, expected) => {
  for (const key of ['inspectionId', 'startedAt', 'evidenceItems', 'activeEvidenceId', 'text', 'rawOcrText', 'ocrWords', 'auditChain']) assert.deepEqual(actual[key], expected[key], key)
  assert.deepEqual(actual.meta.fieldReviews, expected.meta.fieldReviews)
  assert.deepEqual(actual.meta.panelMeasurements, expected.meta.panelMeasurements)
}

try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Capture / upload package', exact: true }).waitFor()
  await upload('01-Amul.jpg')
  await page.getByRole('combobox', { name: 'Active panel purpose', exact: true }).selectOption('price_date')
  await page.getByRole('button', { name: 'Read label fields', exact: true }).click()
  assert.equal(await newButton().isDisabled(), true, 'cannot switch during real OCR')
  await page.getByText(/Label fields ready/).waitFor({ timeout: 180000 })
  const raw = await page.locator('.transcript-original').textContent()
  assert.ok(raw.length > 100, 'actual OCR returned a transcript, no supplied answers')
  const text = await page.getByRole('textbox', { name: 'Declaration evidence text', exact: true }).inputValue()
  const note = 'DRAFT SWITCH TEST: compared source photo; keep this note with Amul only.'
  await page.getByRole('textbox', { name: 'Maximum Retail Price verification note', exact: true }).fill(note)
  await page.locator('#verify-mrp').selectOption('confirmed')
  // Click immediately: the 350-ms autosave must not be required for this note.
  await newButton().click()
  await page.getByRole('button', { name: 'Capture / upload package', exact: true }).waitFor()
  assert.equal(await page.locator('.evidence-editor').count(), 0)
  const [first] = await drafts()
  assert.ok(first.id.startsWith('saved:'))
  assert.equal(first.text, text)
  assert.equal(first.rawOcrText, raw)
  assert.equal(first.meta.fieldReviews.mrp.reason, note)
  assert.equal(first.meta.fieldReviews.mrp.state, 'confirmed')
  console.log('PASS: real Amul OCR, immediate save-and-new, clean upload screen')

  await upload('02-Kinley.jpg')
  assert.equal(await page.locator('.evidence-editor').inputValue(), '')
  assert.equal(await page.getByRole('textbox', { name: 'Maximum Retail Price verification note', exact: true }).count(), 0, 'review controls from the earlier reading are not carried into an unscanned package')
  const secondText = 'MANUAL PERSISTENCE TEST ONLY: NET QUANTITY 1 l'
  await page.locator('.evidence-editor').fill(secondText)
  await resume('01-Amul.jpg')
  await page.getByText(/Draft restored under the current evidence policy/).waitFor()
  assert.equal(await page.locator('.evidence-editor').inputValue(), text)
  assert.equal(await page.locator('.transcript-original').textContent(), raw)
  await page.getByRole('button', { name: 'Show all verification fields', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: 'Maximum Retail Price verification note', exact: true }).inputValue(), note)
  let rows = await waitForDraft(rows => rows.find(row => row.id === 'active')?.inspectionId === first.inspectionId)
  const second = rows.find(row => row.id.startsWith('saved:'))
  assert.notEqual(first.inspectionId, second.inspectionId)
  assert.equal(second.evidenceItems.length, 1)
  assert.equal(second.evidenceItems[0].name, '02-Kinley.jpg')
  assert.equal(second.rawOcrText, '')
  assert.equal(second.text, secondText)
  verifySameEvidence(rows.find(row => row.id === 'active'), first)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click()
  await page.getByText(/Draft restored under the current evidence policy/).waitFor()
  assert.equal(await page.locator('.evidence-editor').inputValue(), text)
  assert.equal(await page.locator('.transcript-original').textContent(), raw)
  console.log('PASS: different package isolation, draft-to-draft switch, reload restoration')

  await page.locator('.ocr-advanced > summary').click()
  await page.getByRole('button', { name: 'Try Paddle OCR · local', exact: true }).click()
  await page.getByRole('region', { name: 'Paddle OCR preview', exact: true }).waitFor({ timeout: 180000 })
  assert.equal(await newButton().isDisabled(), true, 'pending preview cannot be silently discarded')
  await page.getByRole('button', { name: 'Dismiss preview', exact: true }).click()
  assert.equal(await newButton().isEnabled(), true)
  await page.getByRole('button', { name: 'Finalize inspection', exact: true }).click()
  await page.getByRole('button', { name: 'Start new inspection', exact: true }).waitFor()
  rows = await drafts()
  assert.equal(rows.some(row => row.inspectionId === first.inspectionId), false)
  assert.equal(rows.some(row => row.inspectionId === second.inspectionId), true)
  await page.getByRole('button', { name: 'Start new inspection', exact: true }).click()
  await page.getByRole('button', { name: 'Capture / upload package', exact: true }).waitFor()
  await resume('02-Kinley.jpg')
  await page.getByText(/Draft restored under the current evidence policy/).waitFor()
  assert.equal(await page.locator('.evidence-editor').inputValue(), secondText)
  console.log('PASS: preview lock, finalizing only the current case, other draft retained')

  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    window.__restoreDraftPut = () => { IDBObjectStore.prototype.put = original }
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'drafts' && value.id.startsWith('saved:')) throw new DOMException('Injected test storage quota failure', 'QuotaExceededError')
      return original.call(this, value, ...args)
    }
  })
  await newButton().click()
  await page.getByText(/Draft NOT saved; current inspection kept open/).waitFor()
  assert.equal(await page.locator('.evidence-editor').inputValue(), secondText)
  rows = await drafts()
  assert.equal(rows.find(row => row.id === 'active').inspectionId, second.inspectionId)
  await page.evaluate(() => window.__restoreDraftPut())
  await newButton().click()
  await page.getByRole('button', { name: 'Capture / upload package', exact: true }).waitFor()
  console.log('PASS: injected storage failure retains current evidence and retry succeeds')

  await page.locator('.saved-drafts summary').click()
  await toolbar().scrollIntoViewIfNeeded()
  await toolbar().screenshot({ path: path.join(reportDir, 'desktop-drafts.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await toolbar().scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no mobile horizontal overflow')
  await toolbar().screenshot({ path: path.join(reportDir, 'mobile-drafts.png') })
  assert.deepEqual(errors, [])
  const result = { at: new Date().toISOString(), origin, browser: 'isolated headless system Chrome', mode: 'local; no hosted data changed', firstImage: 'real Amul photo; actual primary Paddle OCR, no expected text supplied', secondImage: 'real Kinley photo; manual persistence fixture, not a second OCR result', passes: ['save-and-new before autosave debounce', 'clean second-image upload', 'multiple draft isolation', 'OCR/raw/notes/audit retained', 'restore after reload', 'pending OCR and preview locks', 'seal preserves other drafts', 'storage fault retains current image', 'retry after failure', 'desktop/mobile layout'], imageBytesCompared: true, pageErrors: errors }
  await writeFile(path.join(reportDir, 'browser-verification.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(reportDir, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await context.close(); await browser.close() }
