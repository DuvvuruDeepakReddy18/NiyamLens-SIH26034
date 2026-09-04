// Shared workflow guards. Recorded OCR provenance is an officer/client observation,
// never independent attestation that the photographed package was genuine.
export const MAX_EVIDENCE_TEXT = 100000
export const EMPTY_OCR = Object.freeze({
  ocrConfidence: null,
  ocrEngineConfidence: null,
  ocrCompletedAt: null,
  ocrReliabilityReason: '',
  ocrSource: 'none',
})

const percent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
const metadata = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const runEvents = new Set(['ocr_completed', 'connected_ocr_completed'])
export function ocrProvenance(record = {}) {
  record = metadata(record)
  const meta = metadata(record.meta)
  const events = Array.isArray(record.clientAuditChain) ? record.clientAuditChain : Array.isArray(record.auditChain) ? record.auditChain : []
  const event = [...events].reverse().find((item) => item && runEvents.has(item.type) && typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)))
  const source = typeof meta.ocrSource === 'string' ? meta.ocrSource.trim() : ''
  const validSource = meta.ocrSource == null || typeof meta.ocrSource === 'string'
  const hasRun = Boolean(event && typeof record.rawOcrText === 'string' && record.rawOcrText.trim() && validSource && source !== 'none')
  return {
    hasRun,
    source: hasRun ? (source || (event.type === 'connected_ocr_completed' ? 'connected' : 'local')) : 'manual-or-unrecorded',
    completedAt: hasRun ? event.at : null,
    reliability: hasRun ? percent(meta.ocrConfidence) : null,
    engineConfidence: hasRun ? percent(meta.ocrEngineConfidence) : null,
    description: hasRun ? 'Recorded OCR run; scores are unvalidated heuristics, not accuracy probabilities.' : 'No completed OCR run recorded. Text is manual or unverified; OCR confidence is unavailable.',
  }
}

export function restoreEvidencePolicy(record = {}) {
  record = metadata(record)
  const original = metadata(record.meta)
  const provenance = ocrProvenance(record)
  return {
    ...original, ...(!provenance.hasRun ? EMPTY_OCR : {}),
    ocrConfidence: provenance.reliability, ocrEngineConfidence: provenance.engineConfidence,
    ocrCompletedAt: provenance.completedAt,
    ocrSource: provenance.hasRun ? provenance.source : 'none',
    enforceEvidenceReview: true,
  }
}

// Changing captured evidence invalidates observations made against the previous
// images. Leave officer-entered profile/dimensions and separately stored text alone.
export function invalidateCapturedEvidence(meta = {}) {
  return {
    ...metadata(meta), ...EMPTY_OCR,
    fieldReviews: {}, fieldCandidates: {}, placementReviews: {}, quantitySpacing: {},
    allPanelsCaptured: false, classificationConfirmed: false, placementPdpConfirmed: false,
    measurementConfirmed: false, widthCharacterConfirmed: false,
  }
}

export function validateSealableEvidence({ evidenceItems = [], text = '', processing = false, ocrRunning = false } = {}) {
  if (processing || ocrRunning) throw new Error('Wait for capture or OCR to finish before sealing the inspection.')
  if (!Array.isArray(evidenceItems) || evidenceItems.length < 1 || evidenceItems.length > 4) throw new Error('Capture at least one package photograph before finalizing. Text-only input cannot be sealed as image-supported evidence.')
  if (new Set(evidenceItems.map((item) => item?.id)).size !== evidenceItems.length || evidenceItems.some((item) => typeof item?.id !== 'string' || !item.id || typeof item.analysisUrl !== 'string' || !item.analysisUrl)) throw new Error('Captured evidence is incomplete or duplicated. Retake the affected panel.')
  if (typeof text !== 'string' || !text.trim()) throw new Error('Run OCR or enter the visible declaration text before finalizing. An unreadable image must remain an unfinished inspection.')
  if (text.length > MAX_EVIDENCE_TEXT) throw new Error(`Evidence text exceeds the ${MAX_EVIDENCE_TEXT.toLocaleString('en-IN')}-character limit.`)
  return true
}

export function nextPageOffset(current, next, pageNumber = 0) {
  if (next === null) return null
  if (!Number.isSafeInteger(next) || next <= current || next > 100000 || pageNumber >= 5000) throw new Error('History pagination stopped because the server returned an invalid or repeated cursor. No local evidence was removed.')
  return next
}
