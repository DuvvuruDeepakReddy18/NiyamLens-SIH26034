// Rule 8 support is deliberately officer-assisted. This module does not infer a
// legal PDP from an image silhouette or certify the truth of client measurements.
export const PLACEMENT_FIELDS = ['productName', 'mrp', 'netQuantity', 'packDate', 'responsibleEntity', 'consumerCare', 'unitSalePrice']
const states = ['unreviewed', 'inside_pdp', 'outside_pdp', 'unreadable']
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const norm = (v) => typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : ''
const number = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim())) && Number.isFinite(Number(v)) ? Number(v) : null

export function validatePlacementMetadata(meta = {}) {
  const issues = []
  const add = (field, reason) => issues.push({ field, reason })
  if (meta.placementScope !== undefined && !['unknown', 'general_flat', 'specialist'].includes(meta.placementScope)) add('placementScope', 'Choose a supported placement-review scope.')
  if (meta.placementPdpConfirmed !== undefined && typeof meta.placementPdpConfirmed !== 'boolean') add('placementPdpConfirmed', 'PDP confirmation must be a boolean.')
  if (meta.placementReviews !== undefined) {
    if (!plain(meta.placementReviews) || Object.keys(meta.placementReviews).length > 20) add('placementReviews', 'Expected a bounded placement-review map.')
    else for (const [id, review] of Object.entries(meta.placementReviews)) {
      if (!PLACEMENT_FIELDS.includes(id) || !plain(review) || !states.includes(review.state)) { add(`placementReviews.${id}`, 'Invalid declaration placement review.'); continue }
      for (const key of ['panelId', 'value', 'reason']) if (review[key] !== undefined && (typeof review[key] !== 'string' || review[key].length > 2000)) add(`placementReviews.${id}.${key}`, 'Expected bounded review text.')
      if (review.panelId && Array.isArray(meta.evidencePanelIds) && !meta.evidencePanelIds.includes(review.panelId)) add(`placementReviews.${id}.panelId`, 'Placement must reference a captured panel.')
    }
  }
  if (meta.quantitySpacing !== undefined) {
    const spacing = meta.quantitySpacing
    if (!plain(spacing)) add('quantitySpacing', 'Expected measured clear-space values.')
    else {
      for (const key of ['numeralHeightPx', 'abovePx', 'belowPx', 'leftPx', 'rightPx', 'uncertaintyPercent']) {
        if (spacing[key] === undefined || spacing[key] === '') continue
        const n = number(spacing[key])
        if (n === null || n < 0 || (key === 'numeralHeightPx' && n === 0) || n > (key === 'uncertaintyPercent' ? 50 : 100000)) add(`quantitySpacing.${key}`, 'Supply finite, non-negative lengths; numeral height must be positive and uncertainty at most 50%.')
      }
      if (spacing.confirmed !== undefined && typeof spacing.confirmed !== 'boolean') add('quantitySpacing.confirmed', 'Clear-space confirmation must be a boolean.')
      for (const key of ['panelId', 'value', 'reason']) if (spacing[key] !== undefined && (typeof spacing[key] !== 'string' || spacing[key].length > 2000)) add(`quantitySpacing.${key}`, 'Expected bounded clear-space evidence text.')
      if (spacing.panelId && Array.isArray(meta.evidencePanelIds) && !meta.evidencePanelIds.includes(spacing.panelId)) add('quantitySpacing.panelId', 'Clear-space measurement must reference captured evidence.')
    }
  }
  return issues
}

