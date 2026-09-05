import { appendAuditEvent } from './audit.mjs'
import { invalidateCapturedEvidence } from './inspectionWorkflow.mjs'
import { RULE_PACK } from './rules.mjs'

// Explicitly retire only the unsent operation; preserve the historical seal and
// photographs. A separate, unconfirmed draft can be reviewed under new rules.
export async function beginRuleReassessment(store, operation, actorId) {
  if (operation?.kind !== 'seal' || operation.lastErrorCode !== 'RULE_PACK_MISMATCH' || operation.payload?.rulePack === RULE_PACK.id) throw new Error('Only a rule-version conflict can start this reassessment.')
  if (await store.get('drafts', 'active')) throw new Error('Restore or explicitly discard the existing unfinished draft first. It has not been overwritten.')
  const original = await store.get('inspections', operation.recordId)
  if (!original?.evidenceItems?.length || original.evidenceItems.some(panel => !panel.originalUrl?.startsWith('data:image/') || !panel.analysisUrl?.startsWith('data:image/'))) throw new Error('Reassessment requires the preserved original and analysis photographs on this device.')
  const inspectionId = `NL-${crypto.randomUUID()}`
  const startedAt = new Date().toISOString()
  const auditChain = await appendAuditEvent([], 'rule_reassessment_started', { originalCaseId: original.id, originalRulePack: original.rulePack, currentRulePack: RULE_PACK.id, archivedOperationId: operation.id, reusedCapture: true, originalSealAt: original.sealedAt || null }, actorId)
  const draft = { id: 'active', inspectionId, startedAt, evidenceItems: original.evidenceItems, activeEvidenceId: original.evidenceItems[0].id, text: original.text || '', rawOcrText: original.rawOcrText || '', ocrWords: [], auditChain, challengeId: null,
    meta: { ...invalidateCapturedEvidence(original.meta), pdpConfirmed: false, rule3ApplicabilityConfirmed: false, enforceEvidenceReview: true } }
  await store.transact(['drafts', 'outbox', 'settings'], 'readwrite', tx => {
    const drafts = tx.objectStore('drafts'); const outbox = tx.objectStore('outbox')
    const existingDraft = drafts.get('active')
    existingDraft.onsuccess = () => {
      if (existingDraft.result) { tx.abort(); return }
      const pending = outbox.get(operation.id)
      pending.onsuccess = () => {
        if (!pending.result || pending.result.lastErrorCode !== 'RULE_PACK_MISMATCH') { tx.abort(); return }
        tx.objectStore('settings').put({ id: `archived-seal:${operation.id}`, operation: pending.result, archivedAt: startedAt, reassessmentId: inspectionId, reason: 'Explicit officer reassessment under changed rules. Original seal retained locally; not uploaded.' })
        outbox.delete(operation.id); drafts.put(draft)
      }
    }
  })
  return draft
}
