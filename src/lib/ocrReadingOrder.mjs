import { extractDeclarations } from './extraction.mjs'

// Experimental row reconstruction: geometry proposes groups; ambiguity guards
// may reject them. Neither OCR strings nor numeric/heading/unit tokens change.
export const READING_ORDER_POLICY = Object.freeze({ maxLines: 1000, maxCharacters: 100000, maxLineCharacters: 2000, maxSkewDegrees: 15, maxEdgeSkewDifference: 5, maxPairSkewDifference: 5, minVerticalOverlap: 0.5, maxCentreOffsetHeights: 0.6, maxHeightRatio: 2.5, maxGapHeights: 8, maxPartsPerRow: 12 })
const deg = radians => radians * 180 / Math.PI
const rad = degrees => degrees * Math.PI / 180
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0 }
const dot = (point, vector) => point[0] * vector[0] + point[1] * vector[1]
const length = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const project = (box, vector) => { const values = box.map(point => dot(point, vector)); return { min: Math.min(...values), max: Math.max(...values) } }

export function describeReadingOrderBox(box, text = '') {
  if (!Array.isArray(box) || box.length !== 4 || Object.keys(box).length !== 4 || box.some(point => !Array.isArray(point) || point.length !== 2 || Object.keys(point).length !== 2 || point.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000))) throw new Error('Reading-order boxes require four finite nonnegative x/y points.')
  const [tl, tr, br, bl] = box
  const topAngle = deg(Math.atan2(tr[1] - tl[1], tr[0] - tl[0]))
  const bottomAngle = deg(Math.atan2(br[1] - bl[1], br[0] - bl[0]))
  const width = (length(tl, tr) + length(bl, br)) / 2
  const height = (length(tl, bl) + length(tr, br)) / 2
  const cross = box.map((p, i) => { const q = box[(i + 1) % 4]; const r = box[(i + 2) % 4]; return (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]) })
  if (width <= 0 || height <= 0 || cross.some(value => value <= 0)) throw new Error('Reading-order quadrilateral must be convex and ordered TL, TR, BR, BL.')
  const angle = (topAngle + bottomAngle) / 2
  return { width, height, angle, centre: [mean(box.map(p => p[0])), mean(box.map(p => p[1]))], supported: Math.abs(angle) <= READING_ORDER_POLICY.maxSkewDegrees && Math.abs(topAngle - bottomAngle) <= READING_ORDER_POLICY.maxEdgeSkewDifference && !(text.trim().length >= 3 && width < height) }
}

function checkedLines(input) {
  if (!Array.isArray(input) || input.length > READING_ORDER_POLICY.maxLines || Object.keys(input).length !== input.length) throw new Error('Reading order needs a dense array of at most 1000 OCR lines.')
  const seen = new Set(); let characters = 0
  return input.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line) || ![Object.prototype, null].includes(Object.getPrototypeOf(line))) throw new Error('Each OCR line must be a plain object.')
    if (Object.values(Object.getOwnPropertyDescriptors(line)).some(descriptor => !Object.hasOwn(descriptor, 'value'))) throw new Error('OCR line accessors are unsupported.')
    if (typeof line.text !== 'string' || line.text.length > READING_ORDER_POLICY.maxLineCharacters || /[\r\n]/.test(line.text)) throw new Error('OCR text must be a bounded single line.')
    characters += line.text.length
    if (characters > READING_ORDER_POLICY.maxCharacters) throw new Error('Reading-order text exceeds 100000 characters.')
    const id = line.id ?? `line-${index + 1}`; const panelId = line.panelId ?? 'panel-1'
    if (typeof id !== 'string' || !id.trim() || id.length > 200 || seen.has(id)) throw new Error('OCR line IDs must be unique, nonempty and bounded.')
    if (typeof panelId !== 'string' || !panelId.trim() || panelId.length > 200) throw new Error('Invalid OCR panel ID.')
    seen.add(id)
    const geometry = describeReadingOrderBox(line.box, line.text)
    if (line.confidence !== undefined && (typeof line.confidence !== 'number' || !Number.isFinite(line.confidence) || line.confidence < 0 || line.confidence > 1)) throw new Error('OCR line confidence must be between 0 and 1.')
    const result = { id, index, panelId, text: line.text, box: line.box.map(point => [...point]), geometry }
    if (line.confidence !== undefined) result.confidence = line.confidence
    return result
  })
}

