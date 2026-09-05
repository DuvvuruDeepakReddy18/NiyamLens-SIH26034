const targets = [
  ['mrp', 'MRP', 'Keep “MRP”, the currency, amount and tax wording together. Avoid confusing a unit price with the package price.'],
  ['netQuantity', 'Net quantity', 'Include “net quantity” or “net weight”, its number and unit. Keep nutrition serving sizes outside the crop.'],
  ['packDate', 'Pack date', 'Include MFD/PKD and the whole date. Do not substitute an expiry date or batch number.'],
]
export function captureTargets(extraction) {
  return targets.map(([id, label, guidance]) => {
    const field = extraction?.byId?.[id]
    const issue = field?.conflict ? 'Conflicting readings' : ['invalid', 'conflict'].includes(field?.validation?.status) ? 'Incomplete reading' : !field?.value ? 'Not detected' : 'Compare with photo'
    return { id, label, guidance, issue, value: field?.value || '', needsCapture: issue !== 'Compare with photo' }
  })
}
export function fieldReviewComplete(field, meta) {
  const review = meta.fieldReviews?.[field.id]
  const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!review || normalized(review.value) !== normalized(field.value)) return false
  if (review.state === 'absent') return !field.detected && meta.allPanelsCaptured === true && String(review.reason || '').trim().length >= 12
  return review.state === 'confirmed' && Boolean(field.value) && !field.conflict && !['invalid', 'conflict'].includes(field.validation?.status) && Boolean(review.reason?.trim())
}
