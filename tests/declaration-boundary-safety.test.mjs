import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { collectPaddleLayoutProposals } from '../src/lib/paddleLayoutProposals.mjs'

const rejected = (field, text) => {
  const result = extractDeclarations(text).byId[field]
  assert.equal(result.candidates.length, 1, text)
  assert.equal(result.candidates[0].valid, false, text)
  assert.equal(result.validation.status, 'invalid', text)
  return result
}

test('a price cannot silently discard an alternate amount, unit denominator or arithmetic suffix', () => {
  for (const suffix of ['/100 g', ' / 80', ' + 10', ' – 80', ' — 80', ' − 80', ' - 80', ' & 80', ' AND Rs. 80', ' OR 80', ' TO 80', ' × 2', ' x 2', ' 80.00']) {
    rejected('mrp', `MRP 40${suffix}`)
  }
})

test('ordinary complete prices retain literal rupee terminators, tax qualifiers and later declaration headings', () => {
  for (const text of ['MRP 40/-', 'MRP Rs. 40/- (inclusive of all taxes)', 'MRP 40.00 inclusive of all taxes', 'MRP40 NET QTY 100 g', 'MRP40; BATCH 123', 'MRP (inclusive of all taxes) ₹40']) {
    assert.equal(extractDeclarations(text).byId.mrp.candidates[0].valid, true, text)
  }
})

test('net quantity cannot discard conjunctions, Unicode ranges or a second unheaded amount', () => {
  for (const suffix of [' & 100 g', ' AND 100 g', ' OR 100 g', ' TO 100 g', ' – 100 g', ' — 100 g', ' − 100 g', ' 100 g']) rejected('netQuantity', `NET QTY 5 g${suffix}`)
  for (const suffix of ['²', 'क', '_gross']) rejected('netQuantity', `NET QTY 5 g${suffix}`)
  for (const text of ['NET QTY 100 g.', 'NET QTY 100 g, MRP Rs. 40', 'NET QTY 100 g (inclusive of packaging)']) assert.equal(extractDeclarations(text).byId.netQuantity.candidates[0].valid, true, text)
})

test('unit-price denominator must not be a prefix of an unsupported unit or expression', () => {
  for (const suffix of ['/100', '²', 'क', '_gross', ' - 0.80/g', ' – 0.80/g', ' & 0.80/g', ' OR Rs. 0.80/g', ' 0.80/g']) rejected('unitSalePrice', `UNIT PRICE Rs. 0.40/g${suffix}`)
  for (const text of ['UNIT PRICE Rs. 0.40/g', 'UNIT PRICE Rs. 0.40/g.', 'UNIT PRICE Rs. 0.40/g, MRP Rs. 40', 'UNIT PRICE Rs. 0.40 / 100 g', 'UNIT PRICE Rs. 0.40/g (inclusive of all taxes)', 'UNIT PRICE Rs. 0.40/g MRP Rs. 40.00']) assert.equal(extractDeclarations(text).byId.unitSalePrice.candidates[0].valid, true, text)
})

test('packing dates do not accept a complete-looking prefix of a compound or non-ASCII token', () => {
  for (const suffix of [' + 09/2026', ' & 09/2026', ' AND 09/2026', ' OR 09/2026', ' TO 09/2026', ' – 09/2026', ' — 09/2026', ' − 09/2026', ' 09/2026', '²', 'क']) rejected('packDate', `PACKED 08/2026${suffix}`)
})

test('complete dates retain ordinary following stamp fields and separate conflicting headings', () => {
  for (const text of ['PACKED 08/2026 BATCH 123', 'PKD 19/10/25 MRP Rs. 40', 'PACKED 05 SEP 2026', 'PACKED SEPT 2026']) assert.equal(extractDeclarations(text).byId.packDate.candidates[0].valid, true, text)
  assert.equal(extractDeclarations('PACKED 08/2026 PACKED 09/2026').byId.packDate.conflict, true)
})

test('review-only layout suggestions also withhold composite value fragments', () => {
  const line = (id, text, x, width) => ({ id, text, box: [[x, 10], [x + width, 10], [x + width, 30], [x, 30]], confidence: 0.99 })
  for (const [heading, value] of [['MRP:', '40 / 80'], ['NET QTY:', '5 g & 100 g'], ['PACKED:', '08/2026 + 09/2026']]) {
    const lines = [line('heading', heading, 10, 90), line('value', value, 120, 210)]
    assert.deepEqual(collectPaddleLayoutProposals([{ id: 'panel', text: lines.map(item => item.text).join('\n'), lines }]).proposals, [], `${heading} ${value}`)
  }
})

test('unsafe readings remain in the candidate history even beside a valid later retry', () => {
  for (const [field, invalid, valid] of [['mrp', 'MRP 40 / 80', 'MRP 80'], ['netQuantity', 'NET QTY 5 g & 100 g', 'NET QTY 100 g'], ['packDate', 'PACKED 08/2026 + 09/2026', 'PACKED 09/2026'], ['unitSalePrice', 'UNIT PRICE Rs. 0.40/g/100', 'UNIT PRICE Rs. 0.40/g']]) {
    const result = extractDeclarations(`${invalid}\n${valid}`).byId[field]
    assert.equal(result.conflict, true, field)
    assert.equal(result.candidates.length, 2, field)
    assert.equal(result.candidates.filter(candidate => candidate.valid).length, 1, field)
    assert.ok(result.candidates.some(candidate => candidate.evidence === invalid), field)
  }
})

test('literal separators before named fields or a complete tax qualifier do not invent ambiguity', () => {
  for (const [field, text] of [
    ['mrp', 'MRP 40 - inclusive of all taxes'], ['mrp', 'MRP 40 & NET QTY 100 g'],
    ['netQuantity', 'NET QTY 100 g & MRP 40'], ['packDate', 'PACKED 08/2026 & MRP 40'],
    ['unitSalePrice', 'UNIT PRICE Rs. 0.40/g - (inclusive of all taxes)'],
  ]) assert.equal(extractDeclarations(text).byId[field].candidates[0].valid, true, text)
  for (const text of ['MRP 40 &', 'MRP 40 -', 'MRP 40 - inclusive of all taxes & 80']) rejected('mrp', text)
})
