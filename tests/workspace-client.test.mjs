import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWorkspaceClient, mergeCloudRecord } from '../src/lib/workspaceClient.mjs'
import { RULE_PACK } from '../src/lib/rules.mjs'

const ORG = 'workspace-one'
const USER = 'officer-a'
const nativeFetch = globalThis.fetch
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4e8AAAAASUVORK5CYII=', 'base64')
const hash = createHash('sha256').update(png).digest('hex')
const originalPath = `org/user/case/panel/original-${hash}`
const analysisPath = `org/user/case/panel/analysis-${hash}`
const record = () => ({ id: 'test-case-123', rulePack: RULE_PACK.id, evidenceItems: [{ id: 'panel-one', originalPath, analysisPath, sha256: hash }] })
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

test('explicit cloud verification fetches fresh metadata and both objects despite valid cached images', async () => {
  const { api } = setup(); const cached = record(); const fresh = record(); const calls = []
  const localImage = `data:image/png;base64,${png.toString('base64')}`
  Object.assign(cached, { serverVersion: 1, text: 'stale cached text' })
  Object.assign(cached.evidenceItems[0], { originalUrl: localImage, analysisUrl: localImage })
  Object.assign(fresh, { serverVersion: 2, serverPayloadHash: 'a'.repeat(64), serverSealedAt: '2026-09-04T14:00:00Z', syncState: 'synced', text: 'fresh server text' })
  await withFetch(async (url, options) => {
    calls.push(String(url)); assert.equal(options.cache, 'no-store')
    assert.equal(String(url).startsWith('data:'), false)
    if (url === `/api/cases?id=${cached.id}`) return json({ record: fresh })
    if (String(url).startsWith('/api/evidence?')) return json({ url: 'https://storage.example/fresh' })
    assert.equal(options.headers, undefined); assert.equal(options.credentials, 'omit')
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  }, async () => {
    const opened = await api.openRecord(cached, { source: 'cloud' })
    assert.equal(opened.serverVersion, 2); assert.equal(opened.text, 'fresh server text')
    assert.equal(opened.evidenceItems[0].originalUrl, localImage)
    assert.equal(cached.text, 'stale cached text'); assert.equal(cached.serverVersion, 1)
    assert.equal(calls.length, 5); assert.equal(calls.filter(url => url.startsWith('/api/evidence?')).length, 2)
  })
})

test('explicit cloud verification never falls back to cached bytes after denial or invalid fresh receipt', async () => {
  for (const response of [
    () => new Response(JSON.stringify({ error: 'Access denied.' }), { status: 403 }),
    () => json({ record: { ...record(), id: 'another-case' } }),
    () => json({ record: { ...record(), serverVersion: 1, serverPayloadHash: ['a'.repeat(64)], serverSealedAt: '2026-09-04T14:00:00Z', syncState: 'synced' } }),
    () => json({ record: { ...record(), serverVersion: 1, serverPayloadHash: 'a'.repeat(64), serverSealedAt: '2026-09-04T14:00:00Z', syncState: 'pending' } }),
  ]) {
    const { api } = setup(); const source = record(); let calls = 0
    const image = `data:image/png;base64,${png.toString('base64')}`
    Object.assign(source.evidenceItems[0], { originalUrl: image, analysisUrl: image })
    await withFetch(async (url) => { calls++; assert.equal(url, `/api/cases?id=${source.id}`); return response() }, async () => {
      await assert.rejects(api.openRecord(source, { source: 'cloud' }))
    })
    assert.equal(calls, 1)
  }
})

test('cloud verification stops on a fresh-object hash failure rather than using its valid cached copy', async () => {
  const { api } = setup(); const source = record(); const fresh = { ...record(), serverVersion: 1, serverPayloadHash: 'a'.repeat(64), serverSealedAt: '2026-09-04T14:00:00Z', syncState: 'synced' }
  const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1
  Object.assign(source.evidenceItems[0], { originalUrl: `data:image/png;base64,${png.toString('base64')}`, analysisUrl: `data:image/png;base64,${png.toString('base64')}` })
  await withFetch(async (url) => url.startsWith('/api/cases?') ? json({ record: fresh }) : url.startsWith('/api/evidence?') ? json({ url: 'https://storage.example/fresh' }) : new Response(corrupt, { headers: { 'content-type': 'image/png' } }), async () => {
    await assert.rejects(api.openRecord(source, { source: 'cloud' }), { status: 422, message: /Original evidence failed SHA-256/ })
  })
})

test('a report-specific cancellation does not cancel the workspace or allow a late report', async () => {
  const { api } = setup(); const controller = new AbortController(); const started = deferred()
  await withFetch((_url, options) => new Promise((_resolve, reject) => {
    started.resolve(); options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }), async () => {
    const pending = api.openRecord(record(), { source: 'cloud', signal: controller.signal })
    await started.promise; controller.abort(new DOMException('Cancelled', 'AbortError'))
    await assert.rejects(pending); assert.equal(api.signal.aborted, false)
  })
  await withFetch(async () => json({ records: [] }), async () => { assert.deepEqual(await api.request('cases'), { records: [] }) })
  await assert.rejects(api.openRecord(record(), { source: 'typo' }), { status: 422 })
})

