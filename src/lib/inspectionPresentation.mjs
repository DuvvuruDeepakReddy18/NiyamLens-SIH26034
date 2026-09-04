import { FIELD_RULES } from './inspectionSafety.mjs'

export const qualityIdentity = (item) => item
  ? `${item.sha256 || item.id}:${item.rotation || 0}:${item.contrast || 100}:${item.grayscale ? 1 : 0}`
  : ''

export function qualityDecisionRequired(evidenceItems = [], acknowledgements = {}) {
  return evidenceItems.some((item) => (
    ['review', 'poor'].includes(item.quality?.status)
    && acknowledgements?.[item.id]?.identity !== qualityIdentity(item)
  ))
}

export const EVIDENCE_FACES = [
  { id: 'front', label: 'Front / identity', short: 'Front', angle: 0 },
  { id: 'price_date', label: 'MRP and pack date', short: 'MRP + date', angle: -90 },
  { id: 'responsible_care', label: 'Manufacturer and consumer care', short: 'Maker + care', angle: -180 },
  { id: 'quantity_barcode', label: 'Net quantity and barcode', short: 'Qty + barcode', angle: -270 },
]

const usableReview = (field, review, allPanelsCaptured) => {
  if (!review || review.value !== field.value || review.state === 'unreviewed') return false
  const note = String(review.reason || '').trim()
  if (review.state === 'confirmed') return Boolean(field.value && note)
  if (review.state === 'absent') return !field.detected && allPanelsCaptured === true && note.length >= 12
  return ['unreadable', 'not_captured'].includes(review.state) && Boolean(note)
}

export function evidenceCoverage(evidenceItems = []) {
  const completePanel = evidenceItems.find((item) => item.panelRole === 'full_declaration')
  return EVIDENCE_FACES.map((face) => {
    const exact = evidenceItems.find((item) => item.panelRole === face.id)
    const fallback = face.id === 'front' ? null : completePanel
    const evidence = exact || fallback || null
    return {
      ...face,
      evidence,
      covered: Boolean(evidence),
      coverage: exact ? 'assigned' : fallback ? 'complete-panel' : 'missing',
      quality: evidence?.quality?.status || 'unknown',
    }
  })
}

export function fieldReviewProgress(extraction = { fields: [] }, meta = {}, result) {
  const emittedChecks = new Set((result?.checks || []).map((check) => check.id))
  const fields = (extraction.fields || []).filter((field) => FIELD_RULES[field.id]?.some((checkId) => emittedChecks.has(checkId)))
  const reviewed = fields.filter((field) => usableReview(field, meta.fieldReviews?.[field.id], meta.allPanelsCaptured)).length
  return { reviewed, total: fields.length, complete: fields.length > 0 && reviewed === fields.length && meta.classificationConfirmed === true }
}

export function inspectionProgress({ evidenceItems = [], extraction, provenance = {}, meta = {}, result, saved = false } = {}) {
  const coverage = evidenceCoverage(evidenceItems)
  const covered = coverage.filter((face) => face.covered).length
  const reviews = fieldReviewProgress(extraction, meta, result)
  const calibrated = Object.values(meta.panelMeasurements || {}).some((measurement) => Number(measurement.referencePx) > 0 && Number(measurement.glyphPx) > 0)
  const exempt = result?.context?.exemption?.exempt === true
  const measurementReady = exempt || (calibrated && meta.pdpConfirmed === true && meta.measurementConfirmed === true && meta.measurementSurface === 'flat')
  const hasWorkingText = Boolean(extraction?.raw?.trim())
  const assessmentReady = evidenceItems.length > 0 && hasWorkingText

  return [
    { id: 'capture', label: 'Capture', summary: `${covered}/4 suggested views covered`, complete: evidenceItems.length > 0, started: evidenceItems.length > 0 },
    { id: 'recognize', label: 'Recognize', summary: provenance.hasRun ? `${String(provenance.source || 'OCR').replaceAll('-', ' ')}` : hasWorkingText ? 'Manual text only' : 'Not run', complete: Boolean(provenance.hasRun && hasWorkingText), started: hasWorkingText },
    { id: 'verify', label: 'Verify', summary: `${reviews.reviewed}/${reviews.total || 0} fields reviewed`, complete: reviews.complete, started: reviews.reviewed > 0 },
    { id: 'measure', label: 'Measure', summary: exempt ? 'Not required for exemption' : measurementReady ? 'Geometry confirmed' : calibrated ? 'Calibration needs confirmation' : 'Not calibrated', complete: measurementReady, started: calibrated },
    { id: 'evaluate', label: 'Evaluate', summary: assessmentReady ? String(result?.status || 'pending').replaceAll('_', ' ') : 'Awaiting evidence', complete: assessmentReady, started: assessmentReady },
    { id: 'seal', label: 'Seal', summary: saved ? 'Evidence sealed' : 'Draft record', complete: saved, started: saved },
  ].map((stage, index, stages) => {
    const previousComplete = stages.slice(0, index).every((item) => item.complete)
    return { ...stage, state: stage.complete ? 'complete' : stage.started || previousComplete ? 'current' : 'waiting' }
  })
}

export function evidenceTrace({ fieldId, extraction, regions = [], evidenceItems = [], result, meta = {} } = {}) {
  if (!fieldId || !FIELD_RULES[fieldId]) return null
  const field = extraction?.byId?.[fieldId] || extraction?.fields?.find((item) => item.id === fieldId)
  if (!field) return null
  const region = regions.find((item) => item.id === fieldId) || null
  const panelIndex = region ? evidenceItems.findIndex((item) => item.id === region.panelId) : -1
  const panel = panelIndex >= 0 ? evidenceItems[panelIndex] : null
  const ruleIds = FIELD_RULES[fieldId]
  const checks = (result?.checks || []).filter((check) => ruleIds.includes(check.id))
  const review = meta.fieldReviews?.[fieldId] || null
  return { field, region, panel, panelIndex, ruleIds, checks, review }
}
