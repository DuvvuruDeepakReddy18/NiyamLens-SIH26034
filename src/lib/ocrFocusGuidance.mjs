import { extractDeclarations } from './extraction.mjs'
import { describeReadingOrderBox, inspectReadingOrderPair } from './ocrReadingOrder.mjs'

// Acquisition guidance only: these rectangles request ANOTHER recognition of
// actual pixels. They never associate a value with a heading, edit a transcript,
// promote a confidence score, or clear a conflict from a previous reading.
export const OCR_FOCUS_POLICY = Object.freeze({ maxSuggestions: 3, maxLines: 1000, maxLineCharacters: 512, maxCharacters: 100000, rightGapHeights: 8, belowGapHeights: 3, maxNeighbourHeightRatio: 4, paddingHeights: 0.65, maxAreaFraction: 0.65 })

const fieldNames = { mrp: 'MRP', netQuantity: 'net quantity', packDate: 'packed/manufactured date' }
const bounds = box => ({ x0: Math.min(...box.map(p => p[0])), y0: Math.min(...box.map(p => p[1])), x1: Math.max(...box.map(p => p[0])), y1: Math.max(...box.map(p => p[1])) })
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
const area = rect => (rect.x1 - rect.x0) * (rect.y1 - rect.y0)

function headingField(text) {
  const line = text.trim()
  // A reference to another surface or a manufacturer's address is not a local
  // declaration target. No fuzzy OCR spelling, missing-heading or unit repair.
  if (/\b(?:SEE|REFER|BY|BEFORE|FROM|FOR|ADDRESS|CONTACT|SERVING|PER\s+100|USP|UNIT(?:\s+SALE)?\s+PRICE)\b/i.test(line)) return null
  if (/^(?:M\s*\.?\s*R\s*\.?\s*P\.?|MAXIMUM\s+RETAIL\s+PRICE)(?=\s|[:₹.\-]|\d|$)/i.test(line)) return 'mrp'
  if (/^NET\s*(?:CONTENTS?|QTY\.?|QUANTITY|WT\.?|WEIGHT|VOLUME|VOL\.?)\b/i.test(line)) return 'netQuantity'
  if (/^(?:PACKED|PKD\.?|MFG\.?|MFD\.?|MANUFACTURED)(?:\s+(?:ON|DATE))?(?=\s|[:.\-]|\d|$)/i.test(line)) return 'packDate'
  return null
}

function beginsOtherSection(text) {
  return /^(?:USE[ -]?BY|BEST\s+BEFORE|EXPIRY|EXP\.?|BATCH(?:\s*NO)?|NUTRITION(?:AL)?\b|INGREDIENTS\b|(?:MANUFACTURED|PACKED|MARKETED|MFD\.?|MFG\.?|PKD\.?|MKTD\.?)\s+BY|CONSUMER\s+CARE|CUSTOMER\s+CARE|M\s*\.?\s*R\s*\.?\s*P\.?|UNIT(?:\s+SALE)?\s+PRICE|USP\b)/i.test(text.trim())
}

const standaloneHeading = text => /^(?:M\s*\.?\s*R\s*\.?\s*P\.?|MAXIMUM\s+RETAIL\s+PRICE|NET\s*(?:CONTENTS?|QTY\.?|QUANTITY|WT\.?|WEIGHT|VOLUME|VOL\.?)|(?:PACKED|PKD\.?|MFG\.?|MFD\.?|MANUFACTURED)(?:\s+(?:ON|DATE))?)\s*[:.₹\-]?\s*$/i.test(text.trim())

