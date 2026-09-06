const targets = [
  ['mrp', 'MRP', 'Keep “MRP”, the currency, amount and tax wording together. Avoid confusing a unit price with the package price.'],
  ['netQuantity', 'Net quantity', 'Include “net quantity” or “net weight”, its number and unit. Keep nutrition serving sizes outside the crop.'],
  ['packDate', 'Pack date', 'Include MFD/PKD and the whole date. Do not substitute an expiry date or batch number.'],
]
export const CAPTURE_TARGET_IDS = Object.freeze(targets.map(([id]) => id))
export function validateCloseUpCapture({ target = '', replaceId = '', panelCount, fileCount }) {
  if (!target) return null
  if (!CAPTURE_TARGET_IDS.includes(target) || replaceId) throw new Error('A guided close-up must add one photograph for a supported declaration, not replace earlier evidence.')
  if (!Number.isInteger(panelCount) || panelCount < 1 || panelCount >= 4) throw new Error('A close-up needs a captured panel and a free image slot. Earlier photographs will not be overwritten.')
  if (fileCount !== 1) throw new Error('Choose one new close-up photograph for this declaration.')
  return { target, kind: 'officer-requested-additional-close-up', originalEvidencePreserved: true, suppliesOcrAnswer: false }
}
export function captureTargets(extraction, { hasReading = true } = {}) {
  return targets.map(([id, label, guidance]) => {
    const field = extraction?.byId?.[id]
    const issue = !hasReading ? 'Not read yet' : field?.conflict ? 'Conflicting readings' : ['invalid', 'conflict'].includes(field?.validation?.status) ? 'Incomplete reading' : !field?.value ? 'Not detected' : 'Compare with photo'
    const recovery = issue === 'Conflicting readings'
      ? 'Retain both readings. Capture one clear declaration and compare its value with the original; a retry cannot silently resolve a conflict.'
      : hasReading && issue !== 'Compare with photo'
        ? 'OCR has not resolved this field. This does not prove it is absent. If the heading or value is clipped, blurred or obscured, add a new photograph instead of enlarging missing pixels.'
        : 'A source crop uses the existing pixels. A new close-up is a separate photograph with its own evidence hash.'
    return { id, label, guidance, recovery, issue, value: hasReading ? field?.value || '' : '', needsCapture: issue !== 'Compare with photo' }
  })
}
export function fieldReviewComplete(field, meta) {
  const review = meta.fieldReviews?.[field.id]
  const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!review || normalized(review.value) !== normalized(field.value)) return false
  if (review.state === 'absent') return !field.detected && meta.allPanelsCaptured === true && String(review.reason || '').trim().length >= 12
  return review.state === 'confirmed' && Boolean(field.value) && !field.conflict && !['invalid', 'conflict'].includes(field.validation?.status) && Boolean(review.reason?.trim())
}
