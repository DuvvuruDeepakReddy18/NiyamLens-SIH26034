// Defensive display projection only. Client audit payloads are historical
// observations, not trusted verification or an independent OCR attestation.
export const MACHINE_HISTORY_LIMITS = Object.freeze({ events: 5000, rows: 50, parts: 12, warnings: 50, text: 4096, partText: 2000, identifier: 200, warningText: 2000 })
const STRATEGY = 'machine-structured-candidates-v1'
const FIELDS = Object.freeze({ mrp: 'MRP', netQuantity: 'Net quantity', packDate: 'Packed / manufactured date' })
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const own = (value, key) => {
  if (!record(value)) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}
function boundedArray(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) return null
  const result = []
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    result.push(descriptor.value)
  }
  return result
}
const boundedString = (value, maximum) => typeof value === 'string' && value.length <= maximum && value.trim().length > 0
const unavailable = reason => ({ status: 'unavailable', reason, rows: [], warnings: [], historical: true, verified: false })

export function machineCandidateHistory(auditChain = []) {
  const events = boundedArray(auditChain, MACHINE_HISTORY_LIMITS.events)
  if (!events) return unavailable('The recorded scan history is malformed or exceeds the display limit. Its associations cannot be safely displayed.')
  let payload = null; let eventIndex = -1; let laterOcrCompletions = 0
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!record(event)) return unavailable('A newer history entry is malformed. Earlier machine associations were not substituted for it.')
    if (own(event, 'type') !== 'ocr_completed') continue
    const candidate = own(event, 'payload')
    if (!record(candidate) || typeof own(candidate, 'strategy') !== 'string') return unavailable('A recorded OCR completion has unavailable metadata. Earlier machine associations were not substituted for it.')
    if (own(candidate, 'strategy') !== STRATEGY) { laterOcrCompletions++; continue }
    payload = candidate; eventIndex = index; break
  }
  if (!payload) return { status: 'none', rows: [], warnings: [], historical: true, verified: false }
  const candidates = boundedArray(own(payload, 'candidateRows'), MACHINE_HISTORY_LIMITS.rows)
  const warnings = boundedArray(own(payload, 'warnings'), MACHINE_HISTORY_LIMITS.warnings)
  const reviewedRows = boundedArray(own(payload, 'reviewedRows'), MACHINE_HISTORY_LIMITS.rows)
  if (!candidates || !warnings || !reviewedRows || reviewedRows.length || own(payload, 'requiresOfficerReview') !== true) return unavailable('The latest machine-association record is incomplete, malformed or too large. This is not a finding that no associations or errors occurred.')
  if (warnings.some(warning => !boundedString(warning, MACHINE_HISTORY_LIMITS.warningText))) return unavailable('The latest machine-association warnings cannot be safely displayed. Their absence must not be interpreted as an error-free scan.')
  const rows = []; const used = new Set()
  for (const row of candidates) {
    const field = own(row, 'field'); const text = own(row, 'text'); const panelId = own(row, 'panelId')
    const parts = boundedArray(own(row, 'parts'), MACHINE_HISTORY_LIMITS.parts)
    const sourceIds = boundedArray(own(row, 'sourceIds'), MACHINE_HISTORY_LIMITS.parts)
    if (typeof field !== 'string' || !Object.hasOwn(FIELDS, field) || !boundedString(text, MACHINE_HISTORY_LIMITS.text) || !boundedString(panelId, MACHINE_HISTORY_LIMITS.identifier)
      || !parts || parts.length < 2 || !sourceIds || sourceIds.length !== parts.length
      || own(row, 'method') !== 'system-derived-geometric-candidate' || own(row, 'requiresOfficerReview') !== true || own(row, 'eligibleForAutomaticVerdict') !== false) return unavailable('The latest machine-association record contains an invalid candidate. No earlier successful record was substituted.')
    const texts = []; const ids = []
    for (let index = 0; index < parts.length; index++) {
      const id = own(parts[index], 'id'); const fragment = own(parts[index], 'text')
      if (!boundedString(id, MACHINE_HISTORY_LIMITS.identifier) || !boundedString(fragment, MACHINE_HISTORY_LIMITS.partText) || sourceIds[index] !== id) return unavailable('The latest machine-association source mapping is malformed. Its candidates cannot be safely displayed.')
      const key = JSON.stringify([panelId, id])
      if (used.has(key)) return unavailable('The latest machine-association source mapping reuses a source. Its candidates cannot be safely displayed.')
      used.add(key); ids.push(id); texts.push(fragment)
    }
    if (texts.join(' ') !== text) return unavailable('The recorded association text disagrees with its recorded source fragments. Compare the original photograph; this summary is unavailable.')
    rows.push({ field, label: FIELDS[field], text, panelId, sourceIds: ids, requiresOfficerReview: true, eligibleForAutomaticVerdict: false })
  }
  return { status: 'available', rows, warnings: [...warnings], eventIndex, laterOcrCompletions, historical: true, verified: false }
}
