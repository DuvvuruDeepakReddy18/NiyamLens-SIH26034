import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchTestBrowser } from './browser-runtime.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

// Real photo + actual local Paddle inference. The custom context, notes and
// dimensions below are explicit workflow fixtures, not OCR/measurement truth.
const origin = 'http://127.0.0.1:4202/'
const reportDir = path.resolve('reports/autofill-2026-09-10')
await mkdir(reportDir, { recursive: true })
const browser = await launchTestBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
const hiddenChallenge = { id: 'retained-test-challenge', code: 'RETAINED', active: true, startedAt: '2026-09-09T10:00:00.000Z', actorId: 'test-officer' }
await context.addInitScript(value => {
  if (!localStorage.getItem('niyamlens:challenge')) localStorage.setItem('niyamlens:challenge', JSON.stringify(value))
}, hiddenChallenge)
const field = label => page.locator('.field').filter({ has: page.locator(':scope > span', { hasText: new RegExp(`^${label}$`) }) })
const quantity = () => field('Net quantity').locator('input')
const unit = () => field('Net quantity').locator('select')
const mrpNote = () => page.getByRole('textbox', { name: 'Maximum Retail Price verification note', exact: true })
const read = async () => {
  await page.getByRole('button', { name: 'Read label fields', exact: true }).click()
  await page.getByText(/Label fields ready/).waitFor({ timeout: 180000 })
}
const loadDraft = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('niyamlens-evidence-v1', 2)
  open.onerror = () => reject(open.error)
  open.onsuccess = () => {
    const db = open.result; const tx = db.transaction('drafts', 'readonly'); const req = tx.objectStore('drafts').get('active')
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close()
  }
}))
const awaitDraft = async predicate => {
  for (let n = 0; n < 100; n++) {
    const draft = await loadDraft()
    if (draft && predicate(draft)) return draft
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Draft did not persist expected autofill state')
}

try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('button', { name: 'Blind challenge', exact: true }).count(), 0)
  assert.equal(await page.locator('.challenge-ribbon').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Capture / upload package', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: 'System & trust', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /Start blind challenge/ }).count(), 0)
  await page.getByRole('button', { name: 'Inspect a package', exact: true }).click()
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('docs/demo-video/judge-images-2026-09-09/01-Amul.jpg'))
  await page.getByText(/panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) await caution.click()
  await read()
  const raw = await page.locator('.transcript-original').textContent()
  assert.ok(raw.length > 100)
  const parsed = extractDeclarations(await page.locator('.evidence-editor').inputValue())
  assert.ok(parsed.byId.mrp.value && parsed.suggestions.quantity, 'actual inference found usable price and quantity')
  assert.equal(Number(await quantity().inputValue()), parsed.suggestions.quantity)
  assert.equal(await unit().inputValue(), parsed.suggestions.unit)
  assert.match(await mrpNote().inputValue(), /Auto-filled from working transcript/)
  assert.match(await mrpNote().inputValue(), /Suggested source: Panel 1/)
  assert.equal(await page.locator('#verify-mrp').inputValue(), 'unreviewed')
  assert.equal(await page.locator('.safety-confirmations input:checked').count(), 0)
  assert.equal(await field('Principal display panel').locator('input').inputValue(), '')
  console.log('PASS: actual Amul OCR autofills context/source notes, not attestations or physical dimensions')

  // Explicitly save a custom officer entry and note; neither is OCR ground truth.
  const customNote = 'WORKFLOW TEST NOTE: retain this edit, not a real physical verification.'
  await quantity().fill('777')
  const retainedUnit = await unit().inputValue()
  await mrpNote().fill(customNote)
  await page.locator('#verify-mrp').selectOption('confirmed')
  await read()
  assert.equal(await quantity().inputValue(), '777')
  assert.equal(await unit().inputValue(), retainedUnit)
  assert.equal(await mrpNote().inputValue(), customNote)
  assert.equal(await page.locator('#verify-mrp').inputValue(), 'unreviewed')
  await page.getByRole('button', { name: 'Use detected quantity + unit', exact: true }).click()
  const second = extractDeclarations(await page.locator('.evidence-editor').inputValue())
  assert.equal(Number(await quantity().inputValue()), second.suggestions.quantity)
  assert.equal(await unit().inputValue(), second.suggestions.unit)
  console.log('PASS: repeat OCR retains manual context/notes, resets confirmation, explicit reuse restores detected quantity+unit')

  await page.getByPlaceholder('Width cm', { exact: true }).fill('10')
  await page.getByPlaceholder('Height cm', { exact: true }).first().fill('8')
  assert.equal(await field('Principal display panel').locator('input').inputValue(), '80')
  await page.getByPlaceholder('Height cm', { exact: true }).first().fill('')
  assert.equal(await field('Principal display panel').locator('input').inputValue(), '')
  assert.equal(await page.locator('.safety-confirmations input:checked').count(), 0)
  console.log('PASS: supplied dimensions calculate area; clearing a dimension clears stale area')

  await field('Product / generic name').locator('input').fill('OFFICER WORKFLOW TITLE')
  const saved = await awaitDraft(draft => draft.meta.productName === 'OFFICER WORKFLOW TITLE')
  // Seed an old challenge association in this isolated test profile, then
  // exercise actual restore/save so hiding cannot erase that provenance.
  await page.evaluate(async id => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('niyamlens-evidence-v1', 2)
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('drafts', 'readwrite'); const store = tx.objectStore('drafts'); const req = store.get('active')
        req.onsuccess = () => store.put({ ...req.result, challengeId: id })
        tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error)
      }
    })
  }, hiddenChallenge.id)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click()
  await page.getByText(/Draft restored under the current evidence policy/).waitFor()
  assert.equal(await field('Product / generic name').locator('input').inputValue(), 'OFFICER WORKFLOW TITLE')
  assert.equal(await mrpNote().inputValue(), customNote)
  assert.equal((await awaitDraft(draft => draft.challengeId === hiddenChallenge.id)).inspectionId, saved.inspectionId)
  await page.getByRole('button', { name: 'Save draft & new inspection', exact: true }).click()
  await page.getByRole('button', { name: 'Capture / upload package', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('niyamlens:challenge'))), hiddenChallenge)
  await page.locator('.saved-drafts summary').click()
  await page.getByRole('button', { name: 'Resume draft', exact: true }).click()
  await page.getByText(/Draft restored under the current evidence policy/).waitFor()
  assert.equal(await field('Product / generic name').locator('input').inputValue(), 'OFFICER WORKFLOW TITLE')
  console.log('PASS: hidden challenge never blocks normal workflow; original challenge state and restored draft association retained')

  await page.locator('.context-autofill').screenshot({ path: path.join(reportDir, 'desktop-context.png') })
  await page.locator('section.evidence-verification').screenshot({ path: path.join(reportDir, 'desktop-verification.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.context-autofill').scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.locator('.context-autofill').screenshot({ path: path.join(reportDir, 'mobile-context.png') })
  assert.deepEqual(errors, [])
  const report = { at: new Date().toISOString(), pass: true, origin, scope: 'Isolated headless system Chrome, real Amul image and two actual local Paddle OCR runs. Custom context, dimensions and notes are workflow fixtures, not recognition or legal accuracy results. No hosted data changed.', checks: ['automatic context', 'automatic source notes', 'no automatic attestations or scale', 'manual edits survive repeat OCR', 'explicit detected-value reuse', 'stale calculated area cleared', 'draft persistence', 'blind challenge hidden without deleting stored state', 'challenge draft provenance preserved', 'desktop/mobile layout', 'no page errors'], pageErrors: errors }
  await writeFile(path.join(reportDir, 'browser-verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(reportDir, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await context.close(); await browser.close() }
