import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import 'fake-indexeddb/auto'
import { validateCase } from '../server/caseService.mjs'
import { validateImageBytes, MAX_IMAGE_BYTES } from '../server/imageValidation.mjs'
import { pageOffset, pageResult } from '../server/pagination.mjs'
import { createOperation, createSyncEngine } from '../src/lib/syncEngine.mjs'
import { createEvidenceStore } from '../src/lib/storage.mjs'
import { mergeCloudRecord } from '../src/lib/workspaceClient.mjs'
import { RULE_PACK } from '../src/lib/rules.mjs'
import casesHandler from '../api/cases.js'
import evidenceHandler from '../api/evidence.js'
import { adminClient, failure, uuid, caseId } from '../server/security.mjs'
import { appendAuditEvent } from '../src/lib/audit.mjs'
import { ocrProvenance, restoreEvidencePolicy } from '../src/lib/inspectionWorkflow.mjs'

const org = '10000000-0000-4000-8000-000000000001'
const user = { id: '20000000-0000-4000-8000-000000000001', email: 'regression@example.test' }
const panelId = '30000000-0000-4000-8000-000000000001'
const context = { user, member: { role: 'officer' } }
const base = () => ({ id: 'regression-case-123', meta: { quantity: 100, unit: 'g' }, text: 'TEST SOAP', rawOcrText: '', createdAt: '2026-09-04', sealedAt: '2026-09-04', rulePack: RULE_PACK.id, auditChain: [], evidenceItems: [{ id: panelId, originalPath: 'private/original', analysisPath: 'private/analysis', sha256: 'a'.repeat(64) }] })
const response = () => ({ setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })
const request = (body) => ({ method: 'POST', body, headers: { authorization: 'Bearer test-user', 'x-workspace-id': org } })
async function providerMock(handle, action) {
  const previous = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.SUPABASE_URL = 'http://127.0.0.1:9999'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-not-real'
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'http://127.0.0.1:9999')
    if (url.pathname === '/auth/v1/user') return json(user)
    if (url.pathname === '/rest/v1/memberships') return json({ user_id: user.id, org_id: org, active: true, role: 'officer' })
    if (url.pathname === '/rest/v1/rpc/consume_quota') return json(true)
    return handle(url, options, json)
  }
  try { return await action() } finally {
    globalThis.fetch = previous.fetch
    for (const [key, value] of [['SUPABASE_URL', previous.url], ['SUPABASE_SERVICE_ROLE_KEY', previous.key]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
}

test('case validation rejects malformed nested structures with 4xx before data-provider access', async () => {
  const variants = [
    { auditChain: {} }, { auditChain: [null] }, { evidenceItems: [null] }, { rawOcrText: {} },
    { evidenceItems: [base().evidenceItems[0], base().evidenceItems[0]] },
    { meta: { quantity: 'Infinity', unit: 'g' } }, { meta: { quantity: NaN, unit: 'g' } },
    { evidenceItems: [{ ...base().evidenceItems[0], perspective: { points: [null] } }] },
    { meta: { panelMeasurements: { missing: { referencePx: 20 } } } },
    { meta: { evidencePanelIds: ['fake-panel'], placementReviews: { mrp: { state: 'inside_pdp', panelId: 'fake-panel', value: '100', reason: 'Forged panel reference.' } } } },
  ]
  await providerMock((url) => { throw new Error(`Unexpected data access: ${url.pathname}`) }, async () => {
    for (const patch of variants) { const res = response(); await casesHandler(request({ record: { ...base(), ...patch } }), res); assert.equal(res.code, 400, JSON.stringify(patch)) }
  })
  const noEvidence = { ...base(), evidenceItems: [] }
  assert.throws(() => validateCase(noEvidence, context), { status: 422 })
  assert.throws(() => validateCase({ ...base(), text: 'a'.repeat(100001) }, context), { status: 413 })
})

test('server derives physical panel scope and permits unverified OCR provenance without manufacturing confidence', () => {
  const record = validateCase({ ...base(), meta: { quantity: 100, unit: 'g', evidencePanelIds: ['self-asserted-panel'], ocrSource: 'none', ocrConfidence: null, ocrEngineConfidence: null, ocrCompletedAt: null } }, context)
  assert.deepEqual(record.meta.evidencePanelIds, [panelId])
  assert.equal(record.meta.ocrConfidence, null)
  assert.equal(record.meta.enforceEvidenceReview, true)
  assert.equal(record.result.status, 'manual_review')
})

test('server retains only bounded source regions tied to extracted fields and attached panels', () => {
  const region = { id: 'mrp', label: 'Client-controlled fake label', panelId, bbox: { x0: 10, y0: 20, x1: 110, y1: 48 }, pageWidth: 640, pageHeight: 480, confidence: 82, matchScore: .78, text: 'MRP Rs. 40' }
  const record = validateCase({ ...base(), text: 'MRP Rs. 40 inclusive of all taxes', regions: [region] }, context)
  assert.deepEqual(record.regions, [{ ...region, label: 'Maximum Retail Price' }])
  for (const invalid of [
    { ...region, panelId: '40000000-0000-4000-8000-000000000001' },
    { ...region, id: 'packDate' },
    { ...region, bbox: { ...region.bbox, x1: 700 } },
    { ...region, matchScore: 2 },
  ]) assert.throws(() => validateCase({ ...base(), text: 'MRP Rs. 40 inclusive of all taxes', regions: [invalid] }, context), { status: 400 })
})

test('server and UI reject default OCR confidence without both a recorded completed run and raw transcript', async () => {
  const completed = await appendAuditEvent([], 'ocr_completed', { confidence: 95 }, user.id)
  const sealedOnly = await appendAuditEvent([], 'inspection_sealed', {}, user.id)
  const fixture = { ...base(), meta: { quantity: 100, unit: 'g', ocrSource: 'local', ocrConfidence: 95, ocrEngineConfidence: 98 } }
  for (const patch of [
    { rawOcrText: '', auditChain: [] },
    { rawOcrText: 'TEST SOAP', auditChain: [] },
    { rawOcrText: '', auditChain: completed },
    { rawOcrText: 'TEST SOAP', auditChain: sealedOnly },
    { rawOcrText: 'TEST SOAP', auditChain: completed, meta: { ...fixture.meta, ocrSource: 'none' } },
    // Canonical empty client timeline must take precedence, just like the UI.
    { rawOcrText: 'TEST SOAP', auditChain: completed, clientAuditChain: [] },
  ]) {
    const input = { ...fixture, ...patch }; const record = validateCase(input, context)
    assert.equal(ocrProvenance(input).hasRun, false)
    assert.equal(restoreEvidencePolicy(input).ocrConfidence, null)
    assert.equal(record.meta.ocrConfidence, null); assert.equal(record.meta.ocrEngineConfidence, null)
    assert.equal(record.meta.ocrSource, 'none'); assert.equal(record.ocrProvenance.hasRun, false)
    assert.equal(record.result.checks.find((check) => check.id === 'ocrConfidence').status, 'review')
    assert.notEqual(record.result.status, 'compliant')
  }
})

test('recorded OCR is preserved as an unverified client observation using either supported timeline name', async () => {
  const completed = await appendAuditEvent([], 'ocr_completed', { confidence: 95 }, user.id)
  const fixture = { ...base(), rawOcrText: 'TEST SOAP', meta: { quantity: 100, unit: 'g', ocrSource: 'local', ocrConfidence: 95, ocrEngineConfidence: 98 } }
  for (const timeline of [{ auditChain: completed }, { clientAuditChain: completed }]) {
    const record = validateCase({ ...fixture, ...timeline }, context)
    assert.equal(record.meta.ocrConfidence, 95); assert.equal(record.meta.ocrEngineConfidence, 98)
    assert.equal(record.meta.ocrCompletedAt, completed[0].at)
    assert.equal(record.ocrProvenance.hasRun, true); assert.equal(record.clientAuditUntrusted, true)
    assert.equal(record.ocrProvenance.clientReported, true); assert.equal(record.ocrProvenance.independentlyVerified, false)
  }
  const numericString = validateCase({ ...fixture, auditChain: completed, meta: { ...fixture.meta, ocrConfidence: '95' } }, context)
  assert.equal(numericString.meta.ocrConfidence, null)
  assert.equal(numericString.result.checks.find((check) => check.id === 'ocrConfidence').status, 'review')
})

test('case metadata complexity and UTF-8 byte size are bounded before serialization/evaluation', () => {
  let nested = {}
  for (let i = 0; i < 30; i++) nested = { nested }
  assert.throws(() => validateCase({ ...base(), extra: nested }, context), { status: 413 })
  assert.throws(() => validateCase({ ...base(), extra: 'ఆ'.repeat(650000) }, context), { status: 413 })
  assert.throws(() => validateCase({ ...base(), meta: JSON.parse('{"__proto__":{"poison":true}}') }, context), { status: 400 })
})

test('image validation fully decodes JPEG, PNG and WebP while rejecting corrupt headers and truncated pixels', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#25784d' } }).toFormat(format).toBuffer()
    assert.deepEqual(await validateImageBytes(bytes, `image/${format}`), { width: 32, height: 24, mime: `image/${format}` })
    await assert.rejects(validateImageBytes(bytes.subarray(0, Math.floor(bytes.length / 2)), `image/${format}`), { status: 422 })
  }
  await assert.rejects(validateImageBytes(Buffer.from([255, 216, 255]), 'image/jpeg'), { status: 422 })
  await assert.rejects(validateImageBytes(Buffer.from('<svg></svg>'), 'image/svg+xml'), { status: 422 })
})

