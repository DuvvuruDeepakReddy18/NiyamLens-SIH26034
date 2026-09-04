// Local stress reproductions only. No browser or live service is used.
// A passing "reproduction" documents the current defect, not a safe outcome.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import 'fake-indexeddb/auto'
import { createEvidenceStore } from '../../src/lib/storage.mjs'
import { createOperation, createSyncEngine } from '../../src/lib/syncEngine.mjs'
import { mergeCloudRecord } from '../../src/lib/workspaceClient.mjs'
import { validateCase } from '../../server/caseService.mjs'
import { RULE_PACK } from '../../src/lib/rules.mjs'
import casesHandler from '../../api/cases.js'
import assignmentsHandler from '../../api/assignments.js'
import evidenceHandler from '../../api/evidence.js'

// These fake values apply only to this short-lived local Node process.
process.env.SUPABASE_URL = 'http://127.0.0.1:9999'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-key-not-a-real-secret'
const org = '10000000-0000-4000-8000-000000000001'
const otherOrg = '10000000-0000-4000-8000-000000000002'
const user = { id: '20000000-0000-4000-8000-000000000001', email: 'stress@example.test' }
const member = { user_id: user.id, org_id: org, role: 'officer', active: true }
const panelId = '30000000-0000-4000-8000-000000000001'
const context = { user, member }
const base = () => ({ id: 'stress-case-0001', meta: { quantity: 100, unit: 'g' }, text: 'TEST SOAP', rawOcrText: 'TEST SOAP', createdAt: '2026-09-04', sealedAt: '2026-09-04', rulePack: RULE_PACK.id, auditChain: [], evidenceItems: [{ id: panelId, originalPath: 'private/original', analysisPath: 'private/analysis', sha256: 'a'.repeat(64) }] })
const req = (method = 'GET', query = {}, body) => ({ method, query, body, headers: { authorization: 'Bearer mock-user-token', 'x-workspace-id': org } })
const response = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value }, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const emit = (name, observation) => console.log(JSON.stringify({ name, mode: 'local modules / mocked provider, NOT live Supabase', ...observation }))
async function providerMock(handle, action) {
  const prior = globalThis.fetch
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'http://127.0.0.1:9999', 'No real network request is permitted by this harness.')
    if (url.pathname === '/auth/v1/user') return options.headers?.Authorization === 'Bearer invalid-test-token' ? json({ message: 'Invalid JWT' }, 401) : json(user)
    if (url.pathname === '/rest/v1/memberships') return json(url.searchParams.get('org_id') === `eq.${org}` ? member : null)
    if (url.pathname === '/rest/v1/rpc/consume_quota') return json(true)
    return handle(url, options)
  }
  try { return await action() } finally { globalThis.fetch = prior }
}

test('reproduction: an acknowledgement overwrites a newer queued review projection', async () => {
  const store = createEvidenceStore(`stress-race-${crypto.randomUUID()}`)
  const id = 'stress-review-race'
  const first = createOperation('review', id, { status: 'compliant', reason: 'First reviewer observation.' }, 1)
  await store.saveAndQueue({ id, createdAt: '2026-09-04', syncState: 'pending-review', reviewHistory: [{ id: first.id }] }, first)
  let release; let started
  const waiting = new Promise((done) => { started = done })
  const engine = createSyncEngine({ store, transport: async () => {
    started(); await new Promise((done) => { release = done })
    return { record: mergeCloudRecord(await store.get('inspections', id), { id, createdAt: '2026-09-04', evidenceItems: [], syncState: 'synced', serverVersion: 2, reviewHistory: [{ id: first.id }] }) }
  } })
  const running = engine.run(); await waiting
  const second = createOperation('review', id, { status: 'non_compliant', reason: 'Newer review from another tab.' }, 1)
  await store.saveAndQueue({ id, createdAt: '2026-09-04', syncState: 'pending-review', reviewHistory: [{ id: first.id }, { id: second.id }] }, second)
  release(); await running
  const saved = await store.get('inspections', id); const queue = await store.all('outbox')
  assert.equal(queue.length, 1); assert.equal(queue[0].id, second.id)
  assert.equal(saved.syncState, 'synced')
  assert.equal(saved.reviewHistory.some((review) => review.id === second.id), false)
  emit('outbox acknowledgement race', { queuedSecondReview: true, newerReviewVisibleInRecord: false, displayedSyncState: saved.syncState, reasonStillRecoverableInOutbox: queue[0].payload.reason })
})

