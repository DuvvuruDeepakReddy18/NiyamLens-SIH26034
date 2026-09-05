import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { localPilotOrigin, recognizeThroughUi } from './run-browser-field-pilot.mjs'
import { validateOcrHistory } from '../src/lib/ocrHistory.mjs'
const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4193/')
const startedAt = new Date().toISOString()
const path = resolve('datasets/openfoodfacts-india/real-labels/8901764082405/13.jpg')
assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), '1f0025ed0036b861d1ff901f4df776cea6d78c4aafb775555bfd02d7ea5fce5c')
const browser = await launchTestBrowser()
const report = { kind: 'known-development-photo-UI-workflow-NOT-ACCURACY', startedAt, finishedAt: null, source: 'CF-007', checks: [], errors: [] }
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.errors.push('EXTERNAL_REQUEST_BLOCKED'), route.abort()))
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(error.message))
  const observed = await recognizeThroughUi(page, path, 'browser-paddle', `${origin}/`)
  const digest = await page.locator('.hash-readout').innerText()
  // Synthetic automation choice only; no human/field-confirmation claim.
  for (const checkbox of await page.locator('.paddle-proposals input[type=checkbox]').all()) await checkbox.check()
  await page.getByRole('button', { name: /^Append raw Paddle OCR/ }).click()
  await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
  const previousWorking = await page.locator('.evidence-editor').inputValue()
  const previousRaw = await page.locator('.transcript-original').textContent()
  await page.getByRole('button', { name: 'Read net quantity close-up', exact: true }).click()
  await page.getByRole('region', { name: 'Paddle OCR preview' }).waitFor({ timeout: 180000 })
  assert.equal(await page.locator('.evidence-editor').inputValue(), previousWorking)
  await page.getByRole('button', { name: 'Dismiss preview', exact: true }).click()
  report.checks.push('heading-guided crop executes real OCR; dismissed preview does not mutate transcripts')
  await page.getByRole('button', { name: 'Select Net quantity region', exact: true }).click()
  await page.getByText('Select opposite corners around the complete declaration, including its heading', { exact: true }).waitFor()
  const layer = page.locator('.image-layer'); const box = await layer.boundingBox()
  await layer.click({ position: { x: box.width * .05, y: box.height * .05 } })
  await layer.click({ position: { x: box.width * .95, y: box.height * .95 } })
  await page.getByText('Recover an overprinted or sideways dark stamp', { exact: true }).click()
  await page.getByLabel('Stamp recovery direction').selectOption('dark-ink-90')
  await page.getByRole('button', { name: 'Read dark stamp · selected region', exact: true }).click()
  await page.getByRole('region', { name: 'Paddle OCR preview' }).waitFor({ timeout: 180000 })
  const raw = await page.locator('.paddle-review details > pre').first().innerText()
  assert.ok(await page.locator('.paddle-retry-input img').isVisible())
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await mkdir('reports/readiness-2026-09-05', { recursive: true })
  report.screenshot = resolve(`reports/readiness-2026-09-05/stamp-recovery-mobile-${startedAt.replace(/[:.]/g, '-')}.png`)
  await page.getByRole('region', { name: 'Paddle OCR preview', exact: true }).screenshot({ path: report.screenshot })
  await page.getByRole('button', { name: /^Append raw Paddle OCR/ }).click()
  await page.getByText('Paddle reading appended. Reverify each field and resolve any conflicts.', { exact: true }).waitFor()
  assert.equal(await page.locator('.hash-readout').innerText(), digest)
  assert.equal(await page.locator('.transcript-original').textContent(), `${previousRaw}\n\n[PADDLE FOCUSED RAW OCR · PANEL 1]\n${raw}`)
  let draft
  for (let attempt = 0; attempt < 30; attempt++) {
    draft = await page.evaluate(async () => new Promise((resolve, reject) => {
      const request = indexedDB.open('niyamlens-evidence-v1', 2)
      request.onsuccess = () => { const db = request.result; const tx = db.transaction('drafts', 'readonly'); const get = tx.objectStore('drafts').get('active'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close() }
      request.onerror = () => reject(request.error)
    }))
    if (draft?.evidenceItems?.[0]?.ocrPasses.length === 2) break
    await page.waitForTimeout(200)
  }
  validateOcrHistory(draft.evidenceItems)
  const [panel] = draft.evidenceItems
  assert.equal(panel.ocrPasses.length, 2)
  assert.equal(panel.ocrPasses[0].text, observed.rawText)
  assert.equal(panel.ocrPasses[1].text, raw)
  assert.equal(panel.ocrPasses[1].strategy, 'local-alternative-dark-ink-90-focus')
  const originalWordCount = observed.rawText.split('\n').filter(Boolean).length
  assert.ok(panel.ocrWords.length > originalWordCount)
  assert.ok(panel.ocrWords.slice(originalWordCount).every(word => word.pageWidth === panel.analysisWidth && word.pageHeight === panel.analysisHeight))
  assert.ok(Object.values(draft.meta.fieldReviews || {}).every(field => field.state !== 'confirmed'))
  report.checks.push('actual two-click region selection and 90-degree dark-ink OCR', 'mobile preview has no horizontal overflow', 'original hash, prior text and raw passes preserved in saved draft', 'rotated crop overlay boxes restored to full analysis coordinates', 'no typed corrections or field confirmations')
  assert.deepEqual(report.errors, [])
} catch (error) { report.errors.push(error.message); process.exitCode = 1 }
finally {
  await browser.close(); report.finishedAt = new Date().toISOString()
  const outputPath = resolve(`reports/readiness-2026-09-05/stamp-recovery-ui-${startedAt.replace(/[:.]/g, '-')}.json`)
  await mkdir('reports/readiness-2026-09-05', { recursive: true }); await writeFile(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ outputPath, ...report }, null, 2))
}
