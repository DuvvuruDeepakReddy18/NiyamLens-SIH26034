import { HttpError, uuid } from './security.mjs'
import { validateOcrHistory, OCR_OUTPUT_LIMITS } from '../src/lib/ocrHistory.mjs'
export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
export function validateJsonShape(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 50000 || depth > 16) throw new HttpError(413, 'Case metadata is too deeply nested or complex.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value === undefined) return
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new HttpError(400, 'Metadata numbers must be finite.'); return }
  if (!Array.isArray(value) && !isObject(value)) throw new HttpError(400, 'Case metadata must contain only plain JSON values.')
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new HttpError(400, 'Reserved metadata key.')
    validateJsonShape(child, depth + 1, budget)
  }
}
function string(value, field, max, required = false) {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, `Invalid ${field}.`)
}
function timestamp(value, field, required = false) {
  if (value === undefined && !required) return
  string(value, field, 40, true)
  if (!Number.isFinite(Date.parse(value))) throw new HttpError(400, `Invalid ${field} timestamp.`)
}
const PANEL_ROLES = ['front', 'price_date', 'responsible_care', 'quantity_barcode', 'full_declaration', 'other']
export function validatePanels(panels) {
  if (!Array.isArray(panels) || panels.length < 1 || panels.length > 4) throw new HttpError(422, 'One to four verified evidence panels are required.')
  const ids = new Set()
  const validated = panels.map((panel) => {
    if (!isObject(panel) || !uuid(panel.id) || ids.has(panel.id.toLowerCase())) throw new HttpError(400, 'Each evidence panel must have a unique UUID.')
    ids.add(panel.id.toLowerCase())
    string(panel.name, 'panel name', 300)
    for (const kind of ['original', 'analysis']) {
      string(panel[`${kind}Path`], `${kind} evidence path`, 1024, true)
      if (!/^[A-Za-z0-9_/-]+$/.test(panel[`${kind}Path`])) throw new HttpError(400, 'Invalid private evidence path.')
    }
    if (!/^[a-f0-9]{64}$/.test(panel.sha256 || '')) throw new HttpError(400, 'A SHA-256 digest is required for every original panel.')
    if (panel.panelRole !== undefined && !PANEL_ROLES.includes(panel.panelRole)) throw new HttpError(400, 'Invalid panel role.')
    timestamp(panel.capturedAt, 'panel capture')
    if (panel.rotation !== undefined && (!Number.isFinite(panel.rotation) || panel.rotation < -360 || panel.rotation > 360)) throw new HttpError(400, 'Invalid panel rotation.')
    if (panel.perspective !== undefined) {
      const p = panel.perspective
      if (!isObject(p) || !['four-point-homography', 'barcode-plane-homography'].includes(p.method) || !Number.isSafeInteger(p.width) || !Number.isSafeInteger(p.height) || p.width < 1 || p.height < 1 || p.width > 10000 || p.height > 10000 || !Array.isArray(p.points) || p.points.length !== 4 || p.points.some((point) => !isObject(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > 10000 || point.y > 10000)) throw new HttpError(400, 'Invalid panel perspective geometry.')
      string(p.format, 'barcode format', 30)
    }
    const { id, name, originalPath, analysisPath, sha256, panelRole, capturedAt, perspective, rotation } = panel
    const ocr = {}
    for (const key of ['ocrText', 'connectedOcrText']) if (panel[key] !== undefined) { string(panel[key], key, OCR_OUTPUT_LIMITS.textPerPass); ocr[key] = panel[key] }
    for (const key of ['ocrProvider', 'ocrModel', 'ocrStrategy']) if (panel[key] !== undefined) { string(panel[key], key, 80); ocr[key] = panel[key] }
    for (const key of ['ocrConfidence', 'ocrReliability', 'ocrAgreement']) if (panel[key] !== undefined) {
      if (panel[key] !== null && (typeof panel[key] !== 'number' || !Number.isFinite(panel[key]) || panel[key] < 0 || panel[key] > 100)) throw new HttpError(400, `Invalid ${key}.`)
      ocr[key] = panel[key]
    }
    if (panel.ocrPasses !== undefined) {
      if (!Array.isArray(panel.ocrPasses) || panel.ocrPasses.length > OCR_OUTPUT_LIMITS.passesPerPanel) throw new HttpError(400, 'Invalid OCR pass history.')
      ocr.ocrPasses = panel.ocrPasses.map(pass => {
        if (!isObject(pass)) throw new HttpError(400, 'Invalid OCR pass metadata.')
        string(pass.id, 'OCR pass identifier', 240, true); string(pass.text, 'raw OCR pass text', OCR_OUTPUT_LIMITS.textPerPass, false)
        if (typeof pass.text !== 'string') throw new HttpError(400, 'Raw OCR pass text must be a string.')
        const retained = { id: pass.id, text: pass.text }
        for (const key of ['provider', 'model', 'strategy']) if (pass[key] !== undefined) { string(pass[key], `OCR pass ${key}`, 80); retained[key] = pass[key] }
        if (pass.confidence !== undefined) {
          if (pass.confidence !== null && (typeof pass.confidence !== 'number' || !Number.isFinite(pass.confidence) || pass.confidence < 0 || pass.confidence > 100)) throw new HttpError(400, 'Invalid OCR pass confidence.')
          retained.confidence = pass.confidence
        }
        return retained
      })
    }
    // Preserved observations remain untrusted client evidence, not a provider
    // signature or independent attestation that recognition actually ran.
    if (Object.keys(ocr).length) ocr.ocrClientReported = true
    return { id, name, originalPath, analysisPath, sha256, panelRole, capturedAt, perspective, rotation, ...ocr }
  })
  try { validateOcrHistory(validated) } catch (error) { throw new HttpError(400, error.message) }
  return validated
}
export function validateAudit(chain) {
  if (chain === undefined) return []
  if (!Array.isArray(chain) || chain.length > 1000) throw new HttpError(400, 'Client audit must be an array of at most 1,000 events.')
  return chain.map((event, index) => {
    if (!isObject(event)) throw new HttpError(400, 'Invalid client audit event.')
    if (event.type === 'controlled_packet_loaded') throw new HttpError(422, 'Controlled fixtures cannot be sealed in an operational workspace.')
    string(event.type, 'audit type', 100, true); string(event.actor, 'audit actor', 200, true); timestamp(event.at, 'audit', true)
    if (event.index !== index || !isObject(event.payload) || !/^[a-f0-9]{64}$/.test(event.hash || '') || (event.previousHash !== 'GENESIS' && !/^[a-f0-9]{64}$/.test(event.previousHash || ''))) throw new HttpError(400, 'Invalid client audit structure.')
    return event
  })
}
