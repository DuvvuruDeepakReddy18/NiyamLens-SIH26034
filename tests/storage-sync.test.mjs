import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvidenceStore } from '../src/lib/storage.mjs'
import { createOperation, createSyncEngine } from '../src/lib/syncEngine.mjs'
const store = () => createEvidenceStore(`test-${crypto.randomUUID()}`)
test('storage waits for commit and rejects an abort after request success', async () => {
  const db = store()
  await assert.rejects(db.transact(['inspections'], 'readwrite', (tx) => {
    const request = tx.objectStore('inspections').put({ id: 'aborted' })
    request.onsuccess = () => tx.abort()
  }), /aborted/)
  assert.equal(await db.get('inspections', 'aborted'), null)
})
test('case and outbox commit atomically, survive reopen, and do not leak across scopes', async () => {
  const db = store(); const other = store(); const operation = createOperation('seal', 'case-1', {})
  await db.saveAndQueue({ id: 'case-1', createdAt: '2026-09-04' }, operation)
  assert.equal((await db.get('inspections', 'case-1')).id, 'case-1')
  assert.equal((await db.all('outbox')).length, 1)
  assert.equal(await other.get('inspections', 'case-1'), null)
  await assert.rejects(db.transact(['inspections', 'outbox'], 'readwrite', (tx) => {
    tx.objectStore('inspections').put({ id: 'failed' }); tx.objectStore('outbox').put({ id: 'failed' }); tx.abort()
  }))
  assert.equal(await db.get('inspections', 'failed'), null)
  assert.equal(await db.get('outbox', 'failed'), null)
})
test('history retains more than fifty records', async () => {
  const db = store()
  await Promise.all(Array.from({ length: 62 }, (_, index) => db.saveInspection({ id: String(index), createdAt: new Date(index * 1000).toISOString() })))
  const rows = await db.listInspections()
  assert.equal(rows.length, 62); assert.equal(rows[0].id, '61')
})
test('remote refresh cannot overwrite a locally queued review', async () => {
  const db = store()
  await db.saveAndQueue({ id: 'one', intent: 'local-review' }, createOperation('review', 'one', { reason: 'Retain this review.' }))
  assert.equal(await db.mergeRemote({ id: 'one', intent: 'stale-server' }, (_, remote) => remote), false)
  assert.equal((await db.get('inspections', 'one')).intent, 'local-review')
})
test('network failure retains queued evidence then succeeds without a duplicate queue entry', async () => {
  const db = store(); const operation = createOperation('seal', 'one', {})
  await db.saveAndQueue({ id: 'one' }, operation)
  let calls = 0; let timestamp = 100
  const engine = createSyncEngine({ store: db, now: () => timestamp, transport: async () => { calls++; if (calls === 1) throw new Error('Offline'); return { record: { id: 'one', serverVersion: 1 } } } })
  await engine.run(); assert.equal((await db.all('outbox')).length, 1)
  await engine.run(); assert.equal(calls, 1)
  timestamp = 10000
  await Promise.all([engine.run(), engine.run()])
  assert.equal(calls, 2); assert.equal((await db.all('outbox')).length, 0); assert.equal((await db.get('inspections', 'one')).serverVersion, 1)
})
test('conflicts block subsequent changes for that case without discarding intent', async () => {
  const db = store(); const a = createOperation('review', 'same', { reason: 'keep my intent' }); const b = createOperation('review', 'same', {})
  a.createdAt = '2026-01-01'; b.createdAt = '2026-01-02'
  await db.put('outbox', a); await db.put('outbox', b)
  let calls = 0
  const engine = createSyncEngine({ store: db, transport: async () => { calls++; throw Object.assign(new Error('Version conflict'), { status: 409 }) } })
  await engine.run(true); await engine.run(true)
  assert.equal(calls, 1); assert.equal((await db.get('outbox', a.id)).state, 'conflict'); assert.equal((await db.get('outbox', a.id)).payload.reason, 'keep my intent')
  assert.equal((await db.get('outbox', b.id)).state, 'pending')
})
test('authorization denial cannot be retried indefinitely by the sync button', async () => {
  const db = store(); const a = createOperation('seal', 'one', {})
  await db.put('outbox', a); let calls = 0
  const engine = createSyncEngine({ store: db, transport: async () => { calls++; throw Object.assign(new Error('Forbidden'), { status: 403 }) } })
  await engine.run(true); await engine.run(true)
  assert.equal(calls, 1); assert.equal((await db.get('outbox', a.id)).state, 'blocked')
})

test('out-of-order remote refreshes cannot downgrade an already observed server decision', async () => {
  const db = store()
  const merge = (_, remote) => remote
  await db.mergeRemote({ id: 'one', serverVersion: 3, decision: 'non_compliant' }, merge)
  assert.equal(await db.mergeRemote({ id: 'one', serverVersion: 2, decision: 'compliant' }, merge), false)
  assert.equal(await db.mergeRemote({ id: 'one', decision: 'unknown' }, merge), false)
  assert.equal((await db.get('inspections', 'one')).decision, 'non_compliant')
})

test('a delayed operation acknowledgement cannot overwrite a newer version committed by another tab', async () => {
  const db = store(); const operation = createOperation('review', 'one', { reason: 'My reason' }, 1)
  await db.saveAndQueue({ id: 'one', serverVersion: 1 }, operation)
  const engine = createSyncEngine({ store: db, transport: async () => {
    await db.saveInspection({ id: 'one', serverVersion: 3, decision: 'non_compliant' })
    return { record: { id: 'one', serverVersion: 2, decision: 'compliant' } }
  } })
  await engine.run()
  assert.equal((await db.all('outbox')).length, 0)
  assert.equal((await db.get('inspections', 'one')).serverVersion, 3)
  assert.equal((await db.get('inspections', 'one')).decision, 'non_compliant')
})

test('rule-pack conflicts preserve the old sealed case and expose a machine-readable reassessment reason', async () => {
  const db = store(); const original = { id: 'one', rulePack: 'LMPC-OLD', text: 'Original evidence' }
  await db.saveAndQueue(original, createOperation('seal', 'one', original))
  const engine = createSyncEngine({ store: db, transport: async () => { throw Object.assign(new Error('Reassess this inspection.'), { status: 409, code: 'RULE_PACK_MISMATCH' }) } })
  await engine.run()
  const [operation] = await db.all('outbox')
  assert.equal(operation.state, 'conflict'); assert.equal(operation.lastErrorCode, 'RULE_PACK_MISMATCH')
  assert.deepEqual(await db.get('inspections', 'one'), original)
  assert.equal(operation.payload.rulePack, 'LMPC-OLD')
})
