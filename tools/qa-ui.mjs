import path from 'node:path'
import process from 'node:process'
import { launchTestBrowser } from './browser-runtime.mjs'

const root = process.cwd()
const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:5173/'
const browser = await launchTestBrowser()

const errors = []
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`page: ${error.message}`))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByText('Turn a label image into an inspectable decision.').waitFor()
await page.screenshot({ path: path.join(root, 'qa-desktop-initial.png'), fullPage: true })

// Exercise the real upload path before using controlled regression packets.
await page.locator('input[type="file"]').setInputFiles(path.join(root, 'public', 'sample-real-label.svg'))
await page.getByText(/panel ready for OCR/i).waitFor()
const digestBeforeRectification = await page.locator('.hash-readout').innerText()
await page.getByRole('button', { name: /Flatten panel/i }).click()
const imagePlane = page.locator('.image-layer')
const imageBounds = await imagePlane.boundingBox()
if (!imageBounds) throw new Error('Image plane was not available for perspective rectification.')
for (const [x, y] of [[.08, .08], [.92, .08], [.92, .92], [.08, .92]]) {
  await imagePlane.click({ position: { x: imageBounds.width * x, y: imageBounds.height * y } })
  await page.waitForTimeout(80)
}
await page.waitForTimeout(5000)
const flattenMessages = await page.locator('.ocr-progress small, .inline-warning, .measurement-prompt').allInnerTexts()
if (!flattenMessages.some((message) => /Perspective flattened/i.test(message))) {
  const selectedPoints = await page.locator('.measure-overlay circle').count()
  throw new Error(`Perspective rectification did not complete. points=${selectedPoints}; state=${flattenMessages.join(' | ')}; errors=${errors.join(' | ')}`)
}
const digestAfterRectification = await page.locator('.hash-readout').innerText()
await page.locator('.evidence-editor').fill(`FIELD HARVEST TURMERIC POWDER
MRP Rs. 48.00 (inclusive of all taxes)
NET QTY 100 g
PACKED 08/2026
MANUFACTURED BY: FIELD HARVEST FOODS
Hyderabad, Telangana 500081
CONSUMER CARE: care@fieldharvest.in
Helpline: 1800 111 2026
UNIT SALE PRICE Rs. 0.48/g`)
await page.getByRole('button', { name: /Apply detected context/i }).click()
await page.getByText(/declaration signals detected/i).waitFor()
await page.screenshot({ path: path.join(root, 'qa-real-upload.png'), fullPage: true })

await page.getByText('Controlled test packets').click()
await page.getByRole('button', { name: /Violation packet/i }).click()
await page.getByText('FLAG', { exact: true }).first().waitFor()
const flagCount = await page.locator('.checks-list .check-row.fail').count()
const reviewCount = await page.locator('.checks-list .check-row.review').count()
await page.screenshot({ path: path.join(root, 'qa-desktop-violation.png'), fullPage: true })

await page.getByRole('button', { name: /Evidence report/i }).click()
await page.getByText('EVIDENCE PACKET').waitFor()
await page.screenshot({ path: path.join(root, 'qa-evidence-report.png'), fullPage: true })
await page.getByRole('button', { name: /Close/i }).click()

await page.getByRole('button', { name: /Finalize inspection/i }).click()
await page.getByRole('button', { name: /Command view/i }).click()
await page.getByText('What requires an officer’s attention?').waitFor()
await page.waitForTimeout(600)
await page.screenshot({ path: path.join(root, 'qa-dashboard.png'), fullPage: true })

