import { extractDeclarations } from './extraction.mjs'

// Experimental geometry-only association. This never repairs OCR characters,
// infers a declaration from a product catalogue, or resolves conflicting values.
export const SPATIAL_OCR_THRESHOLDS = Object.freeze({ maxLines: 1000, maxTextCharacters: 100000, maxLineCharacters: 2000, maxSkewDegrees: 12, maxPairAngleDifference: 5, maxEdgeAngleDifference: 5, maxHeightRatio: 2.5, maxCentreOffsetHeights: 0.35, minVerticalOverlap: 0.65, maxGapHeights: 12 })

const HEADINGS = [
  { kind: 'mrp', regex: /^(?:M\s*\.?\s*R\s*\.?\s*P\.?|MAXIMUM\s+RETAIL\s+PRICE)\s*[:\-]?\s*(?:₹|RS\.?|INR)?\s*[:\-]?$/i },
  { kind: 'quantity', regex: /^(?:NET\s*(?:CONTENTS?|QTY|QUANTITY|WT\.?|WEIGHT)|CONTENTS?)\s*[:\-]?$/i },
  { kind: 'packed', regex: /^(?:PACKED|PKD|MFG|MFD|MANUFACTURED|IMPORTED)(?:\s+(?:ON|DATE))?\s*[:\-]?$/i },
  { kind: 'use-by', regex: /^(?:USE[ -]?BY|BEST\s+BEFORE|EXPIRY|EXP(?:IRY)?\s+DATE|EXP)\s*[:\-]?$/i },
  { kind: 'unit-price', regex: /^(?:UNIT\s+SALE\s+PRICE|UNIT\s+PRICE|USP)\s*[:\-]?\s*(?:₹|RS\.?|INR)?\s*[:\-]?$/i },
]
const headingKinds = text => HEADINGS.filter(item => item.regex.test(text.trim())).map(item => item.kind)
const declarationTokens = text => [...text.matchAll(/\b(?:MRP|USP|NET\s+(?:QTY|QUANTITY|CONTENTS?)|PACKED\s+ON|USE[ -]?BY)\b/gi)].length
const numericLooking = text => /^(?:₹|RS\.?|INR)?\s*[+-]?\s*\d/i.test(text.trim())
const radians = degrees => degrees * Math.PI / 180
const degrees = value => value * 180 / Math.PI
const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
const average = values => values.reduce((sum, value) => sum + value, 0) / values.length

function geometry(box, text) {
  const [tl, tr, br, bl] = box
  const topAngle = degrees(Math.atan2(tr[1] - tl[1], tr[0] - tl[0]))
  const bottomAngle = degrees(Math.atan2(br[1] - bl[1], br[0] - bl[0]))
  const angle = (topAngle + bottomAngle) / 2
  const width = (distance(tl, tr) + distance(bl, br)) / 2
  const height = (distance(tl, bl) + distance(tr, br)) / 2
  const crosses = box.map((p, i) => {
    const q = box[(i + 1) % 4]; const r = box[(i + 2) % 4]
    return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])
  })
  if (width <= 0 || height <= 0 || crosses.some(value => value <= 0)) throw new Error('OCR quadrilateral must be convex with TL, TR, BR, BL points in image coordinates.')
  const supported = Math.abs(angle) <= SPATIAL_OCR_THRESHOLDS.maxSkewDegrees
    && Math.abs(topAngle - bottomAngle) <= SPATIAL_OCR_THRESHOLDS.maxEdgeAngleDifference
    && !(text.trim().length >= 3 && width < height)
  return { centre: [average(box.map(p => p[0])), average(box.map(p => p[1]))], width, height, angle, supported }
}

