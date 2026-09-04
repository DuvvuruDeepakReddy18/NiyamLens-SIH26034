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
await page.getByRole('heading', { name: 'From package image to defensible evidence.', exact: true }).waitFor()
const manifest = await page.evaluate(() => fetch('/manifest.webmanifest', { cache: 'no-store' }).then((response) => response.json()))
if (manifest.id !== '/' || manifest.scope !== '/' || !manifest.icons.some((icon) => icon.sizes === '192x192') || !manifest.icons.some((icon) => icon.sizes === '512x512') || !manifest.icons.some((icon) => icon.purpose === 'maskable')) throw new Error('Install manifest is missing its stable identity, scope, raster sizes or maskable icon.')
await page.evaluate(async () => {
  await navigator.serviceWorker.ready
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  }
})
await page.getByRole('button', { name: 'System & trust', exact: true }).click()
await page.getByRole('button', { name: 'Download & verify offline OCR pack', exact: true }).click()
await page.getByText('Offline shell and OCR pack verified', { exact: true }).waitFor({ timeout: 180_000 })
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
const requiredOcrSuffixes = [
  '/ocr/worker.min.js',
  '/ocr/core/tesseract-core-lstm.wasm.js', '/ocr/core/tesseract-core-lstm.wasm',
  '/ocr/core/tesseract-core-simd-lstm.wasm.js', '/ocr/core/tesseract-core-simd-lstm.wasm',
  '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js', '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm',
  '/ocr/lang/eng.traineddata.gz', '/ocr/lang/hin.traineddata.gz', '/ocr/lang/tel.traineddata.gz', '/ocr/lang/tam.traineddata.gz',
  '/__niyamlens/offline-ocr-ready',
]
const hasOcrAssets = requiredOcrSuffixes.every((suffix) => cacheState.urls.some((url) => url.endsWith(suffix)))
const independentCaches = cacheState.names.some((name) => /^niyamlens-shell-v/.test(name)) && cacheState.names.includes('niyamlens-ocr-v1')
console.log(JSON.stringify({ phase: 'pre-offline', serviceWorker: cacheState.names, cachedEntries: cacheState.urls.length, hasShellAssets, hasOcrAssets, cachedUrls: cacheState.urls }, null, 2))
if (!hasShellAssets || !hasOcrAssets || !independentCaches) throw new Error('The service worker did not finish caching the production shell and complete OCR runtime in independent caches.')

await context.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' })
try {
  await page.getByRole('heading', { name: 'From package image to defensible evidence.', exact: true }).waitFor()
} catch (error) {
  console.error(JSON.stringify({ phase: 'offline-reload', url: page.url(), title: await page.title(), errors, html: (await page.content()).slice(0, 1200) }, null, 2))
  throw error
}
await page.locator('input[type="file"]').setInputFiles(path.join(process.cwd(), 'public', 'sample-real-label.png'))
await page.getByText(/panel ready for OCR/i).waitFor()
const continueWithCaution = page.getByRole('button', { name: 'Continue with caution', exact: true })
if (await continueWithCaution.count()) await continueWithCaution.click()
await page.getByRole('button', { name: /Run browser OCR/i }).click()
await page.getByText(/OCR complete across/i).waitFor({ timeout: 120_000 })
const confidence = await page.locator('.confidence-chip').innerText()
const parsedSignals = await page.locator('.extraction-grid .detected').count()

await context.setOffline(false)
await browser.close()

console.log(JSON.stringify({ productionPreview: true, manifestInstallable: true, serviceWorker: cacheState.names, cachedEntries: cacheState.urls.length, verifiedOfflinePack: true, independentCaches, hasShellAssets, hasOcrAssets, offlineReload: true, offlineOcr: true, confidence, parsedSignals, errors }, null, 2))
if (!hasShellAssets || !hasOcrAssets || !independentCaches || errors.length) process.exitCode = 1
