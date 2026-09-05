import { validatePlacementMetadata } from './placement.mjs'
import { RULE3_COMMODITY_CLASSES, RULE3_CONSUMER_SCOPES } from './applicability.mjs'
export const INSPECTION_LIMITS = { text: 100000, dimension: 1e9, quantity: 1e12, uncertainty: 100 }
export const INSPECTION_ENUMS = {
  category: ['general', 'food', 'imported', 'medical'],
  commodityClass: ['standard', 'tobacco', 'pan_masala', 'medical_device', 'fast_food', 'drug_formulation'],
  rule3ConsumerScope: RULE3_CONSUMER_SCOPES,
  rule3CommodityClass: RULE3_COMMODITY_CLASSES,
  unit: ['g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'ml', 'l', 'ltr', 'pcs', 'pc', 'n', 'nos'],
  measurementSurface: ['unverified', 'flat', 'curved'],
}
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))
export const finiteNumber = value => {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const absent = v => v === undefined || v === null || v === ''
export function validateInspectionMetadata(meta) {
  if (!plain(meta)) return [{ field: 'meta', reason: 'Inspection metadata must be an object.' }]
  const issues = []
  const add = (field, reason) => issues.push({ field, reason })
  const textLimits = { productName: 500, barcode: 100, pdpMethod: 100, packageRef: 200, ocrSource: 100, ocrCompletedAt: 100, ocrLanguage: 100, translationLanguage: 100, translationText: 100000, ocrReliabilityReason: 2000 }
  for (const [key, max] of Object.entries(textLimits)) if (!absent(meta[key]) && (typeof meta[key] !== 'string' || meta[key].length > max)) add(key, `Expected text no longer than ${max} characters.`)
  const number = (obj, key, min, max, prefix = '', allowZero = false) => {
    if (absent(obj[key])) return
    const n = finiteNumber(obj[key])
    if (n === null || (allowZero ? n < min : n <= min) || n > max) add(prefix + key, `Expected a finite ${allowZero ? 'non-negative' : 'positive'} number no greater than ${max}.`)
  }
  for (const key of ['pdpArea', 'referenceMm', 'referencePx', 'glyphPx', 'glyphWidthPx', 'panelWidthCm', 'panelHeightCm', 'cylinderDiameterCm', 'cylinderHeightCm']) number(meta, key, 0, INSPECTION_LIMITS.dimension)
  number(meta, 'quantity', 0, INSPECTION_LIMITS.quantity)
  for (const key of ['pdpUncertainty', 'measurementUncertainty', 'ocrConfidence', 'ocrEngineConfidence', 'cylinderCoverage']) number(meta, key, 0, 100, '', true)
  for (const key of ['enforceEvidenceReview', 'allPanelsCaptured', 'classificationConfirmed', 'rule3ApplicabilityConfirmed', 'pdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed', 'formedText', 'perishable']) {
    if (meta[key] !== undefined && typeof meta[key] !== 'boolean') add(key, 'Confirmation flags must be true or false booleans.')
  }
  for (const [key, values] of Object.entries(INSPECTION_ENUMS)) {
    if (!absent(meta[key]) && (typeof meta[key] !== 'string' || !values.includes(meta[key]))) add(key, 'Unsupported inspection profile or unit; select a supported value.')
  }
  if (meta.rule3ApplicabilityConfirmed === true && (!meta.rule3ConsumerScope || meta.rule3ConsumerScope === 'unknown')) add('rule3ApplicabilityConfirmed', 'A confirmed Rule 3 assessment requires a known purchaser context.')
  if (meta.evidencePanelIds !== undefined && (!Array.isArray(meta.evidencePanelIds) || meta.evidencePanelIds.length > 4 || meta.evidencePanelIds.some(v => typeof v !== 'string' || !v || v.length > 200) || new Set(meta.evidencePanelIds).size !== meta.evidencePanelIds.length)) add('evidencePanelIds', 'One to four unique nonempty panel identifiers are supported.')
  if (meta.panelMeasurements !== undefined) {
    if (!plain(meta.panelMeasurements) || Object.keys(meta.panelMeasurements).length > 4) add('panelMeasurements', 'Expected at most four panel measurement objects.')
    else for (const [id, measurement] of Object.entries(meta.panelMeasurements)) {
      if (!id || id.length > 200 || !plain(measurement)) { add(`panelMeasurements.${id}`, 'Invalid panel measurement.'); continue }
      for (const key of ['referencePx', 'glyphPx', 'glyphWidthPx']) number(measurement, key, 0, INSPECTION_LIMITS.dimension, `panelMeasurements.${id}.`)
    }
  }
  if (meta.qualityAcknowledgements !== undefined) {
    if (!plain(meta.qualityAcknowledgements) || Object.keys(meta.qualityAcknowledgements).length > 4) add('qualityAcknowledgements', 'Expected at most four image-quality acknowledgements.')
    else for (const [id, acknowledgement] of Object.entries(meta.qualityAcknowledgements)) {
      if (!id || id.length > 200 || !plain(acknowledgement)) { add(`qualityAcknowledgements.${id}`, 'Invalid image-quality acknowledgement.'); continue }
      if (Array.isArray(meta.evidencePanelIds) && !meta.evidencePanelIds.includes(id)) add(`qualityAcknowledgements.${id}`, 'Quality acknowledgement must reference captured evidence.')
      if (typeof acknowledgement.identity !== 'string' || !acknowledgement.identity || acknowledgement.identity.length > 400) add(`qualityAcknowledgements.${id}.identity`, 'Expected a bounded evidence identity.')
      if (!['review', 'poor'].includes(acknowledgement.status) || acknowledgement.action !== 'continue_with_caution') add(`qualityAcknowledgements.${id}`, 'Unsupported image-quality decision.')
      if (!Number.isFinite(acknowledgement.score) || acknowledgement.score < 0 || acknowledgement.score > 100) add(`qualityAcknowledgements.${id}.score`, 'Expected a score from 0 to 100.')
      if (typeof acknowledgement.at !== 'string' || acknowledgement.at.length > 40 || !Number.isFinite(Date.parse(acknowledgement.at))) add(`qualityAcknowledgements.${id}.at`, 'Expected a valid acknowledgement timestamp.')
    }
  }
  if (meta.fieldReviews !== undefined) {
    if (!plain(meta.fieldReviews) || Object.keys(meta.fieldReviews).length > 30) add('fieldReviews', 'Expected a bounded field-review map.')
    else for (const [key, review] of Object.entries(meta.fieldReviews)) {
      if (!plain(review)) { add(`fieldReviews.${key}`, 'Expected a field-review object.'); continue }
      if (!['unreviewed', 'confirmed', 'absent', 'unreadable', 'not_captured'].includes(review.state)) add(`fieldReviews.${key}.state`, 'Unknown verification state.')
      for (const part of ['value', 'reason']) if (review[part] !== undefined && (typeof review[part] !== 'string' || review[part].length > 2000)) add(`fieldReviews.${key}.${part}`, 'Expected text no longer than 2000 characters.')
    }
  }
  return [...issues, ...validatePlacementMetadata(meta)]
}