function validateInput(item) {
  if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200 || typeof item.imageUrl !== 'string' || !item.imageUrl) throw new Error('Focus guidance needs an identified captured panel.')
  if (!['width', 'height'].every(key => Number.isFinite(item[key]) && item[key] > 0 && item[key] <= 10000)) throw new Error('Focus guidance needs bounded image dimensions.')
  if (!Array.isArray(item.lines) || item.lines.length > OCR_FOCUS_POLICY.maxLines || Object.keys(item.lines).length !== item.lines.length) throw new Error('Focus guidance needs at most 1000 dense OCR lines.')
  const ids = new Set(); let characters = 0
  return item.lines.map(line => {
    if (!line || typeof line.id !== 'string' || !line.id || line.id.length > 200 || ids.has(line.id) || line.panelId !== item.id) throw new Error('Focus guidance line IDs must be unique and belong to their panel.')
    ids.add(line.id)
    if (typeof line.text !== 'string' || line.text.length > OCR_FOCUS_POLICY.maxLineCharacters || /[\r\n]/.test(line.text)) throw new Error('Focus guidance line text must be bounded and unchanged.')
    characters += line.text.length
    if (characters > OCR_FOCUS_POLICY.maxCharacters) throw new Error('Focus guidance text exceeds the evidence limit.')
    if (!Array.isArray(line.box) || line.box.length !== 4 || line.box.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n)) || p[0] < 0 || p[1] < 0 || p[0] > item.width || p[1] > item.height)) throw new Error('Focus guidance polygons must be inside their source image.')
    let geometry
    try { geometry = describeReadingOrderBox(line.box, line.text) } catch { geometry = { supported: false } }
    return { ...line, box: line.box.map(p => [...p]), bounds: bounds(line.box), geometry, field: headingField(line.text), blocker: beginsOtherSection(line.text) }
  })
}

function envelopeFor(heading, lines, frame) {
  const h = heading.geometry.height
  const b = heading.bounds
  const standalone = standaloneHeading(heading.text)
  const sameColumn = line => overlap(b.x0, b.x1, line.bounds.x0, line.bounds.x1) / Math.min(b.x1 - b.x0, line.bounds.x1 - line.bounds.x0) >= 0.5
  const belowStop = lines.filter(line => line.id !== heading.id && (line.field || line.blocker) && sameColumn(line) && line.bounds.y0 > b.y1)
    .reduce((nearest, line) => Math.min(nearest, line.bounds.y0 - h * 0.2), frame.height)
  const nextColumn = lines.filter(line => line.id !== heading.id && (line.field || line.blocker) && line.bounds.x0 > b.x1 && overlap(b.y0, b.y1, line.bounds.y0, line.bounds.y1) > 0)
    .reduce((nearest, line) => Math.min(nearest, line.bounds.x0 - h * 0.2), frame.width)
  const context = lines.filter(line => {
    if (!standalone || line.id === heading.id || !line.geometry.supported || line.field || line.blocker) return false
    if (line.geometry.height / h > OCR_FOCUS_POLICY.maxNeighbourHeightRatio || h / line.geometry.height > OCR_FOCUS_POLICY.maxNeighbourHeightRatio) return false
    const c = line.bounds
    // Baseline projection retains right-hand values whose axis-aligned boxes
    // overlap at a corner on a sloping label. This requests pixels only.
    const sameRow = line.geometry.centre[0] > heading.geometry.centre[0]
      && inspectReadingOrderPair(heading, line).compatible && c.x1 < nextColumn
    const directlyBelow = c.y0 >= b.y1 - h * 0.2 && c.y0 - b.y1 <= h * OCR_FOCUS_POLICY.belowGapHeights && c.y1 < belowStop && sameColumn(line)
    return sameRow || directlyBelow
  })
  const padding = h * OCR_FOCUS_POLICY.paddingHeights
  // A heading-only crop cannot recover a value the detector missed. Search a
  // bounded right-hand strip, stopped by another section/column. Do not extend
  // an already detected context box or synthesize a missing character.
  const edges = [heading, ...context].map(line => line.bounds)
  const x0 = Math.max(0, Math.min(...edges.map(edge => edge.x0)) - padding)
  const y0 = Math.max(0, Math.min(...edges.map(edge => edge.y0)) - padding)
  const searchRight = standalone && !context.length ? b.x1 + h * OCR_FOCUS_POLICY.rightGapHeights : b.x1
  const x1 = Math.min(nextColumn, frame.width, Math.max(searchRight, ...edges.map(edge => edge.x1)) + padding)
  const y1 = Math.min(belowStop, frame.height, Math.max(b.y1 + h * (standalone ? 1.5 : 0), ...edges.map(edge => edge.y1)) + padding)
  return { rect: { x0, y0, x1, y1 }, context }
}

