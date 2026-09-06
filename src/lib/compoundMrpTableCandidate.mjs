import { associateSpatialOcrRows } from './spatialOcr.mjs'
import { parseLabelNumbers, parsePositiveNumber, parsePackingDates } from './labelParser.mjs'

// Isolated, NOT integrated into the parser or automatic working transcript.
// A compound MRP/USP stamp must have three other complete ordered table rows.
// We choose the geometric column BEFORE testing whether any value has a useful
// type. Missing rows, competing columns and damaged anchors withhold the result.
export const COMPOUND_MRP_TABLE_POLICY = Object.freeze({
  maxLines: 250, anchorCount: 3, maxAngleDegrees: 10,
  columnOffsetHeights: .75, minHeadingGapHeights: 1.2,
  maxHeadingGapHeights: 3.5, maxHeadingGapVariation: .25,
  maxFirstRowOffsetHeights: .55, minRowScale: .65, maxRowScale: 1.4,
  maxAnchorResidualHeights: .2, maxTargetResidualHeights: .25,
})

const MRP = '(?:M[ \\t]*\\.?[ \\t]*R[ \\t]*\\.?[ \\t]*P\\.?|MAXIMUM[ \\t]+RETAIL[ \\t]+PRICE)'
const compound = new RegExp(`^(${MRP})[ \\t]*(?:₹|RS\\.?|INR)?[ \\t]*[-/][ \\t]*USP[ \\t]*(?:₹|RS\\.?|INR)?[ \\t]*:?[ \\t]*$`, 'i')
const anyMrp = new RegExp(`\\b${MRP}(?=\\b|\\d)`, 'i')
const anchorKind = text => /^(?:BATCH|LOT)[ \t]*(?:NO\.?)?[ \t]*:?[ \t]*$/i.test(text) ? 'batch'
  : /^(?:PACKED|PKD|MFG|MFD|MANUFACTURED)(?:[ \t]+(?:ON|DATE))?[ \t]*:?[ \t]*$/i.test(text) ? 'packed'
    : /^(?:USE[ -]?BY|EXPIRY|EXP(?:IRY)?[ \t]+DATE)[ \t]*:?[ \t]*$/i.test(text) ? 'use-by' : null
const mean = values => values.reduce((a, b) => a + b, 0) / values.length
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const canonical = line => line.text.trim()

function measured(line) {
  const [tl, tr, br, bl] = line.box
  const top = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]) * 180 / Math.PI
  const bottom = Math.atan2(br[1] - bl[1], br[0] - bl[0]) * 180 / Math.PI
  return { ...line, kind: anchorKind(canonical(line)), x: mean(line.box.map(p => p[0])), y: mean(line.box.map(p => p[1])),
    left: Math.min(...line.box.map(p => p[0])), right: Math.max(...line.box.map(p => p[0])),
    height: (Math.hypot(tl[0] - bl[0], tl[1] - bl[1]) + Math.hypot(tr[0] - br[0], tr[1] - br[1])) / 2,
    supported: Math.abs(top) <= COMPOUND_MRP_TABLE_POLICY.maxAngleDegrees && Math.abs(bottom) <= COMPOUND_MRP_TABLE_POLICY.maxAngleDegrees && Math.abs(top - bottom) <= 5 }
}

function fit(anchors, values) {
  const x = mean(anchors.map(line => line.y)); const y = mean(values.map(line => line.y))
  const denominator = anchors.reduce((sum, line) => sum + (line.y - x) ** 2, 0)
  if (!denominator) return null
  const scale = anchors.reduce((sum, line, index) => sum + (line.y - x) * (values[index].y - y), 0) / denominator
  const intercept = y - scale * x
  return { scale, intercept, residual: Math.max(...anchors.map((line, index) => Math.abs(values[index].y - (scale * line.y + intercept)))) }
}

function calendarDate(text) {
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})$/.exec(text)
  if (!match) return false
  const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= 1900 && year <= 2199 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function anchorValueValid(heading, value) {
  const text = canonical(value)
  if (heading.kind === 'batch') return /^[A-Z0-9][A-Z0-9./-]{1,63}$/i.test(text)
  if (!calendarDate(text)) return false
  if (heading.kind === 'use-by') return true
  const parsed = parsePackingDates(`${heading.text} ${value.text}`)
  return parsed.length === 1 && parsed[0].valid
}

