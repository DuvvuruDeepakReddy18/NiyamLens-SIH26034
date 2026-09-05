import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { createEvidenceStore } from '../src/lib/storage.mjs'
import { beginRuleReassessment } from '../src/lib/reassessment.mjs'
import { verifyAuditChain } from '../src/lib/audit.mjs'

async function fixture() {
  const store = createEvidenceStore(`reassessment-${crypto.randomUUID()}`)
  const original = { id: 'case-original', rulePack: 'OLD', text: 'MRP Rs 40.00', rawOcrText: 'MRP Rs 40.00', meta: { fieldReviews: { mrp: { state: 'confirmed' } }, pdpConfirmed: true, rule3ApplicabilityConfirmed: true }, evidenceItems: [{ id: 'panel1', originalUrl: 'data:image/png;base64,AQ==', analysisUrl: 'data:image/png;base64,AQ==' }], result: { status: 'compliant' } }
  const operation = { id: 'operation1', kind: 'seal', recordId: original.id, payload: original, lastErrorCode: 'RULE_PACK_MISMATCH' }
  await store.saveAndQueue(original, operation)
  return { store, original, operation }
}
test('explicit reassessment retains original seal and starts an unconfirmed linked draft', async () => {
  const { store, original, operation } = await fixture()
  const draft = await beginRuleReassessment(store, operation, 'officer1')
  assert.deepEqual(await store.get('inspections', original.id), original)
  assert.equal((await store.all('outbox')).length, 0)
  assert.equal((await store.get('settings', 'archived-seal:operation1')).reassessmentId, draft.inspectionId)
  assert.notEqual(draft.inspectionId, original.id)
  assert.deepEqual(draft.meta.fieldReviews, {})
  assert.equal(draft.meta.rule3ApplicabilityConfirmed, false)
  assert.equal(draft.meta.pdpConfirmed, false)
  assert.equal(draft.meta.ocrConfidence, null)
  assert.equal(await verifyAuditChain(draft.auditChain), true)
  assert.equal(draft.auditChain[0].payload.originalCaseId, original.id)
})
test('a previous draft or missing images cannot be overwritten by reassessment', async () => {
  const { store, operation, original } = await fixture()
  await store.put('drafts', { id: 'active', inspectionId: 'unrelated' })
  await assert.rejects(beginRuleReassessment(store, operation, 'officer1'), /unfinished draft/)
  assert.ok(await store.get('outbox', operation.id))
  await store.remove('drafts', 'active')
  await store.saveInspection({ ...original, evidenceItems: [{ id: 'panel1' }] })
  await assert.rejects(beginRuleReassessment(store, operation, 'officer1'), /preserved original/)
  assert.ok(await store.get('outbox', operation.id))
})
