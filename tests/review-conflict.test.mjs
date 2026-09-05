import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createEvidenceStore } from '../src/lib/storage.mjs'
import { archiveReviewConflict } from '../src/lib/reviewConflict.mjs'

async function fixture() {
  const store = createEvidenceStore(`archive-review-${crypto.randomUUID()}`)
  const operation = { id: 'conflict-op', kind: 'review', recordId: 'case-one', state: 'conflict', baseVersion: 1, payload: { status: 'compliant', reason: 'Preserve this unsent review reason.' } }
  const original = { id: 'case-one', serverVersion: 1, evidenceItems: [], reviewHistory: [{ status: 'compliant' }], syncState: 'pending-review' }
  const remote = { ...original, serverVersion: 2, reviewHistory: [{ status: 'manual_review' }], syncState: 'synced' }
  await store.saveAndQueue(original, operation)
  return { store, operation, original, remote }
}

test('conflict archive merges the server record atomically and preserves the actual unsent operation', async () => {
  const { store, operation, remote } = await fixture()
  assert.equal(await archiveReviewConflict(store, operation, remote), true)
  assert.equal(await store.get('outbox', operation.id), null)
  assert.deepEqual((await store.get('settings', `archived-review:${operation.id}`)).operation, operation)
  assert.equal((await store.get('inspections', operation.recordId)).serverVersion, 2)
})

test('a delayed older server fetch cannot overwrite a newer case already saved by another tab', async () => {
  const { store, operation, remote } = await fixture()
  const newer = { ...remote, serverVersion: 4, reviewHistory: [{ status: 'non_compliant' }] }
  await store.saveInspection(newer)
  assert.equal(await archiveReviewConflict(store, operation, remote), true)
  assert.deepEqual(await store.get('inspections', operation.recordId), newer)
})

test('an already consumed conflict is not re-archived and cannot resurrect an older case', async () => {
  const { store, operation, original, remote } = await fixture()
  await store.remove('outbox', operation.id)
  assert.equal(await archiveReviewConflict(store, operation, remote), false)
  assert.equal(await store.get('settings', `archived-review:${operation.id}`), null)
  assert.deepEqual(await store.get('inspections', operation.recordId), original)
})

test('changed or reactivated operation intent cannot be silently discarded by a stale archive click', async () => {
  for (const patch of [{ state: 'pending' }, { payload: { status: 'non_compliant', reason: 'Newer reason retained.' } }, { baseVersion: 2 }]) {
    const { store, operation, original, remote } = await fixture()
    const changed = { ...operation, ...patch }; await store.put('outbox', changed)
    assert.equal(await archiveReviewConflict(store, operation, remote), false)
    assert.deepEqual(await store.get('outbox', operation.id), changed)
    assert.deepEqual(await store.get('inspections', operation.recordId), original)
  }
})

test('archiving one conflict preserves a separately queued later review and its visible local intent', async () => {
  const { store, operation, remote } = await fixture()
  const next = { ...operation, id: 'later-review', state: 'pending', baseVersion: 2, payload: { status: 'non_compliant', reason: 'Later independently queued review.' } }
  const projection = { ...remote, reviewHistory: [{ id: next.id, status: next.payload.status }], syncState: 'pending-review' }
  await store.saveAndQueue(projection, next)
  assert.equal(await archiveReviewConflict(store, operation, remote), true)
  assert.deepEqual(await store.get('outbox', next.id), next)
  assert.deepEqual(await store.get('inspections', operation.recordId), projection)
  assert.equal(await store.get('outbox', operation.id), null)
})

test('partial or mismatched server detail cannot archive the unsent review', async () => {
  const { store, operation, remote } = await fixture()
  for (const patch of [{ id: 'another-case' }, { recordKind: 'summary' }, { detailsStale: true }, { evidenceItems: undefined }]) assert.throws(() => archiveReviewConflict(store, operation, { ...remote, ...patch }), /complete server record/)
  assert.deepEqual(await store.get('outbox', operation.id), operation)
})