test('decoder enforces byte, axis and total pixel bounds before accepting evidence', async () => {
  await assert.rejects(validateImageBytes(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/jpeg'), { status: 413 })
  const wide = await sharp({ create: { width: 10001, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer()
  await assert.rejects(validateImageBytes(wide, 'image/png'), { status: 422 })
  const pixels = await sharp({ create: { width: 5001, height: 5000, channels: 3, background: '#ffffff' } }).png().toBuffer()
  await assert.rejects(validateImageBytes(pixels, 'image/png'), { status: 422 })
})

test('evidence registration rejects header-only files and never treats old registrations as a decoding bypass', async () => {
  const bytes = Buffer.from([255, 216, 255]); const sha256 = createHash('sha256').update(bytes).digest('hex')
  let inserts = 0; let existing = false
  await providerMock((url, options, json) => {
    if (url.pathname === '/rest/v1/evidence_objects') { if (options.method === 'POST') inserts++; return json(existing ? { path: 'existing' } : null) }
    if (url.pathname.startsWith('/storage/v1/object/')) return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } })
    throw new Error(`Unexpected provider request: ${url.pathname}`)
  }, async () => {
    const descriptor = { caseId: base().id, panelId, kind: 'original', sha256, bytes: 3, mime: 'image/jpeg' }
    for (const action of ['verify', 'prepare']) {
      existing = action === 'prepare'
      const res = response(); await evidenceHandler(request({ ...descriptor, action }), res)
      assert.equal(res.code, 422); assert.equal(inserts, 0)
    }
  })
})

test('direct sealing cannot bypass full decoding by reusing an older corrupt evidence registration', async () => {
  const bytes = Buffer.from([255, 216, 255]); const sha256 = createHash('sha256').update(bytes).digest('hex')
  let commits = 0
  await providerMock((url, options, json) => {
    if (url.pathname === '/rest/v1/evidence_objects') return json({ path: 'private/original', bytes: bytes.length, sha256, mime: 'image/jpeg' })
    if (url.pathname.startsWith('/storage/v1/object/')) return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } })
    if (url.pathname === '/rest/v1/rpc/commit_case') { commits++; return json(1) }
    throw new Error(`Unexpected provider request: ${url.pathname}`)
  }, async () => {
    const record = base(); record.evidenceItems[0].sha256 = sha256
    const res = response(); await casesHandler(request({ record }), res)
    assert.equal(res.code, 422); assert.equal(commits, 0)
  })
})

