import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWorkspaceClient } from '../src/lib/workspaceClient.mjs'

const ORG = 'workspace-one'
const USER = 'officer-a'
const nativeFetch = globalThis.fetch
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4e8AAAAASUVORK5CYII=', 'base64')
const hash = createHash('sha256').update(png).digest('hex')
const originalPath = `org/user/case/panel/original-${hash}`
const analysisPath = `org/user/case/panel/analysis-${hash}`
const record = () => ({ id: 'test-case-123', evidenceItems: [{ id: 'panel-one', originalPath, analysisPath, sha256: hash }] })
const setup = () => {
  let session = { user: { id: USER }, access_token: 'token-a' }
  const client = { auth: { getSession: async () => ({ data: { session } }) } }
  return { client, api: createWorkspaceClient(client, ORG, USER), switchUser: (id) => { session = id ? { user: { id }, access_token: `token-${id}` } : null } }
}
const withFetch = async (fetcher, action) => {
  globalThis.fetch = fetcher
  try { return await action() } finally { globalThis.fetch = nativeFetch }
}
const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

test('workspace client rejects missing identity and cannot send an old user operation as the new user', async () => {
  const { client, api, switchUser } = setup()
  assert.throws(() => createWorkspaceClient(client, ORG), /bound/)
  switchUser('officer-b')
  let calls = 0
  await withFetch(async () => { calls++; return json({}) }, async () => {
    await assert.rejects(api.request('cases'), { status: 401 })
    await assert.rejects(api.transport({ kind: 'review', id: 'review', recordId: 'case', payload: {}, baseVersion: 1 }), { status: 401 })
  })
  assert.equal(calls, 0)
})

test('account switch during a request discards its response before callers can cache it', async () => {
  const { api, switchUser } = setup(); const started = deferred(); const response = deferred()
  await withFetch(async () => { started.resolve(); return response.promise }, async () => {
    const request = api.request('cases')
    await started.promise
    switchUser('officer-b')
    response.resolve(json({ records: [{ id: 'private-a' }] }))
    await assert.rejects(request, { status: 401 })
  })
})

test('cancellation aborts in-flight requests, StrictMode replay can restart, and disposal is permanent', async () => {
  const { api } = setup(); const started = deferred()
  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    started.resolve(options.signal)
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }), async () => {
    const pending = api.request('cases')
    const signal = await started.promise
    api.cancelPending()
    assert.equal(signal.aborted, true)
    await assert.rejects(pending, { status: 401 })
  })
  await withFetch(async () => json({ records: [] }), async () => {
    assert.deepEqual(await api.request('cases'), { records: [] })
    api.dispose()
    await assert.rejects(api.request('cases'), { status: 401 })
    api.cancelPending()
    await assert.rejects(api.request('cases'), { status: 401 })
  })
})

test('signed uploads are abortable and cancelled uploads never verify or seal a case', async () => {
  const { api } = setup(); const started = deferred(); const routes = []
  const item = record(); item.evidenceItems[0].originalUrl = `data:image/png;base64,${png.toString('base64')}`
  item.evidenceItems[0].analysisUrl = item.evidenceItems[0].originalUrl
  await withFetch(async (url, options) => {
    if (String(url).startsWith('data:')) return nativeFetch(url, options)
    routes.push(String(url))
    if (url === '/api/evidence') return json({ path: originalPath, uploadUrl: 'https://storage.example/upload?token=private', verified: false })
    assert.equal(options.method, 'PUT'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.headers['Content-Type'], 'image/png')
    return new Promise((_resolve, reject) => { started.resolve(); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }) })
  }, async () => {
    const pending = api.transport({ kind: 'seal', payload: item })
    await started.promise; api.dispose()
    await assert.rejects(pending, { status: 401 })
  })
  assert.deepEqual(routes, ['/api/evidence', 'https://storage.example/upload?token=private'])
})

test('cloud-only exports contain bounded, hash-verified image bytes and never signed URLs', async () => {
  const { api } = setup(); let apiCalls = 0; let privateCalls = 0
  const source = record(); source.evidenceItems[0].originalUrl = 'https://expired.example/old-token'
  await withFetch(async (url, options) => {
    if (String(url).startsWith('/api/evidence?')) {
      apiCalls++
      assert.equal(options.headers.Authorization, 'Bearer token-a'); assert.equal(options.cache, 'no-store')
      return json({ url: `https://storage.example/image?token=secret-${apiCalls}` })
    }
    privateCalls++
    assert.ok(String(url).startsWith('https://storage.example/'))
    assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer')
    assert.equal(options.headers, undefined)
    return new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } })
  }, async () => {
    const result = await api.openRecord(source)
    assert.equal(apiCalls, 2); assert.equal(privateCalls, 2)
    assert.match(result.evidenceItems[0].originalUrl, /^data:image\/png;base64,/)
    assert.match(result.evidenceItems[0].analysisUrl, /^data:image\/png;base64,/)
    assert.deepEqual(Buffer.from(result.evidenceItems[0].originalUrl.split(',')[1], 'base64'), png)
    assert.doesNotMatch(JSON.stringify(result), /https:|token=|secret-/)
    assert.equal(source.evidenceItems[0].originalUrl, 'https://expired.example/old-token')
  })
})

test('a changed original image cannot be exported under its registered SHA-256', async () => {
  const { api } = setup(); const source = record(); source.evidenceItems[0].sha256 = '0'.repeat(64)
  await withFetch(async (url) => String(url).startsWith('/api/') ? json({ url: 'https://storage.example/image' }) : new Response(png, { headers: { 'content-type': 'image/png' } }), async () => {
    await assert.rejects(api.openRecord(source), { status: 422, message: /Original evidence failed SHA-256/ })
  })
})

test('registered analysis digest is checked as well as the original', async () => {
  const { api } = setup(); const source = record(); source.evidenceItems[0].analysisPath = `org/analysis-${'0'.repeat(64)}`
  await withFetch(async (url) => String(url).startsWith('/api/') ? json({ url: 'https://storage.example/image' }) : new Response(png, { headers: { 'content-type': 'image/png' } }), async () => {
    await assert.rejects(api.openRecord(source), { status: 422, message: /Analysis evidence failed SHA-256/ })
  })
})

test('oversized and non-image private responses are rejected rather than embedded', async () => {
  for (const [headers, status] of [[{ 'content-type': 'image/png', 'content-length': String(16 * 1024 * 1024) }, 413], [{ 'content-type': 'text/html' }, 422]]) {
    const { api } = setup()
    await withFetch(async (url) => String(url).startsWith('/api/') ? json({ url: 'https://storage.example/image' }) : new Response(png, { headers }), async () => {
      await assert.rejects(api.openRecord(record()), { status })
    })
  }
})

test('opening locally cached evidence still verifies its bytes without requesting new signed URLs', async () => {
  const { api } = setup(); const source = record()
  const localImage = `data:image/png;base64,${png.toString('base64')}`
  Object.assign(source.evidenceItems[0], { originalUrl: localImage, analysisUrl: localImage })
  await withFetch(async (url, options) => { assert.ok(String(url).startsWith('data:')); return nativeFetch(url, options) }, async () => {
    const result = await api.openRecord(source)
    assert.equal(result.evidenceItems[0].originalUrl, localImage)
  })
})
