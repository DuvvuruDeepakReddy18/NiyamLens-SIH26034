// Machine suggestions are convenience data, never officer attestations or a
// physical scale. No defaults, image dimensions or barcode sizes supply mm/cm.
export const CONTEXT_DEFAULTS = Object.freeze({ productName: '', category: 'general', commodityClass: 'standard', quantity: '', unit: 'g', barcode: '', perishable: false })
export const CONTEXT_LABELS = Object.freeze({ productName: 'Product / generic name', category: 'Package profile', commodityClass: 'Commodity class', quantity: 'Net quantity', unit: 'Unit', barcode: 'Barcode / GTIN', perishable: 'Best-before / use-by context' })
const keys = Object.keys(CONTEXT_DEFAULTS)
const paired = key => ['quantity', 'unit'].includes(key) ? ['quantity', 'unit'] : [key]
const equal = (a, b) => String(a ?? '') === String(b ?? '')
const valid = field => Boolean(field?.value) && !field.conflict && !['invalid', 'conflict', 'check_digit_invalid'].includes(field.validation?.status)
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 1e9

export function contextSuggestions(extraction) {
  const fields = extraction?.byId || {}; const suggestions = extraction?.suggestions || {}
  const found = {}
  const add = (key, value, evidence) => { found[key] = { value, evidence: String(evidence || '').slice(0, 500) } }
  if (valid(fields.productName)) add('productName', suggestions.productName, fields.productName.evidence)
  // General/standard are parser fallbacks, not detected classification evidence.
  if (suggestions.category && suggestions.category !== 'general') add('category', suggestions.category, 'Keyword-based profile candidate from the working transcript; confirm against the package.')
  if (suggestions.commodityClass && suggestions.commodityClass !== 'standard') add('commodityClass', suggestions.commodityClass, 'Commodity keyword candidate from the working transcript; confirm applicability.')
  if (valid(fields.netQuantity) && Number.isFinite(suggestions.quantity) && suggestions.quantity > 0 && suggestions.unit) {
    add('quantity', suggestions.quantity, fields.netQuantity.evidence)
    add('unit', suggestions.unit, fields.netQuantity.evidence)
  }
  if (valid(fields.barcode) && fields.barcode.validation?.status === 'check_digit_valid') add('barcode', fields.barcode.value, fields.barcode.evidence)
  if (valid(fields.bestBefore)) add('perishable', true, fields.bestBefore.evidence)
  return found
}

export function markContextEdited(meta, key) {
  if (!keys.includes(key)) return {}
  const previous = meta.contextAutofill || {}
  return { contextAutofill: { ...previous, version: 1, fields: { ...previous.fields }, manual: { ...previous.manual, ...Object.fromEntries(paired(key).map(id => [id, true])) } } }
}

export function applyContextAutofill(meta, extraction) {
  const candidates = contextSuggestions(extraction)
  const previous = meta.contextAutofill || {}
  const manual = { ...previous.manual }; const fields = { ...previous.fields }
  const next = { ...meta }
  // Preserve legacy non-default officer inputs and edits made outside this form.
  for (const key of keys) {
    const before = previous.fields?.[key]
    const unexpected = before ? !equal(meta[key], before.value) : meta[key] != null && meta[key] !== '' && !equal(meta[key], CONTEXT_DEFAULTS[key])
    if (unexpected) for (const id of paired(key)) manual[id] = true
  }
  let changed = false
  for (const key of keys) {
    if (manual[key]) continue
    if (candidates[key]) {
      changed ||= !equal(next[key], candidates[key].value)
      next[key] = candidates[key].value
      fields[key] = candidates[key]
    } else if (fields[key]) {
      changed ||= !equal(next[key], CONTEXT_DEFAULTS[key])
      next[key] = CONTEXT_DEFAULTS[key]
      delete fields[key]
    }
  }
  if (changed) Object.assign(next, { classificationConfirmed: false, rule3ApplicabilityConfirmed: false, placementPdpConfirmed: false })
  next.contextAutofill = { version: 1, fields, manual }
  return next
}

export function useDetectedContext(meta, key, extraction) {
  if (!keys.includes(key) || !contextSuggestions(extraction)[key]) return meta
  const next = { ...meta, contextAutofill: { ...meta.contextAutofill, fields: { ...meta.contextAutofill?.fields }, manual: { ...meta.contextAutofill?.manual } } }
  for (const id of paired(key)) {
    next[id] = CONTEXT_DEFAULTS[id]
    delete next.contextAutofill.fields[id]
    delete next.contextAutofill.manual[id]
  }
  return applyContextAutofill(next, extraction)
}

export function verificationPrefill(field, saved = {}, regions = [], panels = []) {
  saved ||= {}
  const region = regions.find(item => item.id === field.id)
  const panelIndex = panels.findIndex(panel => panel.id === region?.panelId)
  const source = panelIndex >= 0 ? `Suggested source: Panel ${panelIndex + 1} · ${String(panels[panelIndex].name || 'package photo').slice(0, 180)}` : 'Image source not located; compare with the physical label'
  const generated = valid(field) && field.evidence ? `Auto-filled from working transcript: “${String(field.evidence).slice(0, 1300)}”. ${source}. Not an officer verification.` : ''
  const manual = saved.reasonSource === 'officer' || (saved.reasonSource !== 'extraction' && typeof saved.reason === 'string')
  return {
    value: field.value,
    state: saved.value === field.value ? saved.state || 'unreviewed' : 'unreviewed',
    reason: manual ? saved.reason || '' : generated,
    reasonSource: manual ? 'officer' : 'extraction',
  }
}

export function updateGeometryDimension(meta, key, value) {
  const flat = ['panelWidthCm', 'panelHeightCm'].includes(key)
  if (!flat && !['cylinderDiameterCm', 'cylinderHeightCm', 'cylinderCoverage'].includes(key)) throw new Error('Unsupported geometry dimension')
  const next = { ...meta, [key]: value, pdpArea: '', pdpConfirmed: false, placementPdpConfirmed: false, pdpMethod: flat ? 'flat-dimensions' : 'curved-dimensions-estimate' }
  const area = flat
    ? positive(next.panelWidthCm) && positive(next.panelHeightCm) ? Number(next.panelWidthCm) * Number(next.panelHeightCm) : null
    : positive(next.cylinderDiameterCm) && positive(next.cylinderHeightCm) && positive(next.cylinderCoverage) && Number(next.cylinderCoverage) <= 100
      ? Math.PI * Number(next.cylinderDiameterCm) * Number(next.cylinderHeightCm) * Number(next.cylinderCoverage) / 100 : null
  if (positive(area)) next.pdpArea = Math.round(area * 100) / 100 || ''
  return next
}