export function reviewableCompoundMrpTableCandidates(inputLines = []) {
  if (!Array.isArray(inputLines) || inputLines.length > COMPOUND_MRP_TABLE_POLICY.maxLines) throw new Error('Compound declaration diagnostics require at most 250 source lines.')
  // Reuse the existing bounded, accessor-rejecting source/quad validation. Its
  // row suggestions are ignored; this module never inherits nearest-row picks.
  const raw = associateSpatialOcrRows(inputLines).rawLines
  const lines = raw.map(measured)
  const candidates = []; const rejected = []
  const policy = COMPOUND_MRP_TABLE_POLICY
  for (const target of lines.filter(line => compound.test(canonical(line)))) {
    const reject = (reason, detail = {}) => rejected.push({ headingId: target.id, reason, ...detail })
    const peers = lines.filter(line => line.panelId === target.panelId)
    if (!target.supported) { reject('unsupported_compound_heading_geometry'); continue }
    if (peers.some(line => line.id !== target.id && anyMrp.test(line.text))) { reject('other_mrp_evidence_requires_review'); continue }
    const anchorRows = peers.filter(line => line.kind && line.y < target.y && Math.abs(line.left - target.left) <= target.height * policy.columnOffsetHeights).sort((a, b) => a.y - b.y)
    if (anchorRows.length !== policy.anchorCount || new Set(anchorRows.map(line => line.kind)).size !== policy.anchorCount) { reject('three_distinct_complete_anchor_headings_required'); continue }
    const headings = [...anchorRows, target]
    if (headings.some(line => !line.supported)) { reject('unsupported_anchor_geometry'); continue }
    const headingHeight = median(headings.map(line => line.height))
    const gaps = headings.slice(1).map((line, index) => line.y - headings[index].y)
    if (gaps.some(gap => gap < headingHeight * policy.minHeadingGapHeights || gap > headingHeight * policy.maxHeadingGapHeights)
      || (Math.max(...gaps) - Math.min(...gaps)) / median(gaps) > policy.maxHeadingGapVariation) { reject('irregular_or_missing_heading_rows'); continue }
    const headingIds = new Set(headings.map(line => line.id))
    const leftBoundary = Math.max(...headings.map(line => line.right))
    if (peers.some(line => !headingIds.has(line.id) && canonical(line) && line.y > anchorRows[0].y && line.y < target.y && line.left <= leftBoundary && line.right >= Math.min(...headings.map(row => row.left)))) { reject('intervening_heading_column_text'); continue }
    const columnLines = peers.filter(line => !headingIds.has(line.id) && canonical(line) && line.left > leftBoundary + headingHeight
      && line.y > anchorRows[0].y - 2 * headingHeight && line.y < target.y + 2 * headingHeight)
    const possible = new Map(); const partialColumns = new Map()
    for (const seed of columnLines) {
      const cluster = columnLines.filter(line => Math.abs(line.left - seed.left) <= headingHeight * policy.columnOffsetHeights).sort((a, b) => a.y - b.y)
      if (Math.max(...cluster.map(line => line.left)) - Math.min(...cluster.map(line => line.left)) > headingHeight * policy.columnOffsetHeights) continue
      const key = JSON.stringify(cluster.map(line => line.id))
      if (cluster.length >= policy.anchorCount) partialColumns.set(key, cluster)
      if (cluster.length === headings.length) possible.set(key, cluster)
    }
    // No ranking by closeness, confidence, numeric format or expected answers.
    if (possible.size !== 1) { reject(possible.size ? 'multiple_geometric_value_columns' : 'no_complete_unique_value_column'); continue }
    const column = [...possible.values()][0]
    if ([...partialColumns.values()].some(cluster => cluster.every(line => !column.some(value => value.id === line.id)))) { reject('competing_partial_value_column'); continue }
    const valueHeight = median(column.map(line => line.height))
    if (column.some(line => !line.supported || line.height / headingHeight > 2.5 || line.height / headingHeight < .4)) { reject('unsupported_value_geometry'); continue }
    if (Math.abs(column[0].y - anchorRows[0].y) > Math.max(column[0].height, anchorRows[0].height) * policy.maxFirstRowOffsetHeights) { reject('first_anchor_row_not_geometrically_supported'); continue }
    const mapping = fit(anchorRows, column.slice(0, policy.anchorCount))
    if (!mapping || mapping.scale < policy.minRowScale || mapping.scale > policy.maxRowScale || mapping.residual > valueHeight * policy.maxAnchorResidualHeights) { reject('anchor_row_mapping_is_inconsistent'); continue }
    const price = column.at(-1)
    const targetResidual = Math.abs(price.y - (mapping.scale * target.y + mapping.intercept))
    if (targetResidual > valueHeight * policy.maxTargetResidualHeights) { reject('compound_row_does_not_follow_anchor_mapping'); continue }
    if (!anchorRows.every((heading, index) => anchorValueValid(heading, column[index]))) { reject('geometrically_assigned_anchor_value_is_invalid'); continue }
    const priceMatch = /^(?:(?:₹|RS\.?|INR)[ \t]*)?(\d[\d,.]*)[ \t]+USP[ \t]*:?[ \t]*$/i.exec(canonical(price))
    const amount = parsePositiveNumber(priceMatch?.[1], 2)
    if (!amount) { reject('complete_amount_followed_by_literal_usp_required'); continue }
    const companionLines = peers.filter(line => !headingIds.has(line.id) && !column.some(value => value.id === line.id) && canonical(line) && line.x > price.x
      && line.left - price.right >= -.75 * valueHeight && line.left - price.right <= 6 * valueHeight
      && Math.abs(line.y - price.y) <= .4 * Math.max(line.height, price.height))
    if (companionLines.length !== 1) { reject(companionLines.length ? 'multiple_unit_price_row_fragments' : 'unit_price_row_fragment_missing'); continue }
    const unitPrice = companionLines[0]
    if (!unitPrice.supported || !/^(?:₹|RS\.?|INR)[ \t]*\d[\d,.]*[ \t]*\/[ \t]*\S+[ \t]*$/i.test(canonical(unitPrice))) { reject('unit_price_fragment_not_literal_currency_ratio'); continue }
    // Do not fix a denominator such as OCR "9" into "g". The separate USP
    // candidate may be invalid even when this exact literal MRP is recoverable.
    const unitCandidates = parseLabelNumbers(`${price.text} ${unitPrice.text}`).unitSalePrice
    const amountStart = price.text.indexOf(priceMatch[1])
    const headingMatch = compound.exec(canonical(target))
    const headingStart = target.text.indexOf(headingMatch[1])
    candidates.push({
      id: `compound-table:${target.id}:${price.id}:${unitPrice.id}`, panelId: target.panelId, field: 'mrp', value: amount.normalized,
      sourceIds: [target.id, price.id, unitPrice.id], text: `${target.text} ${price.text} ${unitPrice.text}`,
      parts: [target, price, unitPrice].map(line => ({ sourceId: line.id, text: line.text, box: line.box.map(point => [...point]) })),
      literalSpans: { heading: { sourceId: target.id, start: headingStart, end: headingStart + headingMatch[1].length, text: headingMatch[1] }, amount: { sourceId: price.id, start: amountStart, end: amountStart + priceMatch[1].length, text: priceMatch[1] } },
      anchorPairs: anchorRows.map((heading, index) => ({ kind: heading.kind, headingId: heading.id, valueId: column[index].id })),
      geometry: { rowScale: mapping.scale, maxAnchorResidualPixels: mapping.residual, targetResidualPixels: targetResidual },
      unitSalePrice: { rawText: `${price.text} ${unitPrice.text}`, formatValid: unitCandidates.length === 1 && unitCandidates[0].valid, candidates: unitCandidates },
      method: 'three-anchor-compound-mrp-table-v1', requiresOfficerReview: true, eligibleForAutomaticVerdict: false, mutatesTranscript: false,
    })
  }
  return { candidates, rejected, rawText: raw.map(line => line.text).join('\n'), policy: { ...policy },
    limitation: 'Isolated unverified compound-table candidate, not integrated into working-text extraction. Three ordered literal anchor rows support one unique column before value-format checks. Full source strings remain unchanged; character spans are not glyph measurements. Heuristic geometry is not calibrated semantic certainty.' }
}
