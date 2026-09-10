import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { launchTestBrowser } from './browser-runtime.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { buildInspectionAnalysis } from '../src/lib/inspectionAnalysis.mjs'

const origin = 'http://127.0.0.1:4203/'
const out = path.resolve('reports/decision-insights-2026-09-10')
await mkdir(out, { recursive: true })
const browser = await launchTestBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = []; const results = []
page.on('pageerror', error => errors.push(error.message))
const command = () => page.getByRole('button', { name: 'Command view', exact: true }).click()
const back = () => page.getByRole('button', { name: 'Return to inspection', exact: true }).click()
const upload = async filename => {
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('docs/demo-video/judge-images-2026-09-09', filename))
  await page.getByText(/panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) await caution.click()
}
const inspectRecord = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('niyamlens-evidence-v1', 2)
  open.onerror = () => reject(open.error)
  open.onsuccess = () => {
    const db = open.result; const tx = db.transaction('drafts', 'readonly'); const req = tx.objectStore('drafts').get('active')
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close()
  }
}))
const waitRecord = async predicate => {
  for (let index = 0; index < 150; index++) {
    const value = await inspectRecord()
    if (value && predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Expected draft was not persisted')
}
const readWhileInCommand = async ({ priceVisible = true } = {}) => {
  await page.getByRole('button', { name: 'Read label fields', exact: true }).click()
  await command()
  await page.getByText('OCR / image processing in progress', { exact: true }).waitFor()
  await page.waitForFunction(() => {
    const text = document.querySelector('.current-assessment > b')?.textContent
    return text && !text.includes('processing in progress')
  }, null, { timeout: 300000 })
  await page.getByRole('heading', { name: 'What has actually happened?' }).waitFor()
  assert.match(await page.locator('.inspection-journey li').first().textContent(), /1 photos/)
  assert.match(await page.locator('.inspection-journey li').nth(3).textContent(), /0 fields/)
  assert.match(await page.locator('.inspection-journey li').last().textContent(), /0 records/)
  const priceScore = page.locator('.extraction-confidence li').filter({ hasText: 'Maximum Retail Price' })
  if (priceVisible) assert.match(await priceScore.locator('strong').textContent(), /\d+(?:\.\d+)?\/100/, 'retained price observation has a reported engine score')
  else assert.equal(await priceScore.locator('strong').textContent(), 'Unavailable')
  await page.locator('.result-explanation select').selectOption('mrp')
  assert.match(await page.locator('.result-explanation').textContent(), /Required — OCR alone/)
  assert.equal(await page.getByRole('heading', { name: 'Recent inspections', exact: true }).count(), 0)
  assert.equal(await page.locator('.current-field-table tbody tr').count(), 14)
  await back()
  await page.getByText(/Label fields ready/).waitFor()
  const text = await page.locator('.evidence-editor').inputValue()
  const raw = await page.locator('.transcript-original').textContent()
  assert.ok(raw.length > 100, 'real inference returned original characters')
  const parsed = extractDeclarations(text)
  const saved = await waitRecord(record => record.text === text && record.auditChain?.some(event => event.type === 'ocr_completed'))
  const event = saved.auditChain.filter(event => event.type === 'ocr_completed').at(-1)
  const insight = buildInspectionAnalysis(saved).insights
  results.push({ filename: saved.evidenceItems[0].name, id: saved.inspectionId, text, rawOcrText: saved.rawOcrText, extracted: Object.fromEntries(parsed.fields.map(field => [field.id, { value: field.value, conflict: Boolean(field.conflict), validation: field.validation?.status || null }])), reportedScores: Object.fromEntries(insight.explanations.map(field => [field.id, field.reportedScore])), stages: insight.stages, automaticRecovery: event.payload.automaticRecovery, rawPasses: saved.evidenceItems[0].ocrPasses.length, scope: 'Observed OCR output, not independently adjudicated accuracy.' })
  // Persist actual output even when a later assertion fails. Never hide failures.
  await writeFile(path.join(out, 'ocr-observations.json'), JSON.stringify(results, null, 2))
  assert.ok(parsed.suggestions.quantity, 'real photograph yielded a usable quantity')
  const mrpNote = await page.getByRole('textbox', { name: 'Maximum Retail Price verification note', exact: true }).inputValue()
  if (priceVisible) {
    assert.ok(parsed.byId.mrp.value, 'Amul photograph yielded a usable visible price')
    assert.match(mrpNote, /Auto-filled/)
  } else {
    // Inspected Kinley photo literally says SEE CAP/NECK for MRP/date.
    // That physical area is outside this photograph, so no numeric answer exists here.
    assert.equal(parsed.byId.mrp.value, '', 'uncaptured cap price must not be invented')
    assert.equal(parsed.byId.packDate.value, '', 'uncaptured cap date must not be invented')
    assert.equal(mrpNote, '', 'no fake auto-filled price confirmation note')
    assert.equal(saved.meta.quantity, parsed.suggestions.quantity)
    assert.equal(saved.meta.unit, parsed.suggestions.unit)
    await command()
    const mrpRow = page.locator('.current-field-table tbody tr').filter({ hasText: 'Maximum Retail Price' })
    assert.match(await mrpRow.textContent(), /Not detected|Unreadable/)
    assert.equal(await page.locator('.current-metrics article').nth(2).locator('b').textContent(), '0 / 14')
    await page.screenshot({ path: path.join(out, 'kinley-current-viewport.png'), animations: 'disabled' })
    await back()
  }
  return { text, raw, saved }
}
try {
  await page.goto(origin, { waitUntil: 'networkidle' })
  await command()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(out, 'desktop-current-viewport.png'), animations: 'disabled' })
  await page.getByRole('heading', { name: 'Start with a package, not a chart.' }).waitFor()
  assert.equal(await page.locator('.current-metrics').count(), 0)
  await page.getByRole('button', { name: 'Inspect a package', exact: true }).click()
  await upload('01-Amul.jpg')
  await page.getByRole('combobox', { name: 'Active panel purpose', exact: true }).selectOption('price_date')
  const first = await readWhileInCommand()
  console.log('PASS: real Amul OCR completes while Command view is open; autofill and current charts remain connected')

  await command()
  await page.locator('.current-field-table tbody tr').filter({ hasText: 'Maximum Retail Price' }).getByRole('button', { name: 'Review this field →', exact: true }).click()
  assert.equal(await page.evaluate(() => document.activeElement.id), 'verify-mrp')
  await page.locator('#verify-mrp').selectOption('confirmed')
  // Switch immediately, before the draft debounce. State must not be lost.
  await command()
  assert.equal(await page.locator('.current-metrics article').nth(2).locator('b').textContent(), '1 / 14')
  await page.getByRole('button', { name: /Officer verified.*Reading explicitly/ }).click()
  assert.equal(await page.locator('.current-field-table tbody tr').count(), 1)
  await page.getByRole('button', { name: 'Review this field →', exact: true }).click()
  assert.equal(await page.locator('#verify-mrp').inputValue(), 'confirmed', 'verified field can be reopened from chart')
  // Deliberate workflow-test conflict; not an OCR answer or physical truth.
  await page.locator('.evidence-editor').fill(first.text + '\nMRP Rs 999.00\n')
  await command()
  await page.getByRole('button', { name: /Conflicting readings.*Resolve competing/ }).click()
  assert.equal(await page.locator('.current-field-table tbody tr').count(), 1)
  assert.match(await page.locator('.current-field-table tbody').textContent(), /Maximum Retail Price/)
  assert.equal(await page.locator('.current-metrics article').nth(2).locator('b').textContent(), '0 / 14')
  assert.equal(await page.locator('.extraction-confidence li').filter({ hasText: 'Maximum Retail Price' }).locator('strong').textContent(), 'Unavailable')
  await back()
  await page.locator('.evidence-editor').fill(first.text)
  assert.equal(await page.locator('.transcript-original').textContent(), first.raw)
  // A changed value is an explicit workflow fixture, never an OCR answer.
  await page.locator('.evidence-editor').fill(first.text.replace('MRP:22.00', 'MRP:77.00'))
  await command()
  assert.equal(await page.locator('.extraction-confidence li').filter({ hasText: 'Maximum Retail Price' }).locator('strong').textContent(), 'Unavailable')
  await page.locator('.result-explanation select').selectOption('mrp')
  await page.getByRole('button', { name: 'Verify / correct this field →', exact: true }).click()
  assert.equal(await page.evaluate(() => document.activeElement.id), 'verify-mrp')
  await page.locator('.evidence-editor').fill(first.text)
  console.log('PASS: immediate navigation retains verification; chart drill-down focuses fields; conflicts are separately colored and raw text stays unchanged')

  await command()
  await page.locator('.evidence-distribution').screenshot({ path: path.join(out, 'desktop-evidence.png'), animations: 'disabled' })
  await page.locator('.current-chart-grid').last().screenshot({ path: path.join(out, 'desktop-charts.png'), animations: 'disabled' })
  await page.locator('.inspection-insights > .current-chart-grid').screenshot({ path: path.join(out, 'actual-score-charts.png'), animations: 'disabled' })
  await page.locator('.result-explanation').screenshot({ path: path.join(out, 'why-this-result.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.evidence-distribution').scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile page has no horizontal overflow')
  await page.locator('.evidence-distribution').screenshot({ path: path.join(out, 'mobile-evidence.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await back()
  await page.getByRole('button', { name: 'Save draft & new inspection', exact: true }).click()
  await command()
  await page.getByRole('heading', { name: 'Start with a package, not a chart.' }).waitFor()
  await page.getByRole('button', { name: 'Inspect a package', exact: true }).click()
  await upload('02-Kinley.jpg')
  await command()
  assert.match(await page.locator('.current-package-header h2').textContent(), /02-Kinley/)
  assert.equal(await page.locator('.current-metrics article').nth(2).locator('b').textContent(), '0 / 14')
  assert.equal(await page.locator('.current-metrics article').nth(1).locator('b').textContent(), '0 / 14')
  await back()
  const second = await readWhileInCommand({ priceVisible: false })
  assert.notEqual(second.saved.inspectionId, first.saved.inspectionId)
  await page.locator('.saved-drafts summary').click()
  await page.locator('.saved-drafts li').filter({ hasText: '01-Amul.jpg' }).getByRole('button', { name: 'Resume draft', exact: true }).click()
  await command()
  assert.equal(await page.locator('.current-package-header code').textContent(), first.saved.inspectionId)
  await waitRecord(record => record.inspectionId === first.saved.inspectionId)
  await page.reload({ waitUntil: 'networkidle' })
  await command()
  await page.getByText('Saved draft · restore it to continue.', { exact: true }).waitFor()
  assert.equal(await page.locator('.current-package-header code').textContent(), first.saved.inspectionId)
  assert.deepEqual(errors, [])
  console.log('PASS: Kinley quantity autofills; uncaptured cap MRP/date remain unresolved; new packages, restored drafts and reload stay isolated')
  const report = { at: new Date().toISOString(), pass: true, origin, scope: 'Isolated headless system Chrome. Two actual local Paddle OCR runs on real development photos; no cloud data touched. Manually selected confirmation and injected conflict are workflow fixtures, not human/legal validation. Observed fields are not blind accuracy.', checks: ['current inspection linked before sealing', 'OCR continues across navigation', '14 field source notes', 'immediate verification retained', 'color/status filtering and accessible table', 'conflict and unreadable separation', 'field drill-down', 'raw evidence preserved', 'new inspection clears charts', 'draft switching and reload isolation', 'desktop/mobile layout', 'no page errors'], observations: results, pageErrors: errors }
  await writeFile(path.join(out, 'browser-verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ pass: true, report: path.join(out, 'browser-verification.json'), observations: results.map(row => ({ filename: row.filename, rawPasses: row.rawPasses, automaticRecovery: row.automaticRecovery })) }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await context.close(); await browser.close() }