test('reproduction: API paging cursor stalls at the hard offset cap', async () => {
  const observedRanges = []
  const payload = validateCase(base(), context)
  await providerMock((url) => {
    if (url.pathname === '/rest/v1/cases') {
      assert.equal(url.searchParams.get('owner_id'), `eq.${user.id}`)
      observedRanges.push({ table: 'cases', offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit') })
      return json(Array.from({ length: 20 }, (_, i) => ({ id: `stress-case-${i}`, payload, version: 1, created_at: '2026-09-04' })))
    }
    if (url.pathname === '/rest/v1/case_reviews') return json([])
    if (url.pathname === '/rest/v1/assignments') {
      observedRanges.push({ table: 'assignments', offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit') })
      return json(Array.from({ length: 50 }, (_, i) => ({ id: `stress-assignment-${i}` })))
    }
    throw new Error(`Unexpected mock route ${url.pathname}`)
  }, async () => {
    for (const [handler, increment] of [[casesHandler, 20], [assignmentsHandler, 50]]) {
      let offset = 100000; const returned = []
      for (let i = 0; i < 3; i++) { const res = response(); await handler(req('GET', { offset }), res); assert.equal(res.code, 200); offset = res.body.nextOffset; returned.push(offset) }
      assert.deepEqual(returned, [100000 + increment, 100000 + increment, 100000 + increment])
    }
  })
  assert.ok(observedRanges.every((range) => range.offset === '100000'))
  emit('pagination cursor cap', { casesFailAtFullTailSize: 100020, assignmentsFailAtFullTailSize: 100050, requestsObserved: observedRanges, terminatedByHarnessAfterThreePages: true })
})

test('reproduction: image register accepts a corrupt header-only JPEG', async () => {
  const fakeJpeg = Buffer.from([255, 216, 255])
  const sha256 = createHash('sha256').update(fakeJpeg).digest('hex')
  let registered = null
  await providerMock((url, options) => {
    if (url.pathname === '/rest/v1/evidence_objects') {
      if (options.method === 'POST') { registered = JSON.parse(options.body); return new Response(null, { status: 201 }) }
      return json(null)
    }
    if (url.pathname.startsWith('/storage/v1/object/')) return new Response(fakeJpeg, { headers: { 'Content-Type': 'image/jpeg' } })
    throw new Error(`Unexpected mock route ${url.pathname}`)
  }, async () => {
    const res = response()
    await evidenceHandler(req('POST', {}, { action: 'verify', caseId: base().id, panelId, kind: 'original', sha256, bytes: fakeJpeg.length, mime: 'image/jpeg' }), res)
    assert.equal(res.code, 200); assert.equal(res.body.verified, true); assert.equal(registered.bytes, 3)
    emit('header-only image verification', { inputBytes: 3, httpStatus: res.code, markedVerified: res.body.verified, caveat: 'Mock Storage supplied the bytes; actual Storage validation has not been tested.' })
  })
})

test('API scope and ordinary body limits fail closed, but malformed nested bodies produce 500', async () => {
  const badBodies = [
    ['auditChain object', { ...base(), auditChain: {} }, 500],
    ['auditChain null event', { ...base(), auditChain: [null] }, 500],
    ['null panel', { ...base(), evidenceItems: [null] }, 500],
    ['oversized text', { ...base(), text: 'A'.repeat(100001) }, 413],
    ['five panels', { ...base(), evidenceItems: Array(5).fill(base().evidenceItems[0]) }, 422],
    ['oversized metadata', { ...base(), meta: { note: 'A'.repeat(1800000) } }, 413],
  ]
  const observations = []
  await providerMock((url) => { throw new Error(`No data-provider query expected: ${url.pathname}`) }, async () => {
    for (const [label, input, expected] of badBodies) {
      const res = response(); await casesHandler(req('POST', {}, { record: input }), res)
      assert.equal(res.code, expected); observations.push({ label, status: res.code })
    }
    const denied = response(); const other = req('GET'); other.headers['x-workspace-id'] = otherOrg
    await casesHandler(other, denied); assert.equal(denied.code, 403)
    const unsigned = response(); await casesHandler({ method: 'GET', headers: {} }, unsigned); assert.equal(unsigned.code, 401)
    const invalid = response(); const invalidReq = req('GET'); invalidReq.headers.authorization = 'Bearer invalid-test-token'
    await casesHandler(invalidReq, invalid); assert.equal(invalid.code, 401)
    emit('body and identity boundaries', { observations, otherOrganization: denied.code, unsigned: unsigned.code, invalidToken: invalid.code })
  })
})

test('local storage capacity probe retains 500 records and duplicates evidence in the outbox', async () => {
  const store = createEvidenceStore(`stress-capacity-${crypto.randomUUID()}`)
  const start = performance.now()
  for (let i = 0; i < 500; i++) await store.saveInspection({ id: `stress-${i}`, createdAt: new Date().toISOString(), text: 'a'.repeat(256) })
  assert.equal((await store.listInspections()).length, 500)
  const image = `data:image/jpeg;base64,${'A'.repeat(4 * 1024 * 1024 / 3 | 0)}`
  const large = { id: 'large-fixture', createdAt: new Date().toISOString(), evidenceItems: Array.from({ length: 4 }, (_, i) => ({ id: `panel-${i}`, originalUrl: image, analysisUrl: image })) }
  const operation = createOperation('seal', large.id, large)
  await store.saveAndQueue(large, operation)
  const copiesBytes = Buffer.byteLength(JSON.stringify(await store.get('inspections', large.id))) + Buffer.byteLength(JSON.stringify(await store.get('outbox', operation.id)))
  emit('local persistence volume', { recordsRetained: 501, elapsedMs: Math.round(performance.now() - start), syntheticRecordJsonBytes: Buffer.byteLength(JSON.stringify(large)), recordPlusOutboxJsonBytes: copiesBytes, caveat: 'fake-indexeddb has no browser quota; this measures logical duplication, not Chrome storage capacity.' })
})

test('bounded adversarial-text timing probe never performs a network call', () => {
  const results = []
  for (const size of [2000, 10000, 30000, 100000]) {
    const code = `import { performance } from 'node:perf_hooks'; import { validateCase } from './server/caseService.mjs'; import { RULE_PACK } from './src/lib/rules.mjs'; const text='a.'.repeat(${size}/2); const start=performance.now(); validateCase({id:'stress-regex-123',meta:{quantity:100,unit:'g'},text,createdAt:'2026-09-04',sealedAt:'2026-09-04',rulePack:RULE_PACK.id,evidenceItems:[{id:'panel'}]}, {user:{id:'mock-user'},member:{role:'officer'}}); console.log(JSON.stringify({length:text.length,elapsedMs:performance.now()-start}));`
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000, maxBuffer: 5000, windowsHide: true })
    results.push(probe.status === 0 ? JSON.parse(probe.stdout.trim()) : { length: size, timedOut: probe.error?.code === 'ETIMEDOUT', exitCode: probe.status, stderr: probe.stderr.slice(0, 200) })
    if (probe.error?.code === 'ETIMEDOUT') break
  }
  emit('adversarial text CPU', { perProbeLimitMs: 3000, results })
})

test('bounded isolated timing attributes the superlinear scan to the actual email expression', () => {
  const source = readFileSync(new URL('../../src/lib/extraction.mjs', import.meta.url), 'utf8')
  const emailLine = source.split('\n').find((line) => line.includes('const emailMatch = raw.match('))
  assert.ok(emailLine, 'The measured statement must be read from the actual application source.')
  const results = []
  for (const size of [10000, 30000, 100000]) {
    const code = `import { performance } from 'node:perf_hooks'; const raw='a.'.repeat(${size}/2); const start=performance.now(); ${emailLine}; console.log(JSON.stringify({length:raw.length,elapsedMs:performance.now()-start,matched:Boolean(emailMatch)}));`
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000, maxBuffer: 5000, windowsHide: true })
    results.push(probe.status === 0 ? JSON.parse(probe.stdout.trim()) : { length: size, timedOut: probe.error?.code === 'ETIMEDOUT', exitCode: probe.status })
    if (probe.error?.code === 'ETIMEDOUT') break
  }
  emit('actual email expression isolated', { source: 'src/lib/extraction.mjs:54', duplicate: 'src/lib/rules.mjs:90', perProbeLimitMs: 3000, results })
})
