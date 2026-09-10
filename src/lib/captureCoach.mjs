const targets = [
  ['mrp', 'MRP', 'Keep “MRP”, the currency, amount and tax wording together. Avoid confusing a unit price with the package price.'],
  ['netQuantity', 'Net quantity', 'Include “net quantity” or “net weight”, its number and unit. Keep nutrition serving sizes outside the crop.'],
  ['packDate', 'Pack date', 'Include MFD/PKD and the whole date. Do not substitute an expiry date or batch number.'],
]
export const CAPTURE_TARGET_IDS = Object.freeze(targets.map(([id]) => id))
// A printed location pointer is capture guidance, never a numeric declaration.
// Bound associations to nearby lines in the same OCR block / photograph.
export function labelLocationHints(extraction, sourceText = extraction?.raw || '') {
  const lines = String(sourceText).slice(0, 100000).replace(/\r/g, '').split('\n')
  const hints = new Map()
  lines.forEach((line, index) => {
    const pointer = line.match(/\b(?:SEE|REFER\s+TO|CHECK)\s+(?:THE\s+)?((?:BOTTLE\s+)?(?:CAP(?:\s*\/\s*NECK)?|NECK|BASE|BOTTOM|BACK|SIDE)(?:\s+(?:OF\s+PACK|PANEL))?)\b/i)
    if (!pointer) return
    const context = [line]
    for (let offset = 1; offset <= 3; offset++) {
      const previous = lines[index - offset]?.trim()
      if (!previous || previous.startsWith('[')) break
      context.unshift(previous)
    }
    const evidence = context.join(' ').slice(0, 1200)
    for (const [id, heading] of [['mrp', /\b(?:M\s*\.?\s*R\s*\.?\s*P\b|MAXIMUM\s+RETAIL)/i], ['packDate', /\b(?:DATE\s+OF\s+(?:MANUFACTURE|PACKING)|MFD|MFG|PKD|PACKED\s+ON)\b/i]]) {
      const field = extraction?.byId?.[id]
      if (heading.test(evidence) && !field?.value) hints.set(id, { id, location: pointer[1].toLowerCase(), evidence,
        guidance: `The transcript points to the ${pointer[1].toLowerCase()}. Check that area and add a clear photo if it is not captured; this pointer is not the declaration value.` })
    }
  })
  return [...hints.values()]
}
export function validateCloseUpCapture({ target = '', replaceId = '', panelCount, fileCount }) {
  if (!target) return null
  if (!CAPTURE_TARGET_IDS.includes(target) || replaceId) throw new Error('A guided close-up must add one photograph for a supported declaration, not replace earlier evidence.')
  if (!Number.isInteger(panelCount) || panelCount < 1 || panelCount >= 4) throw new Error('A close-up needs a captured panel and a free image slot. Earlier photographs will not be overwritten.')
  if (fileCount !== 1) throw new Error('Choose one new close-up photograph for this declaration.')
  return { target, kind: 'officer-requested-additional-close-up', originalEvidencePreserved: true, suppliesOcrAnswer: false }
}
export function captureTargets(extraction, { hasReading = true } = {}) {
  const locationHints = labelLocationHints(extraction)
  return targets.map(([id, label, guidance]) => {
    const field = extraction?.byId?.[id]
    const issue = !hasReading ? 'Not read yet' : field?.conflict ? 'Conflicting readings' : ['invalid', 'conflict'].includes(field?.validation?.status) ? 'Incomplete reading' : !field?.value ? 'Not detected' : 'Compare with photo'
    const recovery = issue === 'Conflicting readings'
      ? 'Retain both readings. Capture one clear declaration and compare its value with the original; a retry cannot silently resolve a conflict.'
      : hasReading && issue !== 'Compare with photo'
        ? 'OCR has not resolved this field. This does not prove it is absent. If the heading or value is clipped, blurred or obscured, add a new photograph instead of enlarging missing pixels.'
        : 'A source crop uses the existing pixels. A new close-up is a separate photograph with its own evidence hash.'
    return { id, label, guidance, recovery: locationHints.find(hint => hint.id === id)?.guidance || recovery, issue, value: hasReading ? field?.value || '' : '', needsCapture: issue !== 'Compare with photo' }
  })
}
export function fieldReviewComplete(field, meta) {
  const review = meta.fieldReviews?.[field.id]
  const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!review || normalized(review.value) !== normalized(field.value)) return false
  if (review.state === 'absent') return !field.detected && meta.allPanelsCaptured === true && String(review.reason || '').trim().length >= 12
  return review.state === 'confirmed' && Boolean(field.value) && !field.conflict && !['invalid', 'conflict', 'check_digit_invalid'].includes(field.validation?.status) && Boolean(review.reason?.trim())
}
