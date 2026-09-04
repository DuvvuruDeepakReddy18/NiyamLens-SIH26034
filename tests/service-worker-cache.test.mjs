import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const ORIGIN = 'https://niyamlens.example'

function workerHarness({ fetchImpl = async () => new Response('network'), matchImpl = async () => undefined, putImpl = async () => {}, openError = null } = {}) {
  const listeners = new Map()
  const calls = { fetch: [], put: [], open: [], addAll: [], delete: [], claimed: 0 }
  const cache = {
    put: async (...args) => { calls.put.push(args); return putImpl(...args) },
    match: matchImpl,
    addAll: async (assets) => { calls.addAll.push([...assets]) },
  }
  vm.runInNewContext(source, {
    URL, Response,
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type, listener) => listeners.set(type, listener),
      skipWaiting() {},
      clients: { claim: async () => { calls.claimed += 1 } },
    },
    caches: {
      match: matchImpl,
      open: async (name) => { calls.open.push(name); if (openError) throw openError; return cache },
      keys: async () => ['niyamlens-shell-v9', 'niyamlens-shell-v10', 'unrelated-cache'],
      delete: async (name) => { calls.delete.push(name); return true },
    },
    fetch: async (request) => { calls.fetch.push(request); return fetchImpl(request) },
  }, { filename: 'public/sw.js' })

  return {
    calls,
    async dispatchFetch(pathname, { method = 'GET', headers = {}, mode = 'cors' } = {}) {
      let intercepted = false
      let response
      const request = { url: new URL(pathname, ORIGIN).href, method, headers: new Headers(headers), mode }
      listeners.get('fetch')({ request, respondWith: (pending) => { intercepted = true; response = pending } })
      return { intercepted, response: await response }
    },
    async dispatchLifecycle(type) {
      const pending = []
      listeners.get(type)({ waitUntil: (value) => pending.push(value) })
      await Promise.all(pending)
    },
  }
}

test('successful network response survives cache.put quota failure unchanged', async () => {
  const network = new Response('model bytes', { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'X-Source': 'network' } })
  const harness = workerHarness({ fetchImpl: async () => network, putImpl: async () => { throw new Error('QuotaExceededError') } })
  const { response } = await harness.dispatchFetch('/ocr/paddle-v1/models/PP-OCRv6_small_det_onnx_infer.tar')
  assert.equal(response, network)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-Source'), 'network')
  assert.equal(await response.text(), 'model bytes')
  assert.equal(harness.calls.put.length, 1)
})

test('cache-open failure cannot replace a successful network response', async () => {
  const network = new Response('current shell')
  const harness = workerHarness({ fetchImpl: async () => network, openError: new Error('CacheStorage unavailable') })
  assert.equal((await harness.dispatchFetch('/')).response, network)
})

test('cache lookup failure does not prevent a successful network request', async () => {
  const network = new Response('fresh asset')
  const harness = workerHarness({ fetchImpl: async () => network, matchImpl: async () => { throw new Error('Cache read failed') } })
  assert.equal((await harness.dispatchFetch('/ocr/worker.min.js')).response, network)
  assert.equal(harness.calls.fetch.length, 1)
})

test('cached immutable OCR assets remain available without any network call', async () => {
  const cached = new Response('cached model')
  const harness = workerHarness({ matchImpl: async () => cached, fetchImpl: async () => { throw new Error('Network should not run') } })
  assert.equal((await harness.dispatchFetch('/ocr/paddle-v1/models/model.tar?cache-bust=1')).response, cached)
  assert.equal(harness.calls.fetch.length, 0)
})

test('network failure still returns an existing non-immutable cache entry', async () => {
  const cached = new Response('offline icon')
  const harness = workerHarness({ matchImpl: async () => cached, fetchImpl: async () => { throw new Error('Offline') } })
  assert.equal((await harness.dispatchFetch('/icon.svg')).response, cached)
  assert.equal(harness.calls.fetch.length, 1)
})

test('uncached offline navigation can fall back to the cached app shell', async () => {
  const shell = new Response('cached app shell')
  const harness = workerHarness({ matchImpl: async (key) => key === '/' ? shell : undefined, fetchImpl: async () => { throw new Error('Offline') } })
  assert.equal((await harness.dispatchFetch('/inspection/123', { mode: 'navigate' })).response, shell)
})

test('uncached offline assets return a deliberate 503, not a false success', async () => {
  const harness = workerHarness({ fetchImpl: async () => { throw new Error('Offline') } })
  const { response } = await harness.dispatchFetch('/ocr/paddle-v1/not-downloaded.tar')
  assert.equal(response.status, 503)
  assert.match(await response.text(), /Offline asset unavailable/)
})

test('offline navigation without a readable cached shell returns a proper 503 response', async () => {
  for (const matchImpl of [async () => undefined, async () => { throw new Error('CacheStorage unavailable') }]) {
    const harness = workerHarness({ matchImpl, fetchImpl: async () => { throw new Error('Offline') } })
    const { response } = await harness.dispatchFetch('/inspection/123', { mode: 'navigate' })
    assert.equal(response.status, 503)
  }
})

test('API, authorization, non-GET and other-origin requests bypass shell interception', async () => {
  const harness = workerHarness()
  for (const [url, options] of [
    ['/api/cases', {}],
    ['/private', { headers: { Authorization: 'Bearer example-test-token' } }],
    ['/upload', { method: 'POST' }],
    ['https://external.example/asset', {}],
  ]) assert.equal((await harness.dispatchFetch(url, options)).intercepted, false)
  assert.equal(harness.calls.fetch.length, 0)
  assert.equal(harness.calls.put.length, 0)
})

test('network HTTP errors are returned unchanged and never cached', async () => {
  const network = new Response('not found', { status: 404 })
  const harness = workerHarness({ fetchImpl: async () => network })
  assert.equal((await harness.dispatchFetch('/missing')).response, network)
  assert.equal(harness.calls.put.length, 0)
})

test('cache v10 retains lazy optional Paddle assets and removes only old app caches', async () => {
  const harness = workerHarness()
  await harness.dispatchLifecycle('install')
  assert.deepEqual(harness.calls.open, ['niyamlens-shell-v10'])
  assert(harness.calls.addAll.flat().includes('/'))
  assert(!harness.calls.addAll.flat().some((asset) => asset.includes('/paddle-v1/')))
  await harness.dispatchLifecycle('activate')
  assert.deepEqual(harness.calls.delete, ['niyamlens-shell-v9'])
  assert.equal(harness.calls.claimed, 1)
})
