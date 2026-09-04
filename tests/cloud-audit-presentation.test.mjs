import test from 'node:test'
import assert from 'node:assert/strict'
import { auditPresentation } from '../src/lib/caseRecords.mjs'
test('cloud report preserves client timeline without labeling it independently verified', () => {
  const events = [{ index: 0, type: 'evidence_captured', hash: 'a'.repeat(64) }]
  const presentation = auditPresentation({ clientAuditChain: events, clientAuditUntrusted: true, auditVerified: true })
  assert.deepEqual(presentation.events, events)
  assert.equal(presentation.untrusted, true)
  assert.equal(presentation.verified, false)
})
test('legacy local report retains its local-only audit verification', () => {
  const result = auditPresentation({ auditChain: [{ type: 'inspection_started' }], auditVerified: true })
  assert.equal(result.events.length, 1); assert.equal(result.verified, true); assert.equal(result.untrusted, false)
})
