import path from 'node:path'
import process from 'node:process'
import { launchTestBrowser } from './browser-runtime.mjs'

const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4173/'
const browser = await launchTestBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByText('Turn a label image into an inspectable decision.').waitFor()
await page.evaluate(async () => {
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  }
})
const cacheState = await page.evaluate(async () => {
  const names = await caches.keys()
  const urls = []
  for (const name of names) {
    const cache = await caches.open(name)
    urls.push(...(await cache.keys()).map((request) => request.url))
  }
  return { names, urls }
})
const hasShellAssets = cacheState.urls.some((url) => /\/assets\/.*\.js$/.test(url))
const hasOcrAssets = cacheState.urls.some((url) => /eng\.traineddata\.gz$/.test(url)) && cacheState.urls.some((url) => /tesseract-core.*\.wasm$/.test(url))
console.log(JSON.stringify({ phase: 'pre-offline', serviceWorker: cacheState.names, cachedEntries: cacheState.urls.length, hasShellAssets, hasOcrAssets, cachedUrls: cacheState.urls }, null, 2))
if (!hasShellAssets || !hasOcrAssets) throw new Error('The service worker did not finish caching the production shell and OCR runtime.')

await context.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' })
try {
  await page.getByText('Turn a label image into an inspectable decision.').waitFor()
} catch (error) {
  console.error(JSON.stringify({ phase: 'offline-reload', url: page.url(), title: await page.title(), errors, html: (await page.content()).slice(0, 1200) }, null, 2))
  throw error
}
await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), 'public', 'sample-real-label.svg'))
await page.getByText(/panel ready for OCR/i).waitFor()
await page.getByRole('button', { name: /Run browser OCR/i }).click()
await page.getByText(/OCR complete across/i).waitFor({ timeout: 120_000 })
const confidence = await page.locator('.confidence-chip').innerText()
const parsedSignals = await page.locator('.extraction-grid .detected').count()

await context.setOffline(false)
await browser.close()

console.log(JSON.stringify({ productionPreview: true, serviceWorker: cacheState.names, cachedEntries: cacheState.urls.length, hasShellAssets, hasOcrAssets, offlineReload: true, offlineOcr: true, confidence, parsedSignals, errors }, null, 2))
if (!hasShellAssets || !hasOcrAssets || errors.length) process.exitCode = 1
