import { launchTestBrowser } from './browser-runtime.mjs'

const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:5173/'
const browser = await launchTestBrowser()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
let requestPayload
let expectingOutage = false
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() !== 'error') return
  if (expectingOutage && /503 \(Service Unavailable\)/i.test(message.text())) return
  errors.push(message.text())
})

await page.route('**/api/ocr', async (route) => {
  requestPayload = route.request().postDataJSON()
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'google-vision',
      confidence: 96,
      text: 'TURMERIC POWDER\nM.R.P. Rs 40.00\nNET QTY 100 g\nPACKED 08/2026\nMANUFACTURED BY ROOT & RAIN FOODS\nCONSUMER CARE care@rootrain.in\nFSSAI Lic. No. 10012002300045',
      words: [],
    }),
  })
})

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.locator('details.test-aids summary').click()
await page.getByRole('button', { name: /Violation packet/i }).click()
await page.getByText(/Controlled demo evidence loaded/i).waitFor()
const qualityCaution = page.getByRole('button', { name: 'Continue with caution', exact: true })
if (await qualityCaution.count()) await qualityCaution.click()
await page.getByText('More OCR options', { exact: true }).click()
await page.getByRole('button', { name: /^Connected OCR$/i }).click()
await page.getByText(/Connected OCR complete across/i).waitFor({ timeout: 30_000 })
const connectedText = await page.locator('.evidence-editor').inputValue()
const fssaiDetected = await page.getByText('10012002300045', { exact: true }).isVisible()
const requestWasExplicit = Boolean(requestPayload?.image?.startsWith('data:image/') && requestPayload?.language === 'eng')

await page.unroute('**/api/ocr')
await page.route('**/api/ocr', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Connected OCR test outage.' }) }))
expectingOutage = true
await page.getByRole('button', { name: /^Connected OCR$/i }).click()
await page.getByText(/local evidence preserved/i).waitFor({ timeout: 30_000 })
const failurePreservedEvidence = await page.locator('.evidence-editor').inputValue() === connectedText

const result = {
  explicitOptInRequest: requestWasExplicit,
  connectedResultVisible: /M\.R\.P\. Rs 40\.00/.test(connectedText),
  fssaiDetected,
  failurePreservedEvidence,
  errors,
}
console.log(JSON.stringify(result, null, 2))
await browser.close()
if (!Object.entries(result).filter(([key]) => key !== 'errors').every(([, value]) => value) || errors.length) process.exitCode = 1
