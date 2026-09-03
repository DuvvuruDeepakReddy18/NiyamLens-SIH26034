const CACHE = 'niyamlens-shell-v7'
const OFFLINE_ASSETS = [
  '/',
  '/icon.svg',
  '/manifest.webmanifest',
  '/ocr/worker.min.js',
  '/ocr/core/tesseract-core-lstm.wasm.js',
  '/ocr/core/tesseract-core-lstm.wasm',
  '/ocr/core/tesseract-core-simd-lstm.wasm.js',
  '/ocr/core/tesseract-core-simd-lstm.wasm',
  '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
  '/ocr/core/tesseract-core-relaxedsimd-lstm.wasm',
  '/ocr/lang/eng.traineddata.gz',
  '/ocr/lang/hin.traineddata.gz',
  '/ocr/lang/tel.traineddata.gz',
  '/ocr/lang/tam.traineddata.gz',
]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(OFFLINE_ASSETS)
    const shell = await cache.match('/')
    if (shell) {
      const html = await shell.clone().text()
      const buildAssets = Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g), (match) => match[1])
      if (buildAssets.length) await cache.addAll([...new Set(buildAssets)])
    }
  })())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  event.respondWith((async () => {
    const pathname = url.pathname
    const cached = await caches.match(pathname, { ignoreSearch: true })
    const immutableAsset = pathname.startsWith('/assets/') || pathname.startsWith('/ocr/')
    if (immutableAsset && cached) return cached
    try {
      const response = await fetch(event.request)
      if (response.ok) {
        const cache = await caches.open(CACHE)
        await cache.put(pathname, response.clone())
      }
      return response
    } catch {
      if (cached) return cached
      if (event.request.mode === 'navigate') return caches.match('/')
      return new Response('Offline asset unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    }
  })())
})
