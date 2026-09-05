import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'
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

async function verifyDecisiveFieldsAgainstFixture(targetPage) {
  await targetPage.getByRole('combobox', { name: 'Chapter II consumer scope', exact: true }).selectOption('retail')
  await targetPage.getByRole('combobox', { name: 'Rule 3 commodity group', exact: true }).selectOption('ordinary')
  await targetPage.getByRole('checkbox', { name: /I checked Rule 3 scope/ }).check()
  const verification = targetPage.locator('.evidence-verification').filter({ has: targetPage.getByRole('heading', { name: 'Verify against the physical label' }) })
  await verification.getByRole('button', { name: 'Show all verification fields', exact: true }).click()
  const rows = verification.locator('.field-review-row')
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index)
    await row.locator('input').fill('QA officer checked this declaration against every captured fixture panel.')
    const select = row.locator('select')
    const confirmed = select.locator('option[value="confirmed"]')
    const absent = select.locator('option[value="absent"]')
    if (!await confirmed.isDisabled()) await select.selectOption('confirmed')
    else if (!await absent.isDisabled()) await select.selectOption('absent')
    else await select.selectOption('unreadable')
  }
  for (const checkbox of await verification.locator('.safety-confirmations input[type="checkbox"]').all()) {
    if (!await checkbox.isChecked()) await checkbox.check()
  }
  await verification.getByRole('combobox', { name: 'Measurement surface' }).selectOption('flat')
}

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: 'From package image to defensible evidence.', exact: true }).waitFor()
if (await page.locator('.field-review-row').count()) throw new Error('An empty inspection should begin with capture, not the verification form.')
await page.screenshot({ path: path.join(root, 'qa-desktop-initial.png'), fullPage: true })

