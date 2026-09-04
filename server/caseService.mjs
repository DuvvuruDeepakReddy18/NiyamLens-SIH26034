import { createHash } from 'node:crypto'
import { HttpError, caseId } from './security.mjs'
import { evaluateInspection } from '../src/lib/inspectionSafety.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { RULE_PACK } from '../src/lib/rules.mjs'
import { validateInspectionMetadata } from '../src/lib/inspectionMetadata.mjs'
import { isObject, validateJsonShape, validatePanels, validateAudit } from './caseSchema.mjs'
import { ocrProvenance, restoreEvidencePolicy } from '../src/lib/inspectionWorkflow.mjs'
export const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
export const hashPayload = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export function validateCase(input, context) {
  if (!isObject(input) || typeof input.id !== 'string' || !caseId(input.id) || !isObject(input.meta) || typeof input.text !== 'string') throw new HttpError(400, 'Case ID, metadata and evidence text are required.')
  validateJsonShape(input)
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 1800000 || input.text.length > 100000 || (typeof input.rawOcrText === 'string' && input.rawOcrText.length > 100000)) throw new HttpError(413, 'Case metadata is too large. Images must use the private upload service.')
  if (input.rawOcrText !== undefined && typeof input.rawOcrText !== 'string') throw new HttpError(400, 'Raw OCR text must be a string.')
  if (input.controlledFixture !== undefined && typeof input.controlledFixture !== 'boolean') throw new HttpError(400, 'Invalid controlled-fixture flag.')
  if (input.controlledFixture) throw new HttpError(422, 'Controlled fixtures cannot be sealed in an operational workspace.')
  // Validate both supported representations, even when the canonical client
  // timeline takes precedence, so malformed/controlled events cannot be hidden.
  const auditChain = validateAudit(input.auditChain)
  const clientAuditChain = input.clientAuditChain === undefined ? auditChain : validateAudit(input.clientAuditChain)
  const evidenceItems = validatePanels(input.evidenceItems)
  if (input.rulePack !== RULE_PACK.id) throw new HttpError(409, 'Rule pack changed or missing. Refresh and review before submitting.')
  if (typeof input.createdAt !== 'string' || typeof input.sealedAt !== 'string' || input.createdAt.length > 40 || input.sealedAt.length > 40 || !Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.sealedAt))) throw new HttpError(400, 'Valid capture and seal timestamps are required.')
  const issues = validateInspectionMetadata(input.meta)
  if (issues.length) throw new HttpError(400, `Invalid inspection metadata: ${issues.slice(0, 4).map((issue) => `${issue.field}: ${issue.reason}`).join('; ')}`)
  const evidencePanelIds = evidenceItems.map((panel) => panel.id)
  if (Object.keys(input.meta.panelMeasurements || {}).some((id) => !evidencePanelIds.includes(id))) throw new HttpError(400, 'Measurements must refer to an attached evidence panel.')
  const sourceRecord = { meta: input.meta, rawOcrText: input.rawOcrText || '', clientAuditChain }
  const provenance = ocrProvenance(sourceRecord)
  const meta = {
    ...restoreEvidencePolicy(sourceRecord), evidencePanelIds,
    ocrConfidence: provenance.reliability, ocrEngineConfidence: provenance.engineConfidence,
    ocrCompletedAt: provenance.completedAt,
  }
  const scopedIssues = validateInspectionMetadata(meta)
  if (scopedIssues.length) throw new HttpError(400, 'Placement and measurement observations must reference actual attached evidence panels.')
  const automatedResult = evaluateInspection({ text: input.text, meta })
  return {
    schemaVersion: 2, id: input.id, createdAt: input.createdAt, sealedAt: input.sealedAt,
    actor: { id: context.user.id, name: context.member.display_name || context.user.email, role: context.member.role },
    meta, text: input.text, rawOcrText: String(input.rawOcrText || ''), extraction: extractDeclarations(input.text),
    evidenceItems,
    clientAuditChain, clientAuditUntrusted: true,
    ocrProvenance: { ...provenance, clientReported: true, independentlyVerified: false },
    automatedResult, result: automatedResult, reviewHistory: [], rulePack: RULE_PACK.id,
  }
}
export async function hydrateCase(context, row) {
  const { data: reviews, error } = await context.client.from('case_reviews').select('*').eq('org_id', context.org).eq('case_id', row.id).order('created_at').order('id')
  if (error) throw new HttpError(503, 'Review history unavailable.')
  const reviewHistory = (reviews || []).map((review) => ({ id: review.id, status: review.status, reason: review.reason, actor: { id: review.actor_id, name: review.actor_id }, at: review.created_at, automatedStatus: row.payload.automatedResult.status }))
  return { ...row.payload, reviewHistory, supervisorReview: reviewHistory.at(-1) || null, serverVersion: row.version, serverSealedAt: row.created_at, serverPayloadHash: row.payload_hash, syncState: 'synced' }
}
