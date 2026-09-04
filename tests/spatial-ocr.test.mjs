import test from 'node:test'
import assert from 'node:assert/strict'
import { associateSpatialOcrRows, rapidOcrLines } from '../src/lib/spatialOcr.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const line = (id, text, x = 10, y = 10, w = 50, h = 20, extra = {}) => ({ id, text, box: box(x, y, w, h), ...extra })
const rotate = (item, angle) => {
  const a = angle * Math.PI / 180
  return { ...item, box: item.box.map(([x, y]) => [300 + x * Math.cos(a) - y * Math.sin(a), 300 + x * Math.sin(a) + y * Math.cos(a)]) }
}

test('clear heading/value row is joined with exact text and every source box retained', () => {
  const inputs = [line('value', ' 22.00 ', 100), line('heading', 'MRP: ', 10)]
  const original = structuredClone(inputs)
  const result = associateSpatialOcrRows(inputs)
  assert.deepEqual(inputs, original)
  assert.equal(result.rawText, ' 22.00 \nMRP: ')
  assert.equal(result.transcript, 'MRP:   22.00 ')
  assert.equal(result.associations.length, 1)
  assert.deepEqual(result.rows[0].sourceIds, ['heading', 'value'])
  assert.deepEqual(result.rows[0].sourceBoxes, [inputs[1].box, inputs[0].box])
  assert.deepEqual(result.rows[0].parts.map(part => part.text), ['MRP: ', ' 22.00 '])
})

test('numeric, unit and header errors are never corrected or invented', () => {
  const result = associateSpatialOcrRows([line('a', 'NET QTY'), line('b', '500mr', 100), line('c', 'MEP:', 10, 100), line('d', '22.00', 100, 100)])
  assert.ok(result.transcript.includes('NET QTY 500mr'))
  assert.ok(result.transcript.includes('MEP:\n22.00'))
  assert.equal(extractDeclarations(result.transcript).byId.netQuantity.validation.status, 'invalid')
  assert.equal(extractDeclarations(result.transcript).byId.mrp.candidates.length, 0)
})

test('stacked values do not get promoted to same-row declarations', () => {
  const result = associateSpatialOcrRows([line('h', 'NET CONTENT:'), line('v', '500 ml', 10, 40)])
  assert.equal(result.associations.length, 0)
  assert.equal(result.transcript, 'NET CONTENT:\n500 ml')
})

test('generic thresholds support mild common skew but reject large or mismatched skew', () => {
  const pair = [line('h', 'MRP:'), line('v', '22.00', 100)]
  assert.equal(associateSpatialOcrRows(pair.map(item => rotate(item, 7))).associations.length, 1)
  assert.equal(associateSpatialOcrRows(pair.map(item => rotate(item, 20))).associations.length, 0)
  assert.equal(associateSpatialOcrRows([rotate(pair[0], 0), rotate(pair[1], 10)]).associations.length, 0)
})

test('ninety-degree rotations and tall vertical words are left untouched', () => {
  const rotated = [line('h', 'MRP:'), line('v', '22.00', 100)].map(item => rotate(item, 90))
  assert.equal(associateSpatialOcrRows(rotated).associations.length, 0)
  assert.equal(associateSpatialOcrRows([line('h', 'MRP:', 10, 10, 20, 80), line('v', '22.00', 100)]).associations.length, 0)
})

test('two parallel candidate values are ambiguous instead of picking the closest', () => {
  const result = associateSpatialOcrRows([line('h', 'MRP:'), line('v1', '22.00', 100), line('v2', '40.00', 180)])
  assert.equal(result.associations.length, 0)
  assert.equal(result.abstentions[0].reason, 'multiple_aligned_value_candidates')
})

test('intervening column headings or words block a distant numeric association', () => {
  const result = associateSpatialOcrRows([line('h', 'MRP:', 10), line('middle', 'RATE', 75), line('value', '22.00', 140)])
  assert.equal(result.associations.length, 0)
  assert.equal(result.abstentions[0].reason, 'intervening_text_or_column_boundary')
})

test('multiple headings in one box are not split or reassigned', () => {
  const result = associateSpatialOcrRows([line('h', 'MRP ₹ - USP ₹:', 10), line('v', '90.00 USP RS 0.18/g', 100)])
  assert.equal(result.associations.length, 0)
  assert.ok(result.abstentions.some(item => item.reason === 'multiple_declaration_headings_in_one_box'))
})

test('conflicting separate rows are preserved so the real parser still abstains', () => {
  const result = associateSpatialOcrRows([line('h1', 'MRP:'), line('v1', '22.00', 100), line('h2', 'MRP:', 10, 70), line('v2', '40.00', 100, 70)])
  assert.equal(result.associations.length, 2)
  const parsed = extractDeclarations(result.transcript)
  assert.equal(parsed.byId.mrp.conflict, true)
  assert.equal(parsed.byId.mrp.candidates.length, 2)
})

test('use-by semantics stay use-by, and already complete declarations are not extended', () => {
  const result = associateSpatialOcrRows([line('h1', 'USE BY:'), line('v1', '19/10/25', 100), line('h2', 'MRP:22.00', 10, 70), line('v2', '40.00', 100, 70)])
  assert.equal(result.associations.length, 1)
  assert.equal(extractDeclarations(result.transcript).byId.packDate.candidates.length, 0)
  assert.equal(extractDeclarations(result.transcript).byId.mrp.value, '22.00')
})

test('different panels never connect and all input lines appear exactly once in mappings', () => {
  const inputs = [line('h', 'MRP:', 10, 10, 50, 20, { panelId: 'front' }), line('v', '22.00', 100, 10, 50, 20, { panelId: 'back' }), line('other', 'UNCHANGED')]
  const result = associateSpatialOcrRows(inputs)
  assert.equal(result.associations.length, 0)
  assert.deepEqual(result.rows.flatMap(row => row.sourceIds).sort(), inputs.map(item => item.id).sort())
  assert.deepEqual(result.rawLines.map(item => item.text), inputs.map(item => item.text))
})

test('invalid and unbounded geometry/text are rejected without coercion', () => {
  assert.throws(() => associateSpatialOcrRows(null), /array/)
  assert.throws(() => associateSpatialOcrRows(Array(1)), /dense/)
  assert.throws(() => associateSpatialOcrRows([line('a', 'MRP\n22')]), /single-line/)
  assert.throws(() => associateSpatialOcrRows([line('a', 'MRP'), line('a', '22', 100)]), /unique/)
  assert.throws(() => associateSpatialOcrRows([{ ...line('a', 'MRP'), box: [[0, 0], [1, 1], [0, 1], [1, 0]] }]), /convex/)
  assert.throws(() => associateSpatialOcrRows([{ ...line('a', 'MRP'), confidence: 99 }]), /between 0 and 1/)
  assert.throws(() => associateSpatialOcrRows([{ ...line('a', 'MRP'), box: [[0, 0], [Infinity, 0], [1, 1], [0, 1]] }]), /finite/)
})

test('RapidOCR adapter keeps parallel-array indices and rejects malformed arrays', () => {
  const metadata = { texts: ['MRP:', '22.00'], boxes: [box(10, 10, 50, 20), box(100, 10, 50, 20)], confidences: [0.9, 0.8] }
  const lines = rapidOcrLines(metadata, { panelId: 'CF-001' })
  assert.equal(lines[1].id, 'CF-001:line-2')
  assert.deepEqual(lines[1].box, metadata.boxes[1])
  assert.equal(associateSpatialOcrRows(lines).associations.length, 1)
  assert.throws(() => rapidOcrLines({ ...metadata, confidences: [0.9] }), /equal-length/)
})