export function planPaddleFocus(item) {
  const lines = validateInput(item)
  const result = { method: 'heading-guided-focus-v1', suggestions: [], withheld: [], limitation: 'Suggested regions are unvalidated capture guidance, not extracted values. Inspect the crop, retry real OCR, and review every conflict; never infer text hidden by glare or a cropped label.' }
  if (item.crop) { result.withheld.push({ reason: 'already_focused_use_manual_selection_or_recapture' }); return result }
  const headings = lines.filter(line => line.field)
  if (!headings.length) { result.withheld.push({ reason: 'no_literal_local_declaration_heading_recapture_or_select_manually' }); return result }
  for (const heading of headings) {
    const reject = reason => result.withheld.push({ headingId: heading.id, field: heading.field, reason })
    if (!heading.geometry.supported) { reject('unsupported_rotation_or_skew_rotate_or_select_manually'); continue }
    const parsed = extractDeclarations(heading.text).byId[heading.field]
    if (parsed.validation?.status === 'format_valid' && !parsed.conflict) { reject('value_already_format_valid_on_same_line_not_a_verified_value'); continue }
    const { rect, context } = envelopeFor(heading, lines, item)
    if (rect.x1 - rect.x0 < 20 || rect.y1 - rect.y0 < 12) { reject('insufficient_pixels_recapture_close_up'); continue }
    if (area(rect) / (item.width * item.height) > OCR_FOCUS_POLICY.maxAreaFraction) { reject('region_too_large_select_manually'); continue }
    const normalized = { x0: rect.x0 / item.width, y0: rect.y0 / item.height, x1: rect.x1 / item.width, y1: rect.y1 / item.height }
    const duplicate = result.suggestions.some(suggestion => {
      const r = suggestion.rect
      const intersection = overlap(r.x0, r.x1, normalized.x0, normalized.x1) * overlap(r.y0, r.y1, normalized.y0, normalized.y1)
      return intersection / (area(r) + area(normalized) - intersection) > 0.65
    })
    if (duplicate) { reject('overlaps_an_existing_retry_region'); continue }
    if (result.suggestions.length >= OCR_FOCUS_POLICY.maxSuggestions) { reject('bounded_retry_limit_select_remaining_regions_manually'); continue }
    result.suggestions.push({ id: `${item.id}:focus:${heading.id}`, panelId: item.id, imageUrl: item.imageUrl, rect: normalized, field: heading.field, label: `Retry ${fieldNames[heading.field]} region`, headingIds: [heading.id], headingTexts: [heading.text], sourceFrame: { width: item.width, height: item.height, source: item.source || 'whole-panel' }, contextLineIds: context.map(line => line.id), reason: 'literal_heading_with_unresolved_same_line_value', method: result.method })
  }
  return result
}

// Resolve the ID from the CURRENT displayed guidance, not a rectangle supplied
// by a stale event closure. Call again after acquiring the app's operation lock.
export function resolvePaddleFocusSuggestion({ suggestions, suggestionId, evidenceItems }) {
  if (!Array.isArray(suggestions) || suggestions.length > OCR_FOCUS_POLICY.maxSuggestions * 4 || !Array.isArray(evidenceItems) || evidenceItems.length > 4 || typeof suggestionId !== 'string') throw new Error('Invalid current focus guidance.')
  const matches = suggestions.filter(suggestion => suggestion?.id === suggestionId)
  if (matches.length !== 1) throw new Error('This suggested region is no longer available. Run whole-panel Paddle OCR again.')
  const suggestion = matches[0]
  const panels = evidenceItems.filter(panel => panel?.id === suggestion.panelId)
  if (panels.length !== 1 || panels[0].analysisUrl !== suggestion.imageUrl) throw new Error('The image changed since this suggested region. Run whole-panel Paddle OCR again.')
  const { rect, sourceFrame } = suggestion
  if (suggestion.method !== 'heading-guided-focus-v1' || !fieldNames[suggestion.field] || !rect || !['x0', 'y0', 'x1', 'y1'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]) && rect[key] >= 0 && rect[key] <= 1) || rect.x1 <= rect.x0 || rect.y1 <= rect.y0) throw new Error('This suggested region has invalid coordinates.')
  if (!sourceFrame || !['width', 'height'].every(key => Number.isFinite(sourceFrame[key]) && sourceFrame[key] > 0 && sourceFrame[key] <= 10000) || (rect.x1 - rect.x0) * sourceFrame.width < 20 || (rect.y1 - rect.y0) * sourceFrame.height < 12) throw new Error('This suggested region has insufficient source pixels.')
  return { panel: panels[0], rect: { ...rect }, suggestion: { ...suggestion, rect: { ...rect }, sourceFrame: { ...sourceFrame } } }
}
