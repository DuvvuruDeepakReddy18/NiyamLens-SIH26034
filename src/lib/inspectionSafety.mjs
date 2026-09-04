import { extractDeclarations } from './extraction.mjs'
import { evaluateCompliance } from './rules.mjs'
export const FIELD_RULES = { productName: ['genericName'], mrp: ['mrp', 'mrpFormat'], netQuantity: ['netQuantity'], packDate: ['packDate'], responsibleEntity: ['manufacturer'], consumerCare: ['consumerCare'], consumerAddress: ['consumerAddress'], phone: ['consumerPhone'], email: ['consumerEmail'], countryOrigin: ['countryOrigin'], unitSalePrice: ['unitSalePrice'], bestBefore: ['bestBefore'] }
export const REVIEW_STATES = ['unreviewed', 'confirmed', 'absent', 'unreadable', 'not_captured']
const normalized = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
export function fieldCandidates(passes = []) {
  const candidates = {}
  for (const pass of passes) {
    for (const field of extractDeclarations(pass.text || '').fields.filter((item) => item.detected && FIELD_RULES[item.id])) {
      const list = candidates[field.id] ||= []
      const key = normalized(field.value)
      const match = list.find((item) => item.key === key)
      if (match) match.sources.push(pass.id)
      else list.push({ key, value: field.value, evidence: field.evidence, sources: [pass.id] })
    }
  }
  return candidates
}
export function evaluateInspection({ text = '', meta = {} }) {
  const result = evaluateCompliance({ text, meta })
  if (!meta.enforceEvidenceReview) return result
  const checks = result.checks.map((check) => ({ ...check }))
  const extraction = extractDeclarations(text)
  for (const [fieldId, ruleIds] of Object.entries(FIELD_RULES)) {
    const review = meta.fieldReviews?.[fieldId]
    const field = extraction.byId[fieldId]
    const validConfirmation = review?.state === 'confirmed' && normalized(review.value) === normalized(field?.value) && Boolean(review.value) && Boolean(review.reason?.trim())
    const validAbsence = review?.state === 'absent' && meta.allPanelsCaptured === true && String(review.reason || '').trim().length >= 12
    for (const check of checks.filter((item) => ruleIds.includes(item.id))) {
      if (validConfirmation && check.status === 'pass') continue
      if (validAbsence && check.status === 'fail' && !field?.detected) continue
      if (['pass', 'fail'].includes(check.status)) {
        check.status = 'review'
        check.reason = meta.fieldCandidates?.[fieldId]?.length > 1
          ? 'OCR passes disagree. Compare the competing readings with the source and confirm this field.'
          : review?.state === 'not_captured' ? 'The declaration panel has not been photographed.'
            : review?.state === 'unreadable' ? 'The field is unreadable; missing OCR is not proof of absence.'
              : 'Field-level verification is required. An engine or heuristic score is not a calibrated probability.'
      }
    }
  }
  for (const check of checks.filter((item) => /fontHeight|fontWidth|panelArea/.test(item.id))) {
    if ((!meta.pdpConfirmed || !meta.measurementConfirmed || meta.measurementSurface !== 'flat') && ['pass', 'fail'].includes(check.status)) {
      check.status = 'review'; check.reason = 'Confirm the physical PDP and same-plane reference/glyph measurement. Unvalidated curved-surface and OCR line-box measurements cannot decide typography.'
    }
  }
  for (const check of checks.filter((item) => item.id.startsWith('fontWidth'))) {
    if (!meta.widthCharacterConfirmed && ['pass', 'fail'].includes(check.status)) {
      check.status = 'review'; check.reason = 'Confirm that the measured character is subject to the width requirement; do not flag an excepted narrow character.'
    }
  }
  const quantityReview = meta.fieldReviews?.netQuantity
  if (result.context.exemption?.exempt && (!meta.classificationConfirmed || quantityReview?.state !== 'confirmed' || !quantityReview.reason?.trim() || normalized(quantityReview.value) !== normalized(extraction.byId.netQuantity?.value) || Number(meta.quantity) !== extraction.suggestions.quantity || normalized(meta.unit) !== normalized(extraction.suggestions.unit))) {
    checks.push({ id: 'exemptionEvidence', label: 'Exemption evidence confirmation', rule: 'Evidence safety policy', status: 'review', reason: 'Confirm package classification and quantity against the physical label before applying an exemption.', evidence: 'Unconfirmed exemption inputs' })
  }
  const counts = { pass: 0, fail: 0, review: 0 }
  checks.forEach((check) => { if (check.status in counts) counts[check.status] += 1 })
  const count = counts.pass + counts.fail + counts.review
  return { ...result, checks, counts, score: count ? Math.round(counts.pass / count * 100) : 0, status: counts.fail ? 'non_compliant' : counts.review ? 'manual_review' : result.context.exemption?.exempt ? 'exempt' : 'compliant' }
}
export function calibrationSummary(samples = []) {
  const valid = samples.filter((item) => Number(item.referenceMm) > 0 && Number(item.measuredMm) > 0)
  if (!valid.length) return { count: 0, meanAbsoluteErrorMm: null, maxAbsoluteErrorMm: null, validated: false }
  const errors = valid.map((item) => Math.abs(Number(item.measuredMm) - Number(item.referenceMm)))
  return { count: valid.length, meanAbsoluteErrorMm: errors.reduce((a, b) => a + b, 0) / errors.length, maxAbsoluteErrorMm: Math.max(...errors), validated: false }
}