function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length > SPATIAL_OCR_THRESHOLDS.maxLines || Object.keys(lines).length !== lines.length) throw new Error('Spatial OCR needs a dense array of at most 1000 lines.')
  let characters = 0
  const ids = new Set()
  return lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line) || ![Object.prototype, null].includes(Object.getPrototypeOf(line))) throw new Error('OCR line must be a plain object.')
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(line))) if (!Object.hasOwn(descriptor, 'value')) throw new Error('OCR lines must not have accessor properties.')
    if (typeof line.text !== 'string' || line.text.length > SPATIAL_OCR_THRESHOLDS.maxLineCharacters || /[\r\n]/.test(line.text)) throw new Error('Each OCR line needs bounded single-line text.')
    characters += line.text.length
    if (characters > SPATIAL_OCR_THRESHOLDS.maxTextCharacters) throw new Error('Spatial OCR transcript exceeds 100000 characters.')
    const id = line.id ?? `line-${index + 1}`
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || ids.has(id)) throw new Error('OCR line IDs must be unique nonempty bounded strings.')
    ids.add(id)
    const panelId = line.panelId ?? 'panel-1'
    if (typeof panelId !== 'string' || !panelId || panelId.length > 200) throw new Error('Invalid OCR panel ID.')
    if (!Array.isArray(line.box) || line.box.length !== 4 || line.box.some(point => !Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000))) throw new Error('Each OCR line requires four finite nonnegative x/y points.')
    if (line.confidence !== undefined && (typeof line.confidence !== 'number' || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1)) throw new Error('OCR confidence, when supplied, must be between 0 and 1.')
    const copy = { id, index, panelId, text: line.text, box: line.box.map(point => [...point]) }
    if (line.confidence !== undefined) copy.confidence = line.confidence
    return { ...copy, geometry: geometry(copy.box, copy.text), headings: headingKinds(copy.text), numeric: numericLooking(copy.text) }
  })
}

function interval(box, vector) {
  const projected = box.map(point => dot(point, vector))
  return { min: Math.min(...projected), max: Math.max(...projected) }
}

function alignedPair(left, right) {
  const thresholds = SPATIAL_OCR_THRESHOLDS
  if (left.panelId !== right.panelId || !left.geometry.supported || !right.geometry.supported) return null
  if (Math.abs(left.geometry.angle - right.geometry.angle) > thresholds.maxPairAngleDifference) return null
  const height = Math.max(left.geometry.height, right.geometry.height)
  const minHeight = Math.min(left.geometry.height, right.geometry.height)
  if (height / minHeight > thresholds.maxHeightRatio) return null
  const angle = radians((left.geometry.angle + right.geometry.angle) / 2)
  const u = [Math.cos(angle), Math.sin(angle)]; const v = [-Math.sin(angle), Math.cos(angle)]
  const lx = interval(left.box, u); const rx = interval(right.box, u)
  const ly = interval(left.box, v); const ry = interval(right.box, v)
  const gap = rx.min - lx.max
  const centreOffset = Math.abs(dot(left.geometry.centre, v) - dot(right.geometry.centre, v))
  const overlap = Math.min(ly.max, ry.max) - Math.max(ly.min, ry.min)
  const overlapFraction = overlap / Math.min(ly.max - ly.min, ry.max - ry.min)
  if (gap < 0 || gap > height * thresholds.maxGapHeights || centreOffset > height * thresholds.maxCentreOffsetHeights || overlapFraction < thresholds.minVerticalOverlap) return null
  return { gap, gapHeights: gap / height, centreOffsetHeights: centreOffset / height, overlapFraction, angle, u, v, lx, rx }
}