// Exercise the real upload path before using controlled regression packets.
await page.locator('input[type="file"]').setInputFiles(path.join(root, 'public', 'sample-real-label.png'))
await page.getByText(/panel ready for OCR/i).waitFor()
await page.getByRole('navigation', { name: 'Current inspection progress' }).waitFor()
const packageNavigator = page.getByRole('group', { name: /Package panel navigator/ })
await packageNavigator.waitFor()
await packageNavigator.press('ArrowRight')
if (await page.locator('.package-face-controls button[aria-pressed="true"]').innerText() !== await page.locator('.package-face-controls button').nth(1).innerText()) throw new Error('Keyboard package-face navigation did not select the next evidence role.')
await page.locator('.package-face-controls button').first().click()
await page.waitForTimeout(300)
await packageNavigator.scrollIntoViewIfNeeded()
await packageNavigator.hover({ position: { x: 160, y: 140 } })
const navigatorBounds = await packageNavigator.boundingBox()
if (!navigatorBounds) throw new Error('Package evidence navigator is not visible.')
await packageNavigator.evaluate((element) => {
  const rect = element.getBoundingClientRect()
  const start = rect.left + rect.width * .72
  const end = rect.left + rect.width * .28
  const y = rect.top + rect.height * .55
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, pointerType: 'touch', button: 0, clientX: start, clientY: y }))
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 41, pointerType: 'touch', clientX: end, clientY: y }))
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, pointerType: 'touch', clientX: end, clientY: y }))
})
await page.waitForTimeout(500)
const dragSelected = await page.locator('.package-face-controls button[aria-pressed="true"]').innerText()
const dragExpected = await page.locator('.package-face-controls button').nth(1).innerText()
if (dragSelected !== dragExpected) throw new Error(`Pointer-drag package-face navigation did not select the next evidence role. selected=${dragSelected}; expected=${dragExpected}; rotation=${await page.locator('.package-cuboid').evaluate((element) => element.style.getPropertyValue('--package-y'))}`)
await page.locator('.package-face-controls button').first().click()
await packageNavigator.evaluate((element) => {
  const rect = element.getBoundingClientRect()
  const start = rect.left + rect.width * .6
  const end = start - 12
  const y = rect.top + rect.height * .5
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, pointerType: 'touch', button: 0, clientX: start, clientY: y }))
  window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 42, pointerType: 'touch', clientX: end, clientY: y }))
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 42, pointerType: 'touch', clientX: end, clientY: y }))
})
await page.waitForTimeout(100)
if (await page.locator('.package-cuboid').evaluate((element) => element.style.getPropertyValue('--package-y')) !== '0deg') throw new Error('Sub-threshold package drag did not snap back to its selected face.')
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
const violationPacket = page.getByRole('button', { name: /Violation packet/i })
await violationPacket.waitFor()
await page.waitForFunction(() => ![...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Violation packet'))?.disabled)
await violationPacket.click()
await page.getByText(/Controlled demo evidence loaded/i).waitFor()
await page.getByText('REVIEW', { exact: true }).first().waitFor()
await verifyDecisiveFieldsAgainstFixture(page)
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
await passPage.getByText(/Controlled demo evidence loaded/i).waitFor()
await passPage.getByText('REVIEW', { exact: true }).first().waitFor()
const packageArtworkUrl = await passPage.locator('.image-layer img').getAttribute('src')
if (packageArtworkUrl) {
  const artworkPage = await context.newPage()
  await artworkPage.setContent(`<style>body{margin:0;background:#e7e2d5}img{display:block;width:450px;height:560px}</style><img src="${packageArtworkUrl}">`)
  await artworkPage.locator('img').screenshot({ path: path.join(root, 'qa-package-artwork.png') })
  await artworkPage.close()
}
await passPage.screenshot({ path: path.join(root, 'qa-desktop-compliant.png'), fullPage: true })
const controlledCaution = passPage.getByRole('button', { name: 'Continue with caution', exact: true })
if (await controlledCaution.count()) await controlledCaution.click()
await passPage.getByRole('button', { name: /Run browser OCR/i }).click()
await passPage.getByText(/OCR complete across 1 panel/i).waitFor({ timeout: 120000 })
const controlledPacketOcr = await passPage.locator('.inline-warning').count() === 0
const locatedField = passPage.locator('.extraction-grid > button').filter({ hasText: 'View source' }).first()
await locatedField.waitFor()
await locatedField.click()
await passPage.locator('aside[aria-label^="Evidence trace for"]').waitFor()
await passPage.getByRole('button', { name: 'Show on photo', exact: true }).click()
await passPage.emulateMedia({ reducedMotion: 'reduce' })
const reducedMotionTransition = await passPage.locator('.package-cuboid').evaluate((element) => getComputedStyle(element).transitionDuration)
if (reducedMotionTransition !== '0s') throw new Error(`Reduced-motion mode retained a cuboid transition: ${reducedMotionTransition}`)
await passPage.getByRole('button', { name: /Evidence report/i }).click()
await passPage.getByRole('heading', { name: 'Trace a parsed value to its captured pixels.', exact: true }).waitFor()
await passPage.getByText('OCR SOURCE LINE', { exact: true }).waitFor()
await passPage.emulateMedia({ media: 'print', reducedMotion: 'reduce' })
const printedSourceRows = await passPage.locator('.source-replay-print tbody tr').count()
if (!printedSourceRows || !await passPage.locator('.source-replay-print').isVisible() || await passPage.locator('.source-replay-layout').isVisible()) throw new Error('Print/PDF mode did not expose the complete source-region index.')
await passPage.emulateMedia({ media: 'screen', reducedMotion: 'reduce' })
await passPage.getByRole('button', { name: /Close/i }).click()
await passPage.getByRole('button', { name: /System & trust/i }).click()
await passPage.getByRole('heading', { name: 'Know what is local, connected and still unverified.', exact: true }).waitFor()
await passPage.getByText(/Offline shell (not verified|incomplete)/i).waitFor()
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

const qualityContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const qualityPage = await qualityContext.newPage()
await qualityPage.goto(baseUrl, { waitUntil: 'networkidle' })
const poorImage = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#ffffff' } }).png().toBuffer()
await qualityPage.locator('input[type="file"]').setInputFiles({
  name: 'poor-quality-label.png',
  mimeType: 'image/png',
  buffer: poorImage,
})
await qualityPage.getByText(/panel ready for OCR/i).waitFor()
const qualityOcr = qualityPage.getByRole('button', { name: /Run browser OCR/i })
if (!await qualityOcr.isDisabled()) throw new Error('Poor-image OCR was not gated before officer acknowledgement.')
await qualityPage.getByRole('button', { name: 'Continue with caution', exact: true }).click()
if (await qualityOcr.isDisabled()) throw new Error('Recorded image-quality acknowledgement did not enable OCR.')
await qualityPage.getByRole('button', { name: 'Rotate', exact: true }).click()
await qualityPage.getByText(/Image changed/i).waitFor()
await qualityPage.getByRole('button', { name: 'Continue with caution', exact: true }).waitFor()
if (!await qualityOcr.isDisabled()) throw new Error('Transforming evidence did not invalidate its quality acknowledgement.')
const panelsBeforeCancelledRetake = await qualityPage.locator('.evidence-strip > button').count()
await Promise.all([
  qualityPage.waitForEvent('filechooser'),
  qualityPage.getByRole('button', { name: 'Replace with new capture', exact: true }).click(),
])
await qualityPage.waitForTimeout(100)
if (await qualityPage.locator('.evidence-strip > button').count() !== panelsBeforeCancelledRetake) throw new Error('Opening and cancelling retake removed the existing evidence panel.')
await qualityContext.close()

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const mobilePage = await mobile.newPage()
mobilePage.on('console', (message) => {
  if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`)
})
mobilePage.on('pageerror', (error) => errors.push(`mobile page: ${error.message}`))
await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' })
await mobilePage.locator('.mobile-bottom-nav').waitFor()
const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
if (mobileOverflow > 1) throw new Error(`Mobile layout overflows horizontally by ${mobileOverflow}px.`)
await mobilePage.getByRole('button', { name: 'Open navigation' }).click()
await mobilePage.getByRole('button', { name: 'New inspection' }).waitFor()
const mobileLayers = await mobilePage.evaluate(() => ({
  sidebar: Number.parseInt(getComputedStyle(document.querySelector('.sidebar')).zIndex, 10),
  scrim: Number.parseInt(getComputedStyle(document.querySelector('.menu-scrim')).zIndex, 10),
  bottom: Number.parseInt(getComputedStyle(document.querySelector('.mobile-bottom-nav')).zIndex, 10),
}))
if (!(mobileLayers.sidebar > mobileLayers.bottom && mobileLayers.scrim > mobileLayers.bottom)) throw new Error(`Mobile drawer layers do not cover the bottom navigation: ${JSON.stringify(mobileLayers)}`)
await mobilePage.waitForTimeout(350)
await mobilePage.screenshot({ path: path.join(root, 'qa-mobile-menu.png'), fullPage: false })

console.log(JSON.stringify({ realUpload: true, perspectiveRectification: true, originalHashPreserved: digestBeforeRectification === digestAfterRectification, packageEvidenceNavigator: true, shortDragSnapBack: true, inspectionProgress: true, structuredExtraction: true, evidenceTrace: true, sealedSourceReplay: true, printedSourceRows, reducedMotion: reducedMotionTransition === '0s', qualityGate: true, fixtureAbstainsBeforeOfficerReview: true, flagCount, reviewCount, compliantFixtureAbstains: true, controlledPacketOcr, systemTrust: true, ruleLibrary: true, benchmarkMetrics, supervisorOverride: true, supervisorReportReopened: true, blindChallenge: hiddenControlledPackets === 0, mobileBottomNav: true, mobileDrawerLayers: mobileLayers, mobileOverflow, errors }, null, 2))
await browser.close()

if (errors.length) process.exitCode = 1