test('valid registered images seal successfully and private reads sign only fully revalidated images', async () => {
  let bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#336655' } }).jpeg().toBuffer()
  const record = base(); record.evidenceItems[0].sha256 = createHash('sha256').update(bytes).digest('hex')
  const row = { id: record.id, owner_id: user.id, payload: validateCase(record, context), version: 1, created_at: '2026-09-04', payload_hash: 'test-hash' }
  let commits = 0; let signed = 0
  await providerMock((url, options, json) => {
    if (url.pathname === '/rest/v1/evidence_objects') return json({ path: url.searchParams.get('path')?.slice(3) || 'private/original', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'image/jpeg' })
    if (url.pathname === '/rest/v1/rpc/commit_case') { commits++; return json(1) }
    if (url.pathname === '/rest/v1/cases') return json(row)
    if (url.pathname === '/rest/v1/case_reviews') return json([])
    if (url.pathname.startsWith('/storage/v1/object/sign/')) { signed++; return json({ signedURL: '/object/sign/evidence/private/original?token=test-only' }) }
    if (url.pathname.startsWith('/storage/v1/object/')) return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } })
    throw new Error(`Unexpected provider request: ${url.pathname}`)
  }, async () => {
    const sealed = response(); await casesHandler(request({ record }), sealed)
    assert.equal(sealed.code, 200); assert.equal(commits, 1)
    const get = { ...request(), method: 'GET', query: { caseId: record.id, path: 'private/original' } }
    const valid = response(); await evidenceHandler(get, valid); assert.equal(valid.code, 200); assert.equal(signed, 1)
    bytes = Buffer.from([255, 216, 255])
    const corrupt = response(); await evidenceHandler(get, corrupt); assert.equal(corrupt.code, 422); assert.equal(signed, 1)
  })
})

