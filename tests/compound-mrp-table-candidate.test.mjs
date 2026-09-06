import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewableCompoundMrpTableCandidates } from '../src/lib/compoundMrpTableCandidate.mjs'

const line = (id, text, x, y, width = 110, height = 20, panelId = 'p') => ({ id, text, panelId, box: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], confidence: .9 })
function fixture() {
  return [line('h1', 'LOT NO:', 10, 100), line('h2', 'PACKED ON:', 10, 140), line('h3', 'USE BY:', 10, 180), line('h4', 'MRP-USP:', 10, 220),
    line('v1', 'XK114A', 250, 100, 130, 24), line('v2', '11/05/2024', 250, 132, 130, 24), line('v3', '12/05/2025', 250, 164, 130, 24), line('v4', '48.50 USP ', 250, 196, 130, 24),
    line('usp', 'RS 0.49/g', 385, 196, 105, 24)]
}
function modified(id, patch) { return fixture().map(item => item.id === id ? { ...item, ...patch } : item) }
const zero = (lines, reason) => { const result = reviewableCompoundMrpTableCandidates(lines); assert.equal(result.candidates.length, 0); assert.ok(result.rejected.some(item => item.reason === reason), JSON.stringify(result.rejected)) }

test('three ordered literal anchors support one compound candidate with exact source spans and no transcript change', () => {
  const sources = fixture(); const before = structuredClone(sources)
  const result = reviewableCompoundMrpTableCandidates(sources)
  assert.equal(result.candidates.length, 1)
  const item = result.candidates[0]
  assert.equal(item.value, '48.50')
  assert.equal(item.text, 'MRP-USP: 48.50 USP  RS 0.49/g')
  assert.equal(item.requiresOfficerReview, true)
  assert.equal(item.eligibleForAutomaticVerdict, false)
  assert.equal(item.mutatesTranscript, false)
  assert.equal(item.anchorPairs.length, 3)
  for (const span of Object.values(item.literalSpans)) assert.equal(sources.find(line => line.id === span.sourceId).text.slice(span.start, span.end), span.text)
  assert.equal(item.unitSalePrice.formatValid, true)
  assert.equal(result.rawText, sources.map(line => line.text).join('\n'))
  assert.deepEqual(sources, before)
})

test('input order and different literal numbers do not select a different geometric column', () => {
  const source = modified('v4', { text: '123.75 USP' }).reverse()
  const result = reviewableCompoundMrpTableCandidates(source)
  assert.equal(result.candidates[0]?.value, '123.75')
  assert.deepEqual(result.candidates[0].anchorPairs.map(pair => pair.valueId), ['v1', 'v2', 'v3'])
})

test('competing complete value columns abstain before checking which values parse', () => {
  const source = fixture()
  for (let index = 0; index < 4; index++) source.push(line(`r${index}`, 'not a number', 650, 100 + index * 32, 130, 24))
  zero(source, 'multiple_geometric_value_columns')
})

test('a partially detected competing column is not ignored because the other one is complete', () => {
  const source = fixture()
  for (let index = 0; index < 3; index++) source.push(line(`r${index}`, 'different text', 650, 100 + index * 32, 130, 24))
  zero(source, 'competing_partial_value_column')
})

test('missing anchors and repeated anchor types cannot create the required table evidence', () => {
  zero(fixture().filter(item => item.id !== 'h2'), 'three_distinct_complete_anchor_headings_required')
  zero(modified('h2', { text: 'LOT NO:' }), 'three_distinct_complete_anchor_headings_required')
})

test('extra text rows and misplaced compound amounts do not get skipped to make a table fit', () => {
  zero([...fixture(), line('extra', '42', 250, 148, 80, 10)], 'no_complete_unique_value_column')
  zero(modified('v4', { box: line('', '', 250, 225, 130, 24).box }), 'compound_row_does_not_follow_anchor_mapping')
})

test('consistent but row-shifted columns and inconsistent anchors are rejected', () => {
  const shifted = fixture().map(item => /^v\d/.test(item.id) ? { ...item, box: item.box.map(([x, y]) => [x, y + 28]) } : item)
  zero(shifted, 'first_anchor_row_not_geometrically_supported')
  zero(modified('v2', { box: line('', '', 250, 149, 130, 24).box }), 'anchor_row_mapping_is_inconsistent')
})

test('damaged anchor values are not replaced or matched to a different plausible-looking row', () => {
  zero(modified('v2', { text: '31/02/2024' }), 'geometrically_assigned_anchor_value_is_invalid')
  zero(modified('v3', { text: '12/05/2O25' }), 'geometrically_assigned_anchor_value_is_invalid')
})

test('compound amount must be complete and followed by the literal USP boundary', () => {
  for (const text of ['4S.50 USP', '48.50 75 USP', '48.500 USP', '48.50', '48.50 / 75 USP']) zero(modified('v4', { text }), 'complete_amount_followed_by_literal_usp_required')
})

test('an OCR-confused unit stays invalid and is never repaired to manufacture a net quantity', () => {
  const result = reviewableCompoundMrpTableCandidates(modified('usp', { text: 'RS 0.49/9' }))
  assert.equal(result.candidates[0]?.value, '48.50')
  assert.equal(result.candidates[0].unitSalePrice.formatValid, false)
  assert.match(result.candidates[0].unitSalePrice.rawText, /0\.49\/9/)
  assert.equal(result.candidates[0].netQuantity, undefined)
})

test('missing or competing unit-price boxes and separate MRP declarations force review', () => {
  zero(fixture().filter(item => item.id !== 'usp'), 'unit_price_row_fragment_missing')
  zero([...fixture(), line('usp-other', 'RS 9/L', 500, 196, 80, 24)], 'multiple_unit_price_row_fragments')
  zero([...fixture(), line('mrp-other', 'MRP 75', 10, 290)], 'other_mrp_evidence_requires_review')
})

test('headings separated by unknown text cannot be silently assembled into a table', () => {
  zero([...fixture(), line('unknown-row', 'OTHER DECLARATION', 10, 165)], 'intervening_heading_column_text')
})

test('malformed geometry and unbounded input reject; rows from another panel cannot act as anchors', () => {
  assert.throws(() => reviewableCompoundMrpTableCandidates(Array(251).fill({})), /250/)
  assert.throws(() => reviewableCompoundMrpTableCandidates(modified('v4', { box: [[0, 0]] })), /points/)
  zero(modified('h1', { panelId: 'another-panel' }), 'three_distinct_complete_anchor_headings_required')
})