export function evaluatePlacement({ meta = {}, extraction, exempt = false, ruleChecks = [] } = {}) {
  // Omitted panel IDs identify isolated legacy/pure-rule evaluation, not a scan.
  if (!Array.isArray(meta.evidencePanelIds) || exempt) return []
  const check = (id, label, status, reason, evidence = '') => ({ id, label, rule: 'Rule 8 — officer-assisted placement / quantity clear space', status, reason, evidence })
  if (validatePlacementMetadata(meta).length) return [check('placement', 'Declaration placement', 'review', 'Placement input is invalid; correct it before evaluating.')]
  if (meta.category !== 'general' || meta.placementScope !== 'general_flat' || meta.placementPdpConfirmed !== true || meta.measurementSurface !== 'flat') return [
    check('placement', 'Declaration placement', 'review', 'Identify the legal PDP and the general flat-package scope. Specialist/curved profiles require officer assessment; photo layout alone is not proof of legal placement.'),
    check('quantityClearSpace', 'Net-quantity clear space', 'review', 'Supported measurement scope is an officer-confirmed flat package plane. Other profiles remain manual review.'),
  ]
  const fields = PLACEMENT_FIELDS.filter(id => id !== 'unitSalePrice' || !ruleChecks.some(c => c.id === 'unitSalePrice' && c.status === 'info'))
  const checks = fields.map((id) => {
    const field = extraction?.byId?.[id]
    const review = meta.placementReviews?.[id]
    const valid = field?.detected && !field.conflict && norm(field.value) && norm(review?.value) === norm(field.value) && meta.evidencePanelIds.includes(review?.panelId) && typeof review?.reason === 'string' && review.reason.trim().length >= 12
    const status = valid && review.state === 'inside_pdp' ? 'pass' : valid && review.state === 'outside_pdp' ? 'fail' : 'review'
    return check(`placement:${id}`, `${field?.label || id} placement`, status,
      status === 'pass' ? 'Officer recorded this declaration on the verified PDP. This is a human placement observation, not automated image certification.' : status === 'fail' ? 'Officer recorded the declaration outside the verified PDP in the supported general flat-package scope; confirm applicability before enforcement.' : 'Locate the declaration on captured evidence, select its physical placement and record a source note. A changed reading invalidates the old observation.',
      valid ? `${review.panelId}: ${review.reason}` : field?.evidence || '')
  })
  const spacing = meta.quantitySpacing || {}
  const quantity = extraction?.byId?.netQuantity
  const height = number(spacing.numeralHeightPx)
  const uncertainty = number(spacing.uncertaintyPercent)
  const gaps = ['abovePx', 'belowPx', 'leftPx', 'rightPx'].map((key) => number(spacing[key]))
  const complete = spacing.confirmed === true && typeof spacing.reason === 'string' && spacing.reason.trim().length >= 12 && meta.evidencePanelIds.includes(spacing.panelId) && quantity?.detected && !quantity.conflict && norm(spacing.value) === norm(quantity.value) && height > 0 && uncertainty !== null && gaps.every((gap) => gap !== null)
  if (!complete) checks.push(check('quantityClearSpace', 'Net-quantity clear space', 'review', 'Measure the numeral height and four nearest printed-information gaps on the same plane, include uncertainty, and confirm the source. OCR line height is not a numeral measurement.'))
  else {
    const u = uncertainty / 100
    const bounds = gaps.map((gap, index) => {
      const multiplier = index < 2 ? 1 : 2
      return gap * (1 - u) >= height * (1 + u) * multiplier ? 'pass' : gap * (1 + u) < height * (1 - u) * multiplier ? 'fail' : 'review'
    })
    const status = bounds.includes('fail') ? 'fail' : bounds.includes('review') ? 'review' : 'pass'
    checks.push(check('quantityClearSpace', 'Net-quantity clear space', status, status === 'pass' ? 'Supplied gaps remain at least one numeral height above/below and twice its height left/right, including stated uncertainty. Measurements are officer-supplied.' : status === 'fail' ? 'At least one supplied gap remains below the encoded minimum even after uncertainty; officer verification of the measurement and rule scope is required.' : 'Measurement uncertainty crosses a clear-space threshold; improve measurement or retain manual review.', `${spacing.panelId}; height ${height}px; gaps ${gaps.join('/')}px; uncertainty ±${uncertainty}%; ${spacing.reason}`))
  }
  return checks
}