test('managed seal transmits exact OCR passes and bounded source regions but excludes image word boxes', async () => {
  const { api } = setup(); const source = record()
  source.regions = [{ id: 'mrp', label: 'MRP', panelId: source.evidenceItems[0].id, bbox: { x0: 1, y0: 2, x1: 30, y1: 12 }, pageWidth: 40, pageHeight: 20 }]
  Object.assign(source.evidenceItems[0], { originalUrl: `data:image/png;base64,${png.toString('base64')}`, analysisUrl: `data:image/png;base64,${png.toString('base64')}`, ocrProvider: 'tesseract.js', ocrPasses: [{ id: 'raw:1', text: ' MRP:22.00\r\n', provider: 'tesseract.js' }], ocrWords: [] })
  let submitted
  await withFetch(async (url, options) => {
    if (String(url).startsWith('data:')) return nativeFetch(url, options)
    if (url === '/api/evidence') return json({ path: JSON.parse(options.body).kind === 'original' ? originalPath : analysisPath, verified: true })
    assert.equal(url, '/api/cases')
    submitted = JSON.parse(options.body).record
    return json({ record: submitted })
  }, async () => { await api.transport({ kind: 'seal', payload: source }) })
  assert.deepEqual(submitted.evidenceItems[0].ocrPasses, source.evidenceItems[0].ocrPasses)
  assert.equal(submitted.evidenceItems[0].ocrWords, undefined)
  assert.deepEqual(submitted.regions, source.regions)
})

test('invalid OCR history fails before any private image upload', async () => {
  const { api } = setup(); const source = record(); let requests = 0
  source.evidenceItems[0].ocrPasses = [{ id: 'duplicate', text: '40' }, { id: 'duplicate', text: '48' }]
  await withFetch(async () => { requests++; return json({}) }, async () => {
    await assert.rejects(api.transport({ kind: 'seal', payload: source }), { status: 422, message: /Duplicate/ })
  })
  assert.equal(requests, 0)
})

test('an old or missing queued rule pack is retained and blocked before all uploads', async () => {
  for (const rulePack of ['LMPC-OLD', undefined]) {
    const { api } = setup(); const source = { ...record(), rulePack }; let calls = 0
    await withFetch(async () => { calls++; return json({}) }, async () => {
      await assert.rejects(api.transport({ kind: 'seal', payload: source }), { status: 409, code: 'RULE_PACK_MISMATCH', message: /original seal is retained/ })
    })
    assert.equal(calls, 0); assert.equal(source.rulePack, rulePack)
  }
})

test('newer summary invalidates detail history while equal or older responses retain complete cached evidence', () => {
  const complete = { ...record(), serverVersion: 3, recordKind: 'detail', text: 'raw capture', reviewHistory: [{ id: 'v3', status: 'non_compliant' }] }
  const summary = { id: complete.id, serverVersion: 3, recordKind: 'summary', evidenceItems: [], reviewHistory: [{ id: 'v3', status: 'non_compliant' }] }
  assert.equal(mergeCloudRecord(complete, summary), complete)
  assert.equal(mergeCloudRecord(complete, { ...summary, serverVersion: 2 }), complete)
  const newer = mergeCloudRecord(complete, { ...summary, serverVersion: 4, reviewHistory: [{ id: 'v4', status: 'compliant' }] })
  assert.equal(newer.detailsStale, true); assert.equal(newer.recordKind, 'summary')
  assert.equal(newer.evidenceItems, complete.evidenceItems); assert.equal(newer.text, complete.text)
  assert.equal(newer.reviewHistory[0].id, 'v4')
})

test('summary and stale-detail records hydrate on demand before review and cannot accept older server details', async () => {
  const { api } = setup()
  const summary = { id: 'test-case-123', recordKind: 'summary', serverVersion: 3, evidenceItems: [] }
  const fresh = { ...record(), serverVersion: 3, serverPayloadHash: 'a'.repeat(64), serverSealedAt: '2026-09-05', syncState: 'synced', text: 'full transcript', reviewHistory: [{ id: 'r1' }, { id: 'r2' }] }
  let calls = 0
  await withFetch(async (url) => { calls++; assert.equal(url, '/api/cases?id=test-case-123'); return json({ record: fresh }) }, async () => {
    const detail = await api.getRecordMetadata(summary)
    assert.equal(detail.recordKind, 'detail'); assert.equal(detail.detailsStale, false)
    assert.equal(detail.text, fresh.text); assert.equal(detail.reviewHistory.length, 2)
    assert.equal(await api.getRecordMetadata(detail), detail); assert.equal(calls, 1)
    await assert.rejects(api.getRecordMetadata({ ...summary, serverVersion: 4 }), { status: 409, message: /older case version/ })
  })
  await withFetch(async () => json({ record: { ...fresh, recordKind: 'summary' } }), async () => {
    await assert.rejects(api.getRecordMetadata(summary), { status: 422 })
  })
})

test('server rule mismatch code survives the transport boundary for explicit reassessment', async () => {
  const { api } = setup()
  await withFetch(async () => new Response(JSON.stringify({ error: 'Reassessment required.', code: 'RULE_PACK_MISMATCH' }), { status: 409 }), async () => {
    await assert.rejects(api.request('cases'), { status: 409, code: 'RULE_PACK_MISMATCH' })
  })
})