function relation(a, b, enforceGap = true) {
  if (a.panelId !== b.panelId) return { compatible: false, reason: 'different_panels' }
  if (!a.geometry.supported || !b.geometry.supported) return { compatible: false, reason: 'unsupported_orientation' }
  if (Math.abs(a.geometry.angle - b.geometry.angle) > READING_ORDER_POLICY.maxPairSkewDifference) return { compatible: false, reason: 'different_baseline_angles' }
  const angle = rad((a.geometry.angle + b.geometry.angle) / 2)
  const u = [Math.cos(angle), Math.sin(angle)]; const v = [-Math.sin(angle), Math.cos(angle)]
  const ax = project(a.box, u); const bx = project(b.box, u); const ay = project(a.box, v); const by = project(b.box, v)
  const maxHeight = Math.max(a.geometry.height, b.geometry.height)
  const minHeight = Math.min(a.geometry.height, b.geometry.height)
  const horizontalGap = Math.max(ax.min, bx.min) - Math.min(ax.max, bx.max)
  const verticalOverlap = Math.min(ay.max, by.max) - Math.max(ay.min, by.min)
  const overlapFraction = verticalOverlap / Math.min(ay.max - ay.min, by.max - by.min)
  const centreOffsetHeights = Math.abs(dot(a.geometry.centre, v) - dot(b.geometry.centre, v)) / maxHeight
  const metrics = { angleDegrees: deg(angle), horizontalGap, gapHeights: horizontalGap / maxHeight, overlapFraction, centreOffsetHeights, heightRatio: maxHeight / minHeight }
  const reason = maxHeight / minHeight > READING_ORDER_POLICY.maxHeightRatio ? 'different_text_scales'
    : horizontalGap < 0 ? 'overlapping_horizontal_ranges'
      : enforceGap && horizontalGap / maxHeight > READING_ORDER_POLICY.maxGapHeights ? 'wide_column_gap'
        : overlapFraction < READING_ORDER_POLICY.minVerticalOverlap ? 'insufficient_vertical_overlap'
          : centreOffsetHeights > READING_ORDER_POLICY.maxCentreOffsetHeights ? 'different_row_centres' : null
  return { compatible: reason === null, reason, metrics }
}

// Exposed for measured layout diagnostics, not for selecting a desired label.
export function inspectReadingOrderPair(first, second) {
  const [a, b] = checkedLines([{ ...first, id: 'pair-a' }, { ...second, id: 'pair-b' }])
  return relation(a, b)
}

const headingMatches = text => [...text.matchAll(/\b(?:M\s*\.?\s*R\s*\.?\s*P|MAXIMUM\s+RETAIL\s+PRICE|NET\s*(?:QTY|QUANTITY|WT\.?|WEIGHT|CONTENTS?)|CONTENTS?|PACKED(?:\s+ON)?|PKD|MFG|MFD|MANUFACTURED|USE[ -]?BY|BEST\s+BEFORE|EXPIRY|UNIT\s+SALE\s+PRICE|UNIT\s+PRICE|USP)\b/gi)].map(match => match[0])

function ambiguityReason(group) {
  if (group.length > READING_ORDER_POLICY.maxPartsPerRow) return 'too_many_row_fragments'
  // Connected components alone can snake through two text rows. Require every
  // pair to share the row band, even when the total row exceeds the link gap.
  for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) {
    const result = relation(group[i], group[j], false)
    if (!result.compatible) return result.reason === 'overlapping_horizontal_ranges' ? 'parallel_or_overlapping_column_candidates' : 'transitive_row_ambiguity'
  }
  const headings = group.flatMap(line => headingMatches(line.text))
  if (headings.length > 1) return 'multiple_declaration_headings'
  if (headings.length === 1 && group.filter(line => /\d/.test(line.text)).length > 1) return 'multiple_numeric_fragments_for_one_heading'
  return null
}

