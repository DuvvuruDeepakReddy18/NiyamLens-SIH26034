import { appendAuditEvent, verifyAuditChain } from './audit.mjs'
export const DISPOSITIONS = ['compliant', 'non_compliant', 'manual_review', 'exempt']
export const effectiveStatus = (record) => record.reviewHistory?.at(-1)?.status || record.supervisorReview?.status || record.automatedResult?.status || record.result?.status
export function auditPresentation(record) {
  const untrusted = record.clientAuditUntrusted === true || Array.isArray(record.clientAuditChain)
  const events = (Array.isArray(record.clientAuditChain) ? record.clientAuditChain : record.auditChain || []).filter((event) => event && typeof event === 'object')
  return { events, untrusted, verified: !untrusted && record.auditVerified === true }
}
export function normalizeCase(record) {
  const automatedResult = record.automatedResult || { ...record.result, status: record.supervisorReview?.automatedStatus || record.result?.status }
  const reviewHistory = record.reviewHistory || (record.supervisorReview ? [{ ...record.supervisorReview, legacy: true }] : [])
  return { ...record, schemaVersion: 2, automatedResult, result: automatedResult, reviewHistory }
}
export async function appendReview(record, { actor, status, reason, id = crypto.randomUUID(), at = new Date().toISOString() }) {
  if (!['supervisor', 'admin'].includes(actor?.role)) throw new Error('Only a supervisor or administrator may review a case.')
  if (!DISPOSITIONS.includes(status)) throw new Error('Invalid review disposition.')
  if (String(reason || '').trim().length < 12) throw new Error('Explain the review basis in at least 12 characters.')
  const original = normalizeCase(record)
  if (original.reviewHistory.some((item) => item.id === id)) return original
  const review = { id, status, reason: reason.trim(), actor, at, automatedStatus: original.automatedResult.status }
  const auditChain = await appendAuditEvent(original.auditChain || [], 'supervisor_disposition', review, actor.id)
  return { ...original, reviewHistory: [...original.reviewHistory, review], supervisorReview: review, auditChain, auditVerified: await verifyAuditChain(auditChain) }
}
