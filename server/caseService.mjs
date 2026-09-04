import { createHash } from 'node:crypto'
import { HttpError, caseId } from './security.mjs'
import { evaluateInspection } from '../src/lib/inspectionSafety.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { RULE_PACK } from '../src/lib/rules.mjs'
export const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
export const hashPayload = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export function validateCase(input, context) {
  if (!caseId(input?.id) || !input.meta || typeof input.meta !== 'object' || Array.isArray(input.meta) || typeof input.text !== 'string') throw new HttpError(400, 'Case ID, metadata and evidence text are required.')
  if (JSON.stringify(input).length > 1800000 || input.text.length > 100000) throw new HttpError(413, 'Case metadata is too large. Images must use the private upload service.')
  if (input.controlledFixture || input.auditChain?.some((event) => event.type === 'controlled_packet_loaded')) throw new HttpError(422, 'Controlled fixtures cannot be sealed in an operational workspace.')
  if (!Array.isArray(input.evidenceItems) || input.evidenceItems.length < 1 || input.evidenceItems.length > 4) throw new HttpError(422, 'One to four verified evidence panels are required.')
  if (input.rulePack !== RULE_PACK.id) throw new HttpError(409, 'Rule pack changed or missing. Refresh and review before submitting.')
  if (!Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.sealedAt))) throw new HttpError(400, 'Valid capture and seal timestamps are required.')
  const meta = { ...input.meta, enforceEvidenceReview: true }
  const automatedResult = evaluateInspection({ text: input.text, meta })
  return {
    schemaVersion: 2, id: input.id, createdAt: input.createdAt, sealedAt: input.sealedAt,
    actor: { id: context.user.id, name: context.member.display_name || context.user.email, role: context.member.role },
    meta, text: input.text, rawOcrText: String(input.rawOcrText || ''), extraction: extractDeclarations(input.text),
    evidenceItems: input.evidenceItems.map(({ id, name, originalPath, analysisPath, sha256, panelRole, capturedAt, perspective, rotation }) => ({ id, name, originalPath, analysisPath, sha256, panelRole, capturedAt, perspective, rotation })),
    clientAuditChain: input.auditChain || [], clientAuditUntrusted: true,
    automatedResult, result: automatedResult, reviewHistory: [], rulePack: RULE_PACK.id,
  }
}
export async function hydrateCase(context, row) {
  const { data: reviews, error } = await context.client.from('case_reviews').select('*').eq('org_id', context.org).eq('case_id', row.id).order('created_at').order('id')
  if (error) throw new HttpError(503, 'Review history unavailable.')
  const reviewHistory = (reviews || []).map((review) => ({ id: review.id, status: review.status, reason: review.reason, actor: { id: review.actor_id, name: review.actor_id }, at: review.created_at, automatedStatus: row.payload.automatedResult.status }))
  return { ...row.payload, reviewHistory, supervisorReview: reviewHistory.at(-1) || null, serverVersion: row.version, serverSealedAt: row.created_at, serverPayloadHash: row.payload_hash, syncState: 'synced' }
}