export function reconstructOcrReadingOrder(input = []) {
  const lines = checkedLines(input)
  const graph = lines.map(() => [])
  let pairChecks = 0
  for (let i = 0; i < lines.length; i += 1) for (let j = i + 1; j < lines.length; j += 1) {
    pairChecks += 1
    if (relation(lines[i], lines[j]).compatible) { graph[i].push(j); graph[j].push(i) }
  }
  const seen = new Set(); const groups = []
  for (let i = 0; i < lines.length; i += 1) {
    if (seen.has(i)) continue
    const indexes = []; const stack = [i]; seen.add(i)
    while (stack.length) { const at = stack.pop(); indexes.push(at); for (const next of graph[at]) if (!seen.has(next)) { seen.add(next); stack.push(next) } }
    groups.push(indexes.map(index => lines[index]))
  }
  const abstentions = []; const reconstructed = []
  const makeRow = (parts, kind) => {
    const angle = mean(parts.map(part => part.geometry.angle))
    const u = [Math.cos(rad(angle)), Math.sin(rad(angle))]
    const ordered = kind === 'reconstructed-row' ? [...parts].sort((a, b) => dot(a.geometry.centre, u) - dot(b.geometry.centre, u) || a.index - b.index) : parts
    return { id: `row:${ordered.map(part => part.id).join('+')}`, kind, text: ordered.map(part => part.text).join(' '), panelId: ordered[0].panelId, baselineAngleDegrees: angle, sourceIds: ordered.map(part => part.id), sourceIndexes: ordered.map(part => part.index), parts: ordered.map(part => ({ sourceId: part.id, sourceIndex: part.index, text: part.text, box: part.box.map(point => [...point]) })) }
  }
  for (const group of groups) {
    if (group.length === 1) {
      if (!group[0].geometry.supported) abstentions.push({ sourceIds: [group[0].id], reason: 'unsupported_rotation_or_skew' })
      reconstructed.push(makeRow(group, 'unchanged'))
      continue
    }
    const reason = ambiguityReason(group)
    if (reason) { abstentions.push({ sourceIds: group.map(part => part.id), reason }); reconstructed.push(...group.map(part => makeRow([part], 'unchanged'))) }
    else reconstructed.push(makeRow(group, 'reconstructed-row'))
  }
  const panelIds = [...new Set(lines.map(line => line.panelId))]
  const medianAngles = Object.fromEntries(panelIds.map(panelId => [panelId, median(lines.filter(line => line.panelId === panelId && line.geometry.supported).map(line => line.geometry.angle))]))
  const lineMap = new Map(lines.map(line => [line.id, line]))
  const position = row => {
    const angle = rad(medianAngles[row.panelId])
    const v = [-Math.sin(angle), Math.cos(angle)]; const u = [Math.cos(angle), Math.sin(angle)]
    const parts = row.sourceIds.map(id => lineMap.get(id))
    return { y: mean(parts.map(part => dot(part.geometry.centre, v))), x: Math.min(...parts.map(part => dot(part.geometry.centre, u))) }
  }
  reconstructed.sort((a, b) => panelIds.indexOf(a.panelId) - panelIds.indexOf(b.panelId) || position(a).y - position(b).y || position(a).x - position(b).x || Math.min(...a.sourceIndexes) - Math.min(...b.sourceIndexes))
  const rawLines = lines.map(({ geometry: _geometry, ...line }) => line)
  return {
    schemaVersion: 1, method: 'general-overlap-reading-order-v1', transcriptKind: 'system-derived-reading-order',
    rawLines, rawText: rawLines.map(line => line.text).join('\n'), transcript: reconstructed.map(row => row.text).join('\n'), rows: reconstructed, abstentions, policy: { ...READING_ORDER_POLICY },
    statistics: { sourceLines: lines.length, outputRows: reconstructed.length, reconstructedRows: reconstructed.filter(row => row.kind === 'reconstructed-row').length, rejectedGroups: abstentions.length, pairChecks },
    limitations: ['Experimental geometric row reconstruction, not validated field or legal accuracy.', 'Exact OCR strings are retained; only row ordering and separating spaces change.', 'No digit, heading, unit, date, spelling, case or punctuation correction is performed.', 'Half-height overlap is a generic geometric heuristic. Ambiguous columns, multiple declaration headings/numeric fragments and incompatible row bands cause abstention.', 'Only near-horizontal baselines are supported. Stacked forms, rotated print and different column row spacing may remain unresolved.', 'All original lines and derived row-to-box mappings remain available for review.'],
  }
}

