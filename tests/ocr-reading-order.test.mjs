import test from 'node:test'
import assert from 'node:assert/strict'
import { reconstructOcrReadingOrder, inspectReadingOrderPair, reviewableDeclarationProposals } from '../src/lib/ocrReadingOrder.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const line = (id, text, x, y, width = 40, height = 20, panelId = 'panel') => ({ id, text, panelId, box: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] })
const turn = (part, degrees) => { const angle = degrees * Math.PI / 180; return { ...part, box: part.box.map(([x, y]) => [500 + x * Math.cos(angle) - y * Math.sin(angle), 500 + x * Math.sin(angle) + y * Math.cos(angle)]) } }

test('general reconstruction joins three adjacent fragments without a heading-seeded stage', () => {
  const input = [line('u', 'ml', 120, 10, 20), line('h', 'NET QTY:', 10, 10, 60), line('n', '500', 80, 10, 30)]
  const original = structuredClone(input)
  const result = reconstructOcrReadingOrder(input)
  assert.deepEqual(input, original)
  assert.equal(result.transcript, 'NET QTY: 500 ml')
  assert.equal(result.rawText, 'ml\nNET QTY:\n500')
  assert.equal(extractDeclarations(result.transcript).byId.netQuantity.value, '500 ml')
  assert.deepEqual(result.rows[0].sourceIds, ['h', 'n', 'u'])
  assert.deepEqual(result.rows[0].parts.map(part => part.box), [input[1].box, input[2].box, input[0].box])
})

test('different font heights can share a half-overlapping row without centre equality', () => {
  const a = line('h', 'PACKED ON:', 10, 44, 35, 6)
  const b = line('v', '03/04/25', 90, 36, 40, 11)
  assert.equal(inspectReadingOrderPair(a, b).compatible, true)
  const result = reconstructOcrReadingOrder([b, a])
  assert.equal(result.transcript, 'PACKED ON: 03/04/25')
})

test('fragments preserve exact strings including OCR errors and whitespace', () => {
  const result = reconstructOcrReadingOrder([line('h', 'NET QTY: ', 10, 10), line('v', ' 5OO ', 60, 10), line('u', 'mr', 110, 10)])
  assert.equal(result.transcript, 'NET QTY:   5OO  mr')
  assert.equal(extractDeclarations(result.transcript).byId.netQuantity.validation.status, 'invalid')
  assert.equal(result.rows[0].parts[1].text, ' 5OO ')
})

test('body text rows reconstruct generically without inventing a declaration heading', () => {
  const result = reconstructOcrReadingOrder([line('b', 'Foods', 70, 10), line('a', 'Example', 10, 10)])
  assert.equal(result.transcript, 'Example Foods')
  assert.equal(extractDeclarations(result.transcript).byId.mrp.candidates.length, 0)
})

test('common mild skew is handled along baseline; rotation and different slopes abstain', () => {
  const base = [line('h', 'MRP:', 10, 10), line('v', '25.00', 80, 10)]
  assert.equal(reconstructOcrReadingOrder(base.map(part => turn(part, 8))).statistics.reconstructedRows, 1)
  assert.equal(reconstructOcrReadingOrder(base.map(part => turn(part, 90))).statistics.reconstructedRows, 0)
  assert.equal(reconstructOcrReadingOrder([turn(base[0], 0), turn(base[1], 12)]).statistics.reconstructedRows, 0)
})

test('two overlapping vertical candidates do not get assigned to the middle heading', () => {
  const result = reconstructOcrReadingOrder([line('h', 'PACKED:', 10, 40), line('v1', '03/04/25', 80, 30), line('v2', '04/04/25', 80, 50)])
  assert.equal(result.statistics.reconstructedRows, 0)
  assert.ok(result.abstentions.some(item => item.reason === 'parallel_or_overlapping_column_candidates'))
})

test('transitive overlapping bands cannot snake two different rows together', () => {
  const result = reconstructOcrReadingOrder([line('a', 'First', 10, 10), line('b', 'Middle', 70, 20), line('c', 'Last', 130, 30)])
  assert.equal(result.statistics.reconstructedRows, 0)
  assert.ok(result.abstentions.some(item => item.reason === 'transitive_row_ambiguity'))
})

test('multiple declaration columns are not merged into an invented single row', () => {
  const result = reconstructOcrReadingOrder([line('h1', 'MRP:', 10, 10), line('v1', '25', 60, 10), line('h2', 'NET QTY:', 110, 10, 70), line('v2', '50 g', 190, 10)])
  assert.equal(result.statistics.reconstructedRows, 0)
  assert.ok(result.abstentions.some(item => item.reason === 'multiple_declaration_headings'))
})

test('multiple price fragments for one heading are ambiguous even on one baseline', () => {
  const result = reconstructOcrReadingOrder([line('h', 'MRP:', 10, 10), line('v1', '25', 60, 10), line('v2', '50', 110, 10)])
  assert.equal(result.statistics.reconstructedRows, 0)
  assert.ok(result.abstentions.some(item => item.reason === 'multiple_numeric_fragments_for_one_heading'))
})

test('use-by cannot absorb a neighbouring USP row solely through geometric proximity', () => {
  const result = reconstructOcrReadingOrder([line('h', 'USE BY:', 10, 10), line('v', '90.00 USP', 80, 10, 90), line('u', 'Rs.0.18/g', 190, 10, 100)])
  assert.equal(result.statistics.reconstructedRows, 0)
  assert.ok(result.abstentions.some(item => item.reason === 'multiple_declaration_headings'))
})