export function associateSpatialOcrRows(inputLines = []) {
  const lines = validateLines(inputLines)
  const abstentions = []
  const proposals = []
  for (const heading of lines) {
    if (!heading.geometry.supported) { abstentions.push({ sourceId: heading.id, reason: 'unsupported_rotation_or_skew', candidateIds: [] }); continue }
    if (!heading.headings.length) {
      if (declarationTokens(heading.text) > 1) abstentions.push({ sourceId: heading.id, reason: 'multiple_declaration_headings_in_one_box', candidateIds: [] })
      continue
    }
    const candidates = lines.filter(value => value.id !== heading.id && value.numeric && alignedPair(heading, value))
    if (candidates.length !== 1) {
      abstentions.push({ sourceId: heading.id, reason: candidates.length ? 'multiple_aligned_value_candidates' : 'no_unambiguous_same_row_value', candidateIds: candidates.map(line => line.id) })
      continue
    }
    const value = candidates[0]
    const pair = alignedPair(heading, value)
    // Any intervening same-row text is a possible column boundary or missing
    // token. Do not skip it to connect a farther numeric value.
    const blockers = lines.filter(other => {
      if ([heading.id, value.id].includes(other.id) || other.panelId !== heading.panelId || !other.text.trim()) return false
      const horizontal = interval(other.box, pair.u)
      if (horizontal.max <= pair.lx.max || horizontal.min >= pair.rx.min) return false
      const offset = Math.abs(dot(other.geometry.centre, pair.v) - dot(heading.geometry.centre, pair.v))
      return offset <= Math.max(heading.geometry.height, other.geometry.height) * SPATIAL_OCR_THRESHOLDS.maxCentreOffsetHeights
    })
    if (blockers.length) { abstentions.push({ sourceId: heading.id, reason: 'intervening_text_or_column_boundary', candidateIds: [value.id], blockerIds: blockers.map(line => line.id) }); continue }
    proposals.push({ heading, value, metrics: { gapHeights: pair.gapHeights, centreOffsetHeights: pair.centreOffsetHeights, overlapFraction: pair.overlapFraction, angleDegrees: degrees(pair.angle) } })
  }
  const accepted = proposals.filter(proposal => {
    const competing = proposals.filter(other => other.value.id === proposal.value.id)
    if (competing.length === 1) return true
    abstentions.push({ sourceId: proposal.heading.id, reason: 'value_shared_by_multiple_headings', candidateIds: [proposal.value.id], competingHeadingIds: competing.map(item => item.heading.id) })
    return false
  })
  const used = new Set(accepted.flatMap(item => [item.heading.id, item.value.id]))
  const makeRow = (sources, kind, metrics = null) => ({
    id: `row:${sources.map(line => line.id).join('+')}`,
    kind, text: sources.map(line => line.text).join(' '),
    sourceIds: sources.map(line => line.id), sourceIndexes: sources.map(line => line.index), sourceBoxes: sources.map(line => line.box.map(point => [...point])),
    parts: sources.map(line => ({ sourceId: line.id, text: line.text, box: line.box.map(point => [...point]) })),
    geometry: metrics,
  })
  const rows = [...accepted.map(item => makeRow([item.heading, item.value], 'same-row-association', item.metrics)), ...lines.filter(line => !used.has(line.id)).map(line => makeRow([line], 'unchanged'))]
    .sort((a, b) => Math.min(...a.sourceIndexes) - Math.min(...b.sourceIndexes))
  const rawLines = lines.map(({ geometry: _geometry, headings: _headings, numeric: _numeric, ...line }) => line)
  return {
    schemaVersion: 1, method: 'conservative-same-row-spatial-association-v1', transcriptKind: 'system-derived-spatial-transcript',
    rawLines, rawText: rawLines.map(line => line.text).join('\n'), transcript: rows.map(row => row.text).join('\n'), rows,
    associations: accepted.map(item => ({ headingId: item.heading.id, valueId: item.value.id, headingKind: item.heading.headings[0], ...item.metrics })), abstentions,
    thresholds: { ...SPATIAL_OCR_THRESHOLDS },
    limitations: ['Experimental derived ordering, not unchanged raw OCR and not an automatic compliance verdict.', 'Original strings are preserved exactly; only one separating space is inserted for an accepted pair.', 'No character, digit, unit or heading repair; bad recognition remains bad recognition.', 'Only conservative two-box same-row associations are attempted. Stacked labels, rotated layouts, multiple columns/candidates and unsupported skew may remain unresolved.', 'Geometric thresholds are generic heuristics, not calibrated probabilities or proof of correct semantic association.'],
  }
}