test('acknowledgement atomically preserves a review queued while its predecessor was in flight', async () => {
  const store = createEvidenceStore(`race-fixed-${crypto.randomUUID()}`)
  const first = createOperation('review', 'case-race', { reason: 'First review.' }, 1)
  await store.saveAndQueue({ id: 'case-race', syncState: 'pending-review', reviewHistory: [{ id: first.id }] }, first)
  let release; let entered
  const started = new Promise((done) => { entered = done })
  const engine = createSyncEngine({ store, transport: async () => { entered(); await new Promise((done) => { release = done }); return { record: mergeCloudRecord(await store.get('inspections', 'case-race'), { id: 'case-race', evidenceItems: [], serverVersion: 2, syncState: 'synced', reviewHistory: [{ id: first.id }] }) } } })
  const pending = engine.run(); await started
  const second = createOperation('review', 'case-race', { reason: 'Second review remains visible.' }, 1)
  await store.saveAndQueue({ id: 'case-race', syncState: 'pending-review', reviewHistory: [{ id: first.id }, { id: second.id }] }, second)
  release(); await pending
  const record = await store.get('inspections', 'case-race')
  assert.equal(record.syncState, 'pending-review'); assert.equal(record.reviewHistory.at(-1).id, second.id)
  assert.deepEqual((await store.all('outbox')).map((item) => item.id), [second.id])
})

test('outbox stores metadata without a second image copy and resolves original media only for transport', async () => {
  const store = createEvidenceStore(`compact-${crypto.randomUUID()}`)
  const image = `data:image/jpeg;base64,${'A'.repeat(100000)}`
  const record = { ...base(), imageUrl: image, evidenceItems: [{ ...base().evidenceItems[0], originalUrl: image, analysisUrl: image, perspectiveBaseUrl: image }] }
  const operation = createOperation('seal', record.id, record)
  await store.saveAndQueue(record, operation)
  const persisted = await store.get('outbox', operation.id)
  assert.doesNotMatch(JSON.stringify(persisted), /data:image/)
  assert.ok(JSON.stringify(persisted).length < 3000)
  assert.equal(persisted.payload.text, record.text)
  const engine = createSyncEngine({ store, transport: async (sent) => { assert.equal(sent.payload.evidenceItems[0].originalUrl, image); assert.equal(sent.payload.imageUrl, image); throw new Error('Offline') } })
  await engine.run()
  assert.doesNotMatch(JSON.stringify(await store.get('outbox', operation.id)), /data:image/)
  assert.equal((await store.get('inspections', record.id)).imageUrl, image)
})