test('clear contradictory MRP rows retain both values for the actual parser', () => {
  const result = reconstructOcrReadingOrder([line('h1', 'MRP:', 10, 10), line('v1', '25', 80, 10), line('h2', 'MRP:', 10, 80), line('v2', '50', 80, 80)])
  assert.equal(result.statistics.reconstructedRows, 2)
  assert.equal(extractDeclarations(result.transcript).byId.mrp.conflict, true)
})

test('wide gaps, stacked fields and different panels are left separate', () => {
  assert.equal(reconstructOcrReadingOrder([line('h', 'MRP:', 10, 10), line('v', '25', 1000, 10)]).statistics.reconstructedRows, 0)
  assert.equal(reconstructOcrReadingOrder([line('h', 'NET QTY:', 10, 10), line('v', '500 ml', 10, 80)]).statistics.reconstructedRows, 0)
  assert.equal(reconstructOcrReadingOrder([line('h', 'MRP:', 10, 10, 40, 20, 'front'), line('v', '25', 80, 10, 40, 20, 'back')]).statistics.reconstructedRows, 0)
})

test('every source line occurs once in output mappings while raw order stays untouched', () => {
  const input = [line('c', 'Lower', 10, 100), line('a', 'MRP:', 10, 10), line('b', '25', 80, 10)]
  const result = reconstructOcrReadingOrder(input)
  assert.equal(result.rawText, 'Lower\nMRP:\n25')
  assert.equal(result.transcript, 'MRP: 25\nLower')
  assert.deepEqual(result.rows.flatMap(row => row.sourceIds).sort(), ['a', 'b', 'c'])
  for (const row of result.rows) assert.equal(row.text, row.parts.map(part => part.text).join(' '))
})

test('malformed geometry, duplicate IDs and oversized text fail explicitly', () => {
  assert.throws(() => reconstructOcrReadingOrder(null), /dense/)
  assert.throws(() => reconstructOcrReadingOrder(Array(1)), /dense/)
  assert.throws(() => reconstructOcrReadingOrder([line('a', 'x', 10, 10), line('a', 'y', 80, 10)]), /unique/)
  assert.throws(() => reconstructOcrReadingOrder([line('a', 'x'.repeat(2001), 10, 10)]), /bounded/)
  assert.throws(() => reconstructOcrReadingOrder([{ ...line('a', 'x', 10, 10), box: [[0, 0], [1, 1], [0, 1], [1, 0]] }]), /convex/)
  assert.throws(() => reconstructOcrReadingOrder([{ ...line('a', 'x', 10, 10), confidence: Infinity }]), /confidence/)
})

test('review-only proposal retains exact mapped parts and requires officer acceptance', () => {
  const order = reconstructOcrReadingOrder([line('v', '03/04/25', 90, 36, 40, 11), line('h', 'PACKED ON:', 10, 44, 35, 6)])
  const { proposals } = reviewableDeclarationProposals(order)
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].field, 'packDate')
  assert.equal(proposals[0].value, '03/04/25')
  assert.equal(proposals[0].eligibleForAutomaticVerdict, false)
  assert.equal(proposals[0].requiresOfficerReview, true)
  assert.deepEqual(proposals[0].parts.map(part => part.text), ['PACKED ON:', '03/04/25'])
  assert.equal(order.rawText, '03/04/25\nPACKED ON:')
})

test('review proposals exclude use-by, serving, manufacturer-BY and unrelated columns', () => {
  for (const heading of ['USE BY:', 'SERVING SIZE:', 'MANUFACTURED BY:', 'AFTER USE', 'DORDONTACT AT MFD &']) {
    const order = reconstructOcrReadingOrder([line('h', heading, 10, 10, 180), line('v', '03/04/25', 220, 10, 90)])
    assert.equal(reviewableDeclarationProposals(order).proposals.length, 0, heading)
  }
})

test('invalid recognition or multiple value fragments cannot become a review proposal', () => {
  const invalid = reconstructOcrReadingOrder([line('h', 'NET QTY:', 10, 10, 70), line('v', '500mr', 100, 10)])
  assert.equal(reviewableDeclarationProposals(invalid).proposals.length, 0)
  const fragments = reconstructOcrReadingOrder([line('h', 'NET QTY:', 10, 10, 70), line('v', '500', 100, 10), line('u', 'ml', 150, 10)])
  assert.equal(reviewableDeclarationProposals(fragments).proposals.length, 0)
})

test('conflicting complete declarations, conflicting proposed rows and unresolved headings block proposals', () => {
  const pair = [line('h', 'MRP:', 10, 10), line('v', '25.00', 80, 10)]
  for (const extra of [
    [line('other', 'MRP 50.00', 10, 100, 100)],
    [line('h2', 'MRP:', 10, 100), line('v2', '50.00', 80, 100)],
    [line('h2', 'MRP:', 10, 100)],
  ]) assert.equal(reviewableDeclarationProposals(reconstructOcrReadingOrder([...pair, ...extra])).proposals.length, 0)
})

test('altered derived text or source box mappings cannot generate review proposals', () => {
  const order = reconstructOcrReadingOrder([line('h', 'MRP:', 10, 10), line('v', '25.00', 80, 10)])
  const badText = structuredClone(order); badText.rows[0].text = 'MRP: 20.00'
  assert.throws(() => reviewableDeclarationProposals(badText), /altered/)
  const badBox = structuredClone(order); badBox.rows[0].parts[0].box[0][0] += 1
  assert.throws(() => reviewableDeclarationProposals(badBox), /altered/)
})