export function rapidOcrLines(metadata, { panelId = 'panel-1' } = {}) {
  if (!metadata || !Array.isArray(metadata.texts) || !Array.isArray(metadata.boxes) || !Array.isArray(metadata.confidences) || metadata.texts.length !== metadata.boxes.length || metadata.texts.length !== metadata.confidences.length) throw new Error('RapidOCR texts, boxes and confidences must be equal-length arrays.')
  return metadata.texts.map((text, index) => ({ id: `${panelId}:line-${index + 1}`, panelId, text, box: metadata.boxes[index], confidence: metadata.confidences[index] }))
}

// Separate opt-in proposal path: the earlier same-row API and its transcript
// remain unchanged. These heuristics are NOT calibrated semantic confidence.
export const STACKED_OCR_POLICY = Object.freeze({ maxGapHeights: 1, minHorizontalOverlap: 0.8, maxAnchorOffsetHeights: 0.5 })

function stackedPair(heading, value) {
  if (heading.panelId !== value.panelId || !heading.geometry.supported || !value.geometry.supported) return null
  if (Math.abs(heading.geometry.angle - value.geometry.angle) > SPATIAL_OCR_THRESHOLDS.maxPairAngleDifference) return null
  const height = Math.max(heading.geometry.height, value.geometry.height)
  if (height / Math.min(heading.geometry.height, value.geometry.height) > SPATIAL_OCR_THRESHOLDS.maxHeightRatio) return null
  const angle = radians((heading.geometry.angle + value.geometry.angle) / 2)
  const u = [Math.cos(angle), Math.sin(angle)]; const v = [-Math.sin(angle), Math.cos(angle)]
  const hx = interval(heading.box, u); const vx = interval(value.box, u)
  const hy = interval(heading.box, v); const vy = interval(value.box, v)
  const gapHeights = (vy.min - hy.max) / height
  const overlapFraction = (Math.min(hx.max, vx.max) - Math.max(hx.min, vx.min)) / Math.min(hx.max - hx.min, vx.max - vx.min)
  const centreOffsetHeights = Math.abs(dot(heading.geometry.centre, u) - dot(value.geometry.centre, u)) / height
  const leftOffsetHeights = Math.abs(hx.min - vx.min) / height
  if (gapHeights < 0 || gapHeights > STACKED_OCR_POLICY.maxGapHeights || overlapFraction < STACKED_OCR_POLICY.minHorizontalOverlap || Math.min(centreOffsetHeights, leftOffsetHeights) > STACKED_OCR_POLICY.maxAnchorOffsetHeights) return null
  return { u, v, hx, vx, hy, vy, gapHeights, overlapFraction, centreOffsetHeights, leftOffsetHeights, angleDegrees: degrees(angle) }
}

const criticalHeading = line => line.headings.includes('mrp') ? 'mrp'
  : line.headings.includes('quantity') && /^NET\s*/i.test(line.text.trim()) ? 'netQuantity'
    : line.headings.includes('packed') && !/^IMPORTED\b/i.test(line.text.trim()) ? 'packDate' : null
const completeValueFragment = (field, text) => ({
  mrp: /^(?:(?:₹|RS\.?|INR)\s*)?\d[\d,.]*$/i,
  netQuantity: /^\d[\d,.]*\s*[a-zℓ]+\.?$/i,
  packDate: /^(?:\d{1,4}(?:[./-]\d{1,4}){1,2}|\d{1,2}[ -][a-z]{3,9}[ -]\d{2,4}|[a-z]{3,9}[ -]\d{2,4})$/i,
}[field]).test(text.trim())

