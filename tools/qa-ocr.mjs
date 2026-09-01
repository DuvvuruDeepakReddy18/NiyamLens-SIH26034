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
const productName = await page.getByLabel('Product / generic name').inputValue()
const parsedSignals = await page.locator('.extraction-grid .detected').count()
const mappedRegions = await page.locator('.declaration-region').count()
console.log(JSON.stringify({
  completed: true,
  confidence,
  productName,
  parsedSignals,
  mappedRegions,
  textPreview: text.replace(/\s+/g, ' ').slice(0, 180),
  externalRequests,
  errors,
}, null, 2))
await browser.close()
if (errors.length || externalRequests.length) process.exitCode = 1