test('an in-flight completion or failure cannot resurrect an explicitly cleared local queue', async () => {
  for (const fail of [false, true]) {
    const store = createEvidenceStore(`clear-inflight-${crypto.randomUUID()}`)
    const operation = createOperation('review', 'clear-case', { reason: 'Queued before clear.' }, 1)
    await store.saveAndQueue({ id: 'clear-case' }, operation)
    let release; let entered
    const started = new Promise((done) => { entered = done })
    const engine = createSyncEngine({ store, transport: async () => { entered(); await new Promise((done) => { release = done }); if (fail) throw new Error('Offline'); return { record: { id: 'clear-case' } } } })
    const pending = engine.run(); await started; await store.clear(); release(); await pending
    assert.deepEqual(await store.all('outbox'), []); assert.deepEqual(await store.listInspections(), [])
  }
})

test('older full-payload outbox records remain usable and missing compacted media is blocked without deletion', async () => {
  const store = createEvidenceStore(`legacy-${crypto.randomUUID()}`)
  const legacy = createOperation('seal', 'legacy-case', { imageUrl: 'data:image/jpeg;base64,YQ==' })
  await store.put('outbox', legacy)
  const engine = createSyncEngine({ store, transport: async (sent) => { assert.equal(sent.payload.imageUrl, legacy.payload.imageUrl); return {} } })
  await engine.run(); assert.equal((await store.all('outbox')).length, 0)
  const missing = { ...createOperation('seal', 'missing-case', { evidenceItems: [] }), mediaRef: 'missing-case' }
  await store.put('outbox', missing)
  await engine.run(); assert.equal((await store.get('outbox', missing.id)).state, 'blocked')
})

test('offset pagination terminates explicitly at its cap and rejects malformed or out-of-range cursors', () => {
  assert.equal(pageOffset(undefined), 0); assert.equal(pageOffset('100000'), 100000)
  assert.deepEqual(pageResult(100000, 20, 20), { nextOffset: null, paginationLimited: true })
  assert.deepEqual(pageResult(100000, 50, 50), { nextOffset: null, paginationLimited: true })
  assert.deepEqual(pageResult(99980, 20, 20), { nextOffset: 100000, paginationLimited: false })
  assert.deepEqual(pageResult(0, 19, 20), { nextOffset: null, paginationLimited: false })
  for (const offset of [-1, '1.5', 'Infinity', '100020', ['0'], {}, '', NaN]) assert.throws(() => pageOffset(offset), { status: 400 })
})

test('malformed identifiers and database input conflicts produce sanitized 4xx responses', () => {
  assert.equal(uuid([org]), false); assert.equal(caseId(['regression-case']), false)
  for (const [code, expected] of [['23505', 409], ['22P02', 400], ['22003', 400], ['23514', 400], ['23503', 422]]) {
    const res = response(); failure(res, { code, message: 'private database details' }); assert.equal(res.code, expected); assert.doesNotMatch(res.body.error, /private database/)
  }
})

test('provider requests share a handler I/O deadline and also carry a per-request timeout', async () => {
  const timeout = AbortSignal.timeout
  const delays = []
  try {
    AbortSignal.timeout = (ms) => { delays.push(ms); return timeout(ms) }
    await providerMock((url, options, json) => { assert.ok(options.signal instanceof AbortSignal); return json([]) }, async () => {
      const client = adminClient()
      await client.from('cases').select('id')
      await client.from('cases').select('id')
    })
    assert.equal(delays.filter((ms) => ms === 50000).length, 1)
    assert.equal(delays.filter((ms) => ms === 30000).length, 2)
  } finally { AbortSignal.timeout = timeout }
})