export function reviewableStackedDeclarationProposals(inputLines = []) {
  const lines = validateLines(inputLines)
  const preliminary = []; const rejected = []
  for (const heading of lines) {
    const field = criticalHeading(heading)
    if (!field) continue
    const reject = (reason, candidateIds = [], extra = {}) => rejected.push({ headingId: heading.id, field, reason, candidateIds, ...extra })
    const candidates = lines.filter(value => value.id !== heading.id && value.numeric && stackedPair(heading, value))
    const lateral = lines.filter(value => value.id !== heading.id && value.numeric && alignedPair(heading, value))
    // Do not select the value whose format happens to fit. Two candidate boxes
    // or a same-row alternative are already sufficient to withhold the guess.
    if (candidates.length !== 1 || lateral.length) { reject(lateral.length ? 'competing_same_row_value' : candidates.length ? 'multiple_stacked_value_candidates' : 'no_unambiguous_stacked_value', [...candidates, ...lateral].map(line => line.id)); continue }
    const value = candidates[0]; const pair = stackedPair(heading, value)
    const blockers = lines.filter(other => {
      if ([heading.id, value.id].includes(other.id) || other.panelId !== heading.panelId || !other.text.trim()) return false
      const x = interval(other.box, pair.u); const y = interval(other.box, pair.v)
      return x.max > Math.min(pair.hx.min, pair.vx.min) && x.min < Math.max(pair.hx.max, pair.vx.max)
        && y.max > pair.hy.max && y.min < pair.vy.max
    })
    if (blockers.length) { reject('intervening_or_overlapping_text', [value.id], { blockerIds: blockers.map(line => line.id) }); continue }
    const competingHeadings = lines.filter(other => other.id !== heading.id && other.headings.length && (stackedPair(other, value) || alignedPair(other, value)))
    if (competingHeadings.length) { reject('value_shared_by_another_heading', [value.id], { competingHeadingIds: competingHeadings.map(line => line.id) }); continue }
    const text = `${heading.text} ${value.text}`
    const parsed = extractDeclarations(text).byId[field]
    if (!completeValueFragment(field, value.text) || parsed.candidates.length !== 1 || !parsed.candidates[0].valid || parsed.conflict || parsed.validation?.status !== 'format_valid') { reject('value_fragment_not_one_complete_valid_field', [value.id]); continue }
    preliminary.push({ heading, value, field, text, parsed, pair })
  }
  const proposals = []
  for (const item of preliminary) {
    const peers = preliminary.filter(other => other.field === item.field)
    const resolvedSources = new Set(peers.flatMap(other => [other.heading.id, other.value.id]))
    // Remove only geometrically resolved fragments while searching original
    // evidence for competing or unreadable declarations of this field.
    const others = lines.filter(line => !resolvedSources.has(line.id)).flatMap(line => extractDeclarations(line.text).byId[item.field].candidates)
    const keys = new Set([...peers.map(other => other.parsed.candidates[0].key), ...others.filter(candidate => candidate.valid).map(candidate => candidate.key)])
    if (keys.size !== 1 || others.some(candidate => !candidate.valid)) {
      rejected.push({ headingId: item.heading.id, field: item.field, reason: keys.size !== 1 ? 'conflicting_field_values_elsewhere_in_evidence' : 'unresolved_field_evidence_elsewhere', candidateIds: [item.value.id] }); continue
    }
    const sources = [item.heading, item.value]
    proposals.push({
      id: `stacked:${sources.map(line => line.id).join('+')}`, panelId: item.heading.panelId, field: item.field, value: item.parsed.value, text: item.text,
      sourceIds: sources.map(line => line.id), sourceIndexes: sources.map(line => line.index),
      parts: sources.map(line => ({ sourceId: line.id, sourceIndex: line.index, text: line.text, box: line.box.map(point => [...point]) })),
      geometry: Object.fromEntries(['gapHeights', 'overlapFraction', 'centreOffsetHeights', 'leftOffsetHeights', 'angleDegrees'].map(key => [key, item.pair[key]])),
      method: 'conservative-stacked-heading-value-v1', validation: { ...item.parsed.candidates[0].validation }, requiresOfficerReview: true, eligibleForAutomaticVerdict: false,
    })
  }
  return { proposals, rejected, method: 'conservative-stacked-heading-value-v1', policy: { ...STACKED_OCR_POLICY }, limitation: 'Experimental source-mapped suggestion only: one literal heading above one close aligned complete value, no intervening text, alternative or conflicting field evidence. Exact original characters remain unchanged. Human inspection is mandatory; this does not resolve raw OCR conflicts or establish semantic accuracy.' }
}