const passPage = await context.newPage()
passPage.on('console', (message) => {
  if (message.type() === 'error') errors.push(`pass console: ${message.text()}`)
})
passPage.on('pageerror', (error) => errors.push(`pass page: ${error.message}`))
await passPage.goto(baseUrl, { waitUntil: 'networkidle' })
await passPage.getByText('Controlled test packets').click()
await passPage.getByRole('button', { name: /Compliant packet/i }).click()
await passPage.getByText('PASS', { exact: true }).first().waitFor()
await passPage.getByText(/Controlled demo evidence loaded/i).waitFor()
const packageArtworkUrl = await passPage.locator('.image-layer img').getAttribute('src')
if (packageArtworkUrl) {
  const artworkPage = await context.newPage()
  await artworkPage.setContent(`<style>body{margin:0;background:#e7e2d5}img{display:block;width:450px;height:560px}</style><img src="${packageArtworkUrl}">`)
  await artworkPage.locator('img').screenshot({ path: path.join(root, 'qa-package-artwork.png') })
  await artworkPage.close()
}
await passPage.screenshot({ path: path.join(root, 'qa-desktop-compliant.png'), fullPage: true })
await passPage.getByRole('button', { name: /Run browser OCR/i }).click()
await passPage.getByText(/OCR complete across 1 panel/i).waitFor({ timeout: 120000 })
const controlledPacketOcr = await passPage.locator('.inline-warning').count() === 0
await passPage.getByRole('button', { name: /Rule library/i }).click()
await passPage.getByText('The law is the source of truth—not the language model.').waitFor()
await passPage.getByText('NO FABRICATED APPROVAL').waitFor()

await passPage.getByRole('button', { name: /Validation lab/i }).click()
await passPage.getByText('Prove accuracy—or label the evidence gap.').waitFor()
const benchmarkMetrics = await passPage.locator('.validation-metrics .metric-card').count()
await passPage.waitForTimeout(650)
await passPage.screenshot({ path: path.join(root, 'qa-validation-lab.png'), fullPage: true })

await passPage.getByRole('button', { name: /Officer operations/i }).click()
await passPage.getByText('Assign, inspect, review and transfer evidence.').waitFor()
await passPage.locator('.actor-switch select').selectOption('supervisor-01')
await passPage.getByPlaceholder('Premises / package reference').fill('QA retail counter 04')
await passPage.getByRole('button', { name: 'Assign', exact: true }).click()
await passPage.getByText('QA retail counter 04').waitFor()
await passPage.locator('.review-record').first().getByRole('button', { name: /Review \/ override/i }).click()
await passPage.getByPlaceholder(/State the physical evidence/i).fill('QA supervisor disposition preserves the automated finding and records the review basis.')
await passPage.getByRole('button', { name: /Seal supervisor disposition/i }).click()
await passPage.locator('.override-modal').waitFor({ state: 'detached' })
await passPage.locator('.review-record').first().getByRole('button', { name: /Evidence/i }).click()
await passPage.getByText('SUPERVISOR DISPOSITION', { exact: true }).waitFor()
await passPage.getByText(/Automated status preserved as/i).waitFor()
await passPage.getByRole('button', { name: /Close/i }).click()
await passPage.waitForTimeout(650)
await passPage.screenshot({ path: path.join(root, 'qa-officer-operations.png'), fullPage: true })

await passPage.getByRole('button', { name: /Blind challenge/i }).click()
await passPage.getByText('No canned image. No hidden tuning. One sealed run.').waitFor()
await passPage.getByRole('button', { name: /Start blind challenge/i }).click()
await passPage.locator('.challenge-ribbon').waitFor()
await passPage.getByText(/Controlled packets disabled/i).waitFor()
const hiddenControlledPackets = await passPage.getByText('Controlled test packets').count()
await passPage.waitForTimeout(650)
await passPage.screenshot({ path: path.join(root, 'qa-blind-challenge.png'), fullPage: true })

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const mobilePage = await mobile.newPage()
mobilePage.on('console', (message) => {
  if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`)
})
mobilePage.on('pageerror', (error) => errors.push(`mobile page: ${error.message}`))
await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' })
await mobilePage.getByRole('button', { name: 'Open navigation' }).click()
await mobilePage.getByRole('button', { name: 'New inspection' }).waitFor()
await mobilePage.waitForTimeout(350)
await mobilePage.screenshot({ path: path.join(root, 'qa-mobile-menu.png'), fullPage: false })

console.log(JSON.stringify({ realUpload: true, perspectiveRectification: true, originalHashPreserved: digestBeforeRectification === digestAfterRectification, structuredExtraction: true, flagCount, reviewCount, compliantDemo: true, controlledPacketOcr, ruleLibrary: true, benchmarkMetrics, supervisorOverride: true, supervisorReportReopened: true, blindChallenge: hiddenControlledPackets === 0, errors }, null, 2))
await browser.close()

if (errors.length) process.exitCode = 1
