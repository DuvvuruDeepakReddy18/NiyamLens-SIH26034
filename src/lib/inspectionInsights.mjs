import { FIELD_RULES } from './inspectionSafety.mjs'
import { RULE_PACK } from './rules.mjs'

const usable = field => Boolean(field?.value) && !field.conflict && !['invalid', 'conflict', 'check_digit_invalid'].includes(field.validation?.status)
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
const normalized = value => String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[₹,:;()]/g, '')
const verdict = { compliant: 'PASS', non_compliant: 'FLAG', manual_review: 'MANUAL REVIEW', exempt: 'EXEMPT / SCOPE REVIEW' }
export const CORE_DECLARATIONS = ['productName', 'netQuantity', 'mrp', 'responsibleEntity', 'consumerCare', 'unitSalePrice']

// Never use extraction.confidence: those are fixed parser heuristics. A score
// must be in retained OCR observations, bound to a current photo, and contain
// the literal current value. Changed values cannot inherit unrelated scores.
export function fieldEngineScore(field, record, hasRecordedOcr) {
  const unavailable = reason => ({ value: null, band: 'unavailable', label: 'Unavailable', reason, observations: 0, panels: [] })
  if (!hasRecordedOcr) return unavailable('No completed OCR run with retained raw evidence.')
  if (!usable(field)) return unavailable('No single usable current value; resolve missing, damaged or competing readings.')
  const value = normalized(field.value)
  const evidence = normalized(field.evidence)
  const matching = []
  for (const panel of record.evidenceItems || []) {
    // Only panel-owned observations retained together with actual raw passes.
    const passes = (panel.ocrPasses || []).filter(pass => typeof pass.text === 'string' && pass.text.trim())
    if (!passes.length) continue
    for (const word of panel.ocrWords || []) {
      if (word.panelId !== panel.id || !score(word.confidence) || !word.text?.trim()) continue
      // Existing Paddle line polygons are created only from validated engine
      // scores. Legacy word scores with unknown provenance are withheld.
      if (word.confidenceSource !== 'engine' && word.geometryKind !== 'line-box-not-glyph') continue
      const sourceLine = normalized(word.lineText || word.text)
      if (!sourceLine || !evidence.includes(sourceLine)) continue
      const observed = normalized(word.text)
      const start = observed.indexOf(value)
      if (start < 0) continue
      // Do not treat corrected 20 as observed inside 120 or 20.50.
      const before = observed[start - 1] || ''; const after = observed[start + value.length] || ''
      if (/^\d/.test(value) && /[\d.]/.test(before) || /\d$/.test(value) && /[\d.]/.test(after)) continue
      if (!passes.some(pass => normalized(pass.text).includes(observed))) continue
      matching.push({ confidence: word.confidence, panelId: panel.id })
    }
  }
  if (!matching.length) return unavailable('No retained scored OCR observation contains this exact current value. A correction or multi-line association has no inherited field score.')
  const minimum = Math.min(...matching.map(item => item.confidence))
  return { value: Math.round(minimum * 10) / 10, band: minimum >= 90 ? 'high' : minimum >= 70 ? 'review' : 'low',
    label: minimum >= 90 ? 'High engine score · verify' : minimum >= 70 ? 'Needs review' : 'Low engine score · verify',
    reason: 'Minimum reported score across retained exact-value OCR observations. Display bands: ≥90, 70–<90, <70; uncalibrated triage thresholds, never verdict gates.',
    observations: matching.length, panels: [...new Set(matching.map(item => item.panelId))] }
}

export function buildInspectionInsights({ record, extraction, fields, checks, hasRecordedOcr, status, saved, running, pendingPreview }) {
  const explanations = fields.map(field => {
    const original = extraction.byId[field.id]
    const related = checks.filter(check => (FIELD_RULES[field.id] || []).includes(check.id))
    const reportedScore = fieldEngineScore(original, record, hasRecordedOcr)
    const passes = related.filter(check => check.status === 'pass').length
    const fails = related.filter(check => check.status === 'fail').length
    const unresolved = related.filter(check => check.status === 'review').length
    const decision = !related.length ? 'NOT ASSESSED' : fails ? 'FLAG' : unresolved ? 'MANUAL REVIEW' : passes ? 'PASS' : 'INFORMATION / EXEMPT'
    return { ...field, reportedScore, relatedChecks: related, decision, hasUsableReading: usable(original),
      presence: usable(original) ? 'Present in working transcript' : field.status === 'absent' ? 'Officer recorded physical absence' : 'Unresolved / not captured',
      validation: original.validation?.message || (usable(original) ? 'Text reading available; no independently validated field accuracy.' : field.reason),
      humanReview: field.status === 'verified' ? 'Field confirmation recorded. Remaining rule, scope and measurement checks may still require review.'
        : field.status === 'absent' ? 'Absence attested after all-panel review; applicability still follows the rule checks.' : 'Required — OCR alone does not confirm this field.',
      rulePack: RULE_PACK.id,
    }
  })
  const panels = record.evidenceItems || []
  const sealed = Boolean(saved || record.sealedAt) && !running && !pendingPreview
  const stages = [
    { id: 'captured', label: 'Images captured', count: panels.length, unit: 'photos', detail: 'Current package photographs; no implied count of visible fields.' },
    { id: 'ocr', label: 'Text detected', count: hasRecordedOcr ? panels.filter(panel => panel.ocrPasses?.some(pass => pass.text?.trim())).length : 0, unit: 'photos', detail: 'Photos with retained nonempty OCR output and a recorded completed run.' },
    { id: 'structured', label: 'Fields extracted', count: fields.filter(field => usable(extraction.byId[field.id])).length, unit: 'fields', detail: 'Usable current readings, including explicit officer corrections; not all necessarily required.' },
    { id: 'validated', label: 'Fields verified', count: fields.filter(field => field.status === 'verified').length, unit: 'fields', detail: 'Current values explicitly confirmed by the officer, not parser scores.' },
    { id: 'rules', label: 'Rules evaluated', count: checks.length, unit: 'checks', detail: 'Current checks, including unresolved applicability and review gates.' },
    { id: 'final', label: 'Final verdict recorded', count: sealed ? 1 : 0, unit: 'records', detail: sealed ? `${verdict[status] || status}; recording a MANUAL REVIEW case does not make it PASS.` : `Unsealed working assessment: ${verdict[status] || 'AWAITING OCR'}.` },
  ]
  return { explanations, mandatory: CORE_DECLARATIONS.map(id => explanations.find(field => field.id === id)).filter(Boolean), stages }
}
