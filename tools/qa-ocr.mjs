import path from 'node:path'
import process from 'node:process'
import { launchTestBrowser } from './browser-runtime.mjs'

const browser = await launchTestBrowser()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:5173/'
const allowedHost = new URL(baseUrl).hostname
const errors = []
const externalRequests = []
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.hostname !== allowedHost) {
    externalRequests.push(url.href)
    await route.abort()
    return
  }
  await route.continue()
})
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), 'public', 'sample-real-label.svg'))
await page.getByText(/panel ready for OCR/i).waitFor()
await page.getByRole('button', { name: /Run browser OCR/i }).click()
await page.getByText(/OCR complete across/i).waitFor({ timeout: 120_000 })

const text = await page.locator('.evidence-editor').inputValue()
const confidence = await page.locator('.confidence-chip').innerText()
const productName = await page.getByLabel('Product / generic name', { exact: true }).inputValue()
const parsedSignals = await page.locator('.extraction-grid .detected').count()
const mappedRegions = await page.locator('.declaration-region').count()
const expectedLines = [
  'FIELD HARVEST',
  'TURMERIC POWDER',
  'MRP Rs. 48.00 (inclusive of all taxes)',
  'NET QTY 100 g',
  'PACKED 08/2026',
  'MANUFACTURED BY: FIELD HARVEST FOODS',
  'Hyderabad, Telangana 500081',
  'CONSUMER CARE: care@fieldharvest.in',
  'Helpline: 1800 111 2026',
  'UNIT SALE PRICE Rs. 0.48/g',
  '20 mm REF',
  '8901234567890',
]
const normalizedText = text.replace(/^\[PANEL[^\n]*\]\s*/i, '').replace(/\s+/g, ' ').trim()
const missingExpectedLines = expectedLines.filter((line) => !normalizedText.includes(line))
console.log(JSON.stringify({
  completed: true,
  confidence,
  productName,
  parsedSignals,
  mappedRegions,
  recognizedText: text,
  missingExpectedLines,
  externalRequests,
  errors,
}, null, 2))
await browser.close()
if (errors.length || externalRequests.length || missingExpectedLines.length) process.exitCode = 1
