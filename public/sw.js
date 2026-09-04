const WORKER_PROTOCOL = 2
const WORKER_VERSION = '14'
const SHELL_CACHE = `niyamlens-shell-v${WORKER_VERSION}`
const OCR_CACHE = 'niyamlens-ocr-v1'
const OCR_PACK_VERSION = 1
const SHELL_ASSETS = [
  '/',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/manifest.webmanifest',
]
const OCR_PACK_ASSETS = [
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
const OCR_READY_SENTINEL = '/__niyamlens/offline-ocr-ready'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    await cache.addAll(SHELL_ASSETS)
    const shell = await cache.match('/')
    if (shell) {
      const html = await shell.clone().text()
      const buildAssets = Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g), (match) => match[1])
      if (buildAssets.length) await cache.addAll([...new Set(buildAssets)])
    }
  })())
  self.skipWaiting()
})

self.addEventListener('message', (event) => {
  if (!['NIYAMLENS_VERIFY_OFFLINE', 'NIYAMLENS_CACHE_OCR_PACK'].includes(event.data?.type)) return
  const reply = (payload) => event.ports?.[0]?.postMessage(payload)
  event.waitUntil((async () => {
    try {
      if (event.data.type === 'NIYAMLENS_VERIFY_OFFLINE') {
        const [shellReady, ocr] = await Promise.all([verifyShell(), verifyOcrPack()])
        reply({ type: 'verification', protocol: WORKER_PROTOCOL, version: WORKER_VERSION, shellReady, ...ocr })
        return
      }
      const cache = await caches.open(OCR_CACHE)
      for (let index = 0; index < OCR_PACK_ASSETS.length; index += 1) {
        const asset = OCR_PACK_ASSETS[index]
        const response = await fetch(asset, { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${asset}`)
        await cache.put(asset, response)
        reply({ type: 'progress', completed: index + 1, total: OCR_PACK_ASSETS.length })
      }
      await cache.put(OCR_READY_SENTINEL, new Response(JSON.stringify({ version: OCR_PACK_VERSION, cachedAt: new Date().toISOString(), assets: OCR_PACK_ASSETS.length }), { headers: { 'Content-Type': 'application/json' } }))
      reply({ type: 'complete', protocol: WORKER_PROTOCOL, version: WORKER_VERSION, completed: OCR_PACK_ASSETS.length, total: OCR_PACK_ASSETS.length })
    } catch (error) {
      reply({ type: 'error', message: error?.message || 'Offline OCR pack could not be cached.' })
    }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) =>
        (key.startsWith('niyamlens-shell-') && key !== SHELL_CACHE)
        || (key.startsWith('niyamlens-ocr-') && key !== OCR_CACHE),
      ).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function verifyShell() {
  const cache = await caches.open(SHELL_CACHE)
  const shellResponses = await Promise.all(SHELL_ASSETS.map((asset) => cache.match(asset)))
  if (shellResponses.some((response) => !response)) return false
  const html = await shellResponses[0].clone().text()
  const buildAssets = Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g), (match) => match[1])
  if (!buildAssets.length) return false
  const buildResponses = await Promise.all([...new Set(buildAssets)].map((asset) => cache.match(asset)))
  return buildResponses.every(Boolean)
}

async function verifyOcrPack() {
  const cache = await caches.open(OCR_CACHE)
  const [sentinel, ...assets] = await Promise.all([OCR_READY_SENTINEL, ...OCR_PACK_ASSETS].map((asset) => cache.match(asset)))
  let markerValid = false
  if (sentinel) {
    try {
      const marker = await sentinel.clone().json()
      markerValid = marker?.version === OCR_PACK_VERSION && marker?.assets === OCR_PACK_ASSETS.length
    } catch {
      markerValid = false
    }
  }
  const completed = assets.filter(Boolean).length
  return { ocrReady: markerValid && completed === OCR_PACK_ASSETS.length, completed, total: OCR_PACK_ASSETS.length }
}

async function refreshShellFromNavigation(response) {
  const html = await response.clone().text()
  const buildAssets = [...new Set(Array.from(html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g), (match) => match[1]))]
  if (!buildAssets.length) return false
  const currentAssets = await Promise.all(buildAssets.map(async (asset) => {
    const assetResponse = await fetch(asset, { cache: 'no-store' })
    if (!assetResponse.ok) throw new Error(`Shell dependency HTTP ${assetResponse.status}`)
    return [asset, assetResponse]
  }))
  const cache = await caches.open(SHELL_CACHE)
  for (const [asset, assetResponse] of currentAssets) await cache.put(asset, assetResponse)
  await cache.put('/', response)
  return true
}

async function matchCached(pathname, options) {
  try {
    return await caches.match(pathname, options)
  } catch {
    // CacheStorage is optional: disabled storage must not prevent network access.
    return undefined
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Never retain authenticated responses, API records or signed evidence in the shell cache.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.headers.has('authorization')) return
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    const exchange = fetch(event.request).then((response) => ({ client: response.clone(), cache: response.clone(), ok: response.ok }))
    event.waitUntil(exchange.then(({ cache, ok }) => ok ? refreshShellFromNavigation(cache) : false).catch(() => false))
    event.respondWith((async () => {
      try { return (await exchange).client }
      catch {
        const shell = await matchCached('/')
        return shell || new Response('Offline asset unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      }
    })())
    return
  }
  event.respondWith((async () => {
    const pathname = url.pathname
    const cached = await matchCached(pathname, { ignoreSearch: true })
    const immutableAsset = pathname.startsWith('/assets/') || pathname.startsWith('/ocr/')
    if (immutableAsset && cached) return cached
    try {
      const response = await fetch(event.request)
      const cacheable = immutableAsset || ['/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/manifest.webmanifest'].includes(pathname)
      if (response.ok && cacheable) {
        try {
          const cache = await caches.open(pathname.startsWith('/ocr/') ? OCR_CACHE : SHELL_CACHE)
          await cache.put(pathname, response.clone())
        } catch {
          // Quota/storage failures must not turn a valid network response into 503.
          // Large optional OCR assets remain network-usable without being cached.
        }
      }
      return response
    } catch {
      if (cached) return cached
      if (event.request.mode === 'navigate') {
        const shell = await matchCached('/')
        if (shell) return shell
      }
      return new Response('Offline asset unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    }
  })())
})
