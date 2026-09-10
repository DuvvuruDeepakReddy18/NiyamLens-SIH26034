import { extractDeclarations } from './extraction.mjs'
import { evaluateInspection } from './inspectionSafety.mjs'
import { restoreEvidencePolicy, ocrProvenance } from './inspectionWorkflow.mjs'
import { matchDeclarationRegions } from './vision.mjs'
import { labelLocationHints } from './captureCoach.mjs'
import { buildInspectionInsights } from './inspectionInsights.mjs'

export const EVIDENCE_STATES = Object.freeze([
  { id: 'verified', label: 'Officer verified', color: '#087c66', detail: 'Reading explicitly confirmed against the package.' },
  { id: 'detected', label: 'Detected · verify', color: '#276aa8', detail: 'A reading is available but has not been confirmed.' },
  { id: 'conflict', label: 'Conflicting readings', color: '#ba3e53', detail: 'Resolve competing values against the source.' },
  { id: 'unreadable', label: 'Unreadable / incomplete', color: '#ad670b', detail: 'Retake a close-up or correct an incomplete reading.' },
  { id: 'missing', label: 'Not detected / captured', color: '#687786', detail: 'This is missing evidence, not proof of a missing declaration.' },
  { id: 'absent', label: 'Confirmed absent', color: '#7855a0', detail: 'Officer recorded absence after checking all relevant panels; consult the rule result.' },
])
export const PANEL_PURPOSES = Object.freeze([
  { id: 'front', label: 'Front / identity' }, { id: 'price_date', label: 'MRP + date' },
  { id: 'responsible_care', label: 'Maker + consumer care' }, { id: 'quantity_barcode', label: 'Quantity + barcode' },
])
const norm = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
export const usableDeclaration = field => Boolean(field?.value) && !field.conflict && !['invalid', 'conflict', 'check_digit_invalid'].includes(field.validation?.status)
export function declarationState(field, meta = {}) {
  const review = meta.fieldReviews?.[field.id]
  const current = review && norm(review.value) === norm(field.value)
  if (field.conflict || field.validation?.status === 'conflict') return 'conflict'
  if (current && review.state === 'confirmed' && usableDeclaration(field) && review.reason?.trim()) return 'verified'
  if (current && review.state === 'absent' && !field.detected && meta.allPanelsCaptured === true && review.reason?.trim().length >= 12) return 'absent'
  if (current && review.state === 'not_captured') return 'missing'
  if (current && review.state === 'unreadable' || field.detected && !usableDeclaration(field)) return 'unreadable'
  return usableDeclaration(field) ? 'detected' : 'missing'
}

// All charts have explicit denominators and are derived from ONE inspection.
// No history aggregation, confidence-as-accuracy, or arbitrary progress points.
export function buildInspectionAnalysis(record = {}, state = {}) {
  const evidenceItems = record.evidenceItems || []
  const text = record.text || ''
  const extraction = extractDeclarations(text)
  const meta = { ...restoreEvidencePolicy(record), evidencePanelIds: evidenceItems.map(panel => panel.id) }
  const result = evaluateInspection({ text, meta })
  const regions = matchDeclarationRegions(extraction, record.ocrWords || [])
  const hasEvidence = evidenceItems.length > 0
  const locationHints = labelLocationHints(extraction, text + '\n\n' + (record.rawOcrText || ''))
  const fields = hasEvidence ? extraction.fields.map(field => {
    const status = declarationState(field, meta)
    const region = regions.find(item => item.id === field.id)
    const panelIndex = evidenceItems.findIndex(panel => panel.id === region?.panelId)
    const definition = EVIDENCE_STATES.find(item => item.id === status)
    return { id: field.id, label: field.label, value: field.value, status, evidence: field.evidence,
      panel: panelIndex >= 0 ? `Panel ${panelIndex + 1} · ${evidenceItems[panelIndex].name}` : 'Source not located',
      alternatives: (field.candidates || []).map(candidate => candidate.value || 'Incomplete reading'),
      reason: locationHints.find(hint => hint.id === field.id)?.guidance || (field.validation?.message && !usableDeclaration(field) ? field.validation.message : definition.detail),
      historicalDisagreement: (meta.fieldCandidates?.[field.id]?.length || 0) > 1,
    }
  }) : []
  const distribution = EVIDENCE_STATES.map(item => ({ ...item, count: fields.filter(field => field.status === item.id).length }))
  const panels = evidenceItems.map((panel, index) => ({ id: panel.id, name: panel.name || `Panel ${index + 1}`, index: index + 1,
    purpose: panel.panelRole || 'unassigned', located: fields.filter(field => regions.find(region => region.id === field.id)?.panelId === panel.id).length,
    passes: panel.ocrPasses?.length || 0, quality: Number.isFinite(panel.quality?.score) ? panel.quality.score : null,
  }))
  const coverage = PANEL_PURPOSES.map(role => ({ ...role, captured: panels.some(panel => panel.purpose === role.id || panel.purpose === 'full_declaration') }))
  const checks = hasEvidence && text.trim() ? result.checks : []
  const ruleDistribution = [
    { id: 'pass', label: 'Pass checks', color: '#087c66' }, { id: 'fail', label: 'Flagged checks', color: '#ba3e53' },
    { id: 'review', label: 'Needs review', color: '#ad670b' }, { id: 'info', label: 'Information / exempt', color: '#687786' },
  ].map(bucket => ({ ...bucket, count: checks.filter(check => bucket.id === 'info' ? !['pass', 'fail', 'review'].includes(check.status) : check.status === bucket.id).length }))
  const hasRecordedOcr = ocrProvenance(record).hasRun
  const insights = buildInspectionInsights({ record, extraction, fields, checks, hasRecordedOcr, status: result.status, ...state })
  return { id: record.inspectionId || record.id || null, hasEvidence, productName: meta.productName || extraction.byId.productName.value || evidenceItems[0]?.name || 'No current package',
    thumbnail: evidenceItems[0]?.analysisUrl || '', fields, distribution, panels, coverage, ruleDistribution, checks,
    detected: fields.filter(field => ['verified', 'detected'].includes(field.status)).length,
    verified: fields.filter(field => field.status === 'verified').length,
    status: !hasEvidence ? 'empty' : !text.trim() ? 'awaiting_ocr' : result.status,
    hasRecordedOcr, insights, ...state,
  }
}