function exactStandaloneHeading(text) {
  const trimmed = text.trim()
  if (/^(?:M\s*\.?\s*R\s*\.?\s*P\.?|MAXIMUM\s+RETAIL\s+PRICE)\s*[:\-]?\s*(?:₹|RS\.?|INR)?\s*[:\-]?$/i.test(trimmed)) return 'mrp'
  if (/^(?:NET\s*(?:CONTENTS?|QTY\.?|QUANTITY|WT\.?|WEIGHT|VOLUME)|CONTENTS?)\s*[:\-]?$/i.test(trimmed)) return 'netQuantity'
  if (/^(?:PACKED|PKD\.?|MFG\.?|MFD\.?|MANUFACTURED)(?:\s+(?:ON|DATE))?\s*[:\-]?$/i.test(trimmed)) return 'packDate'
  return null
}

// This is a filter over this module's mapped output, not permission to rewrite
// a transcript. Every returned suggestion still requires an officer decision.
export function reviewableDeclarationProposals(readingOrder) {
  if (!readingOrder || readingOrder.method !== 'general-overlap-reading-order-v1' || !Array.isArray(readingOrder.rows) || !Array.isArray(readingOrder.rawLines) || typeof readingOrder.rawText !== 'string') throw new Error('Review proposals require this module\'s mapped reading-order result.')
  const rawLines = checkedLines(readingOrder.rawLines)
  if (rawLines.map(line => line.text).join('\n') !== readingOrder.rawText) throw new Error('Reading-order raw text does not match its original lines.')
  const byId = new Map(rawLines.map(line => [line.id, line]))
  const preliminary = []; const rejected = []
  for (const row of readingOrder.rows) {
    if (row.kind !== 'reconstructed-row') continue
    if (!Array.isArray(row.parts) || !row.parts.length || row.text !== row.parts.map(part => part.text).join(' ') || row.parts.some(part => !byId.has(part.sourceId) || byId.get(part.sourceId).text !== part.text || JSON.stringify(byId.get(part.sourceId).box) !== JSON.stringify(part.box))) throw new Error('Derived row text or source mapping was altered.')
    const field = exactStandaloneHeading(row.parts[0].text)
    if (!field) continue
    if (row.parts.length !== 2 || headingMatches(row.text).length !== 1) { rejected.push({ rowId: row.id, field, reason: 'requires_one_standalone_heading_and_one_value_fragment' }); continue }
    const parsed = extractDeclarations(row.text).byId[field]
    if (parsed.candidates.length !== 1 || !parsed.candidates[0].valid || parsed.conflict || parsed.validation?.status !== 'format_valid') { rejected.push({ rowId: row.id, field, reason: 'strict_parser_did_not_produce_one_valid_value' }); continue }
    preliminary.push({ row, field, candidate: parsed.candidates[0], value: parsed.value })
  }
  const proposals = []
  for (const item of preliminary) {
    const sameField = preliminary.filter(other => other.field === item.field)
    const resolvedSources = new Set(sameField.flatMap(other => other.row.parts.map(part => part.sourceId)))
    const otherCandidates = rawLines.filter(line => !resolvedSources.has(line.id)).flatMap(line => extractDeclarations(line.text).byId[item.field].candidates)
    const keys = new Set([...sameField.map(other => other.candidate.key), ...otherCandidates.filter(candidate => candidate.valid).map(candidate => candidate.key)])
    if (keys.size !== 1 || otherCandidates.some(candidate => !candidate.valid)) {
      rejected.push({ rowId: item.row.id, field: item.field, reason: keys.size !== 1 ? 'conflicting_field_values_elsewhere_in_evidence' : 'unresolved_field_evidence_elsewhere', otherCandidateValues: otherCandidates.map(candidate => ({ value: candidate.value, valid: candidate.valid })) })
      continue
    }
    proposals.push({ id: `proposal:${item.row.id}`, rowId: item.row.id, field: item.field, value: item.value, text: item.row.text, sourceIds: [...item.row.sourceIds], sourceIndexes: [...item.row.sourceIndexes], parts: item.row.parts.map(part => ({ ...part, box: part.box.map(point => [...point]) })), validation: { ...item.candidate.validation }, requiresOfficerReview: true, eligibleForAutomaticVerdict: false })
  }
  return { proposals, rejected, policy: 'Exact standalone MRP/net quantity/packing heading plus one mapped value box; strict valid conflict-free corresponding extraction; unresolved or conflicting same-field evidence blocks suggestions. Use-by, serving, manufacturer-BY, ordinary columns and incomplete values are excluded. Officer acceptance is mandatory; no raw transcript is changed.' }
}
