import test from 'node:test'
import assert from 'node:assert/strict'
import { planPaddleFocus } from '../src/lib/ocrFocusGuidance.mjs'
import { reviewableStackedDeclarationProposals } from '../src/lib/spatialOcr.mjs'
import { parseLabelNumbers, parsePackingDates } from '../src/lib/labelParser.mjs'

const line = (id, text, x, y, w, h, angle = 0) => {
  const a = angle * Math.PI / 180
  const point = (dx, dy) => [x + dx * Math.cos(a) - dy * Math.sin(a), y + dx * Math.sin(a) + dy * Math.cos(a)]
  return { id, panelId: 'p', text, box: [point(0, 0), point(w, 0), point(w, h), point(0, h)] }
}
const frame = lines => ({ id: 'p', imageUrl: 'pixels', width: 1000, height: 800, lines })

test('MFD role conjunction is not a spurious conflicting date; malformed date readings still survive', () => {
  const date = 'PKD:23/11/25'
  const result = parsePackingDates(`CONTACT AT MFD &\nMARKETED BY ADDRESS\n${date}`)
  assert.equal(result.length, 1); assert.equal(result[0].value, '23/11/25'); assert.equal(result[0].valid, true)
  for (const text of ['MFD:', 'MFD: 23/11/2', 'MFD: &23/11/25', 'MFD: 2O/11/25']) {
    const observations = parsePackingDates(`${text}\n${date}`)
    assert.equal(observations.length, 2); assert.equal(observations[0].valid, false)
  }
  assert.deepEqual(parsePackingDates('MFD &'), [])
})

test('compact MRP stamps accept actual digits without repairing tokens or matching embedded words', () => {
  for (const text of ['MRP48', 'BATCH77/MRP48', 'M.R.P48', 'MRP₹48']) {
    const result = parseLabelNumbers(text).mrp
    assert.equal(result.length, 1)
    assert.equal(result[0].value, '48'); assert.equal(result[0].valid, true)
    assert.equal(result[0].evidence, text)
  }
  for (const text of ['MRPENDING48', 'BATCHMRP48', 'XMRP48']) assert.equal(parseLabelNumbers(text).mrp.length, 0)
  for (const text of ['MRP4O', 'MRP48.999', 'MRP0', 'MRP-48']) assert.equal(parseLabelNumbers(text).mrp[0].valid, false)
})

test('literal script-litre glyph is a unit spelling, not permission to repair numeral/letter confusions', () => {
  for (const text of ['NET QTY: 2 ℓ', 'NET QUANTITY:\n2ℓ', 'NET QTY: 2 LITRES']) {
    const quantity = parseLabelNumbers(text).netQuantity[0]
    assert.equal(quantity.value, '2 l'); assert.equal(quantity.valid, true)
    assert.equal(quantity.evidence, text)
  }
  for (const text of ['NET QTY: 2 I', 'NET QTY: 2 1', 'NET QTY: 2 ℓfoo', 'NET QTY: 2 Lfoo', 'NET QTY: 2 ml/kg']) assert.equal(parseLabelNumbers(text).netQuantity[0].valid, false)
})

test('retry for an entirely undetected right-hand value includes bounded search context', () => {
  const result = planPaddleFocus(frame([line('h', 'NET QUANTITY:', 100, 100, 180, 25)]))
  assert.equal(result.suggestions.length, 1)
  assert.ok(result.suggestions[0].rect.x1 >= 480 / 1000)
  assert.deepEqual(result.suggestions[0].contextLineIds, [])
  assert.equal('value' in result.suggestions[0], false)
})

test('sloping row uses baseline geometry to retain the whole adjacent value in a retry crop', () => {
  const heading = line('h', 'NET QUANTITY:', 200, 450, 190, 40, -12)
  const value = line('v', '2Litre', 395, 408, 120, 40, -12)
  const result = planPaddleFocus(frame([heading, value]))
  const rect = result.suggestions[0].rect
  assert.deepEqual(result.suggestions[0].contextLineIds, ['v'])
  for (const [x, y] of value.box) assert.ok(x >= rect.x0 * 1000 && x <= rect.x1 * 1000 && y >= rect.y0 * 800 && y <= rect.y1 * 800)
})

test('larger centered net quantity under a mildly curved heading stays a reviewable exact-token proposal', () => {
  const input = [line('h', 'NET QUANTITY:', 200, 250, 180, 30, -8), line('v', '2l', 235, 310, 80, 100)]
  const original = structuredClone(input)
  const result = reviewableStackedDeclarationProposals(input)
  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposals[0].text, 'NET QUANTITY: 2l')
  assert.equal(result.proposals[0].eligibleForAutomaticVerdict, false)
  assert.deepEqual(input, original)
})

test('large-quantity allowance does not relax date or price geometry', () => {
  for (const [heading, value] of [['MRP:', '60.00'], ['PACKED ON:', '03/09/2026']]) {
    const input = [line('h', heading, 200, 250, 180, 30, -8), line('v', value, 235, 310, 80, 100)]
    assert.equal(reviewableStackedDeclarationProposals(input).proposals.length, 0)
  }
})

test('large quantity must still be bounded and uncontested, never reconstructed from damaged units', () => {
  const h = line('h', 'NET QUANTITY:', 200, 250, 180, 30, -8)
  for (const extras of [
    [line('v', '2I', 235, 310, 80, 100)],
    [line('v', '2l', 235, 310, 80, 150)],
    [line('v', '2l', 235, 310, 80, 100), line('other', 'NET QTY: 3l', 500, 500, 180, 30)],
    [line('v', '2l', 235, 310, 80, 100), line('blocker', 'SERVING SIZE:', 230, 290, 120, 15)],
    [line('v', '2l', 235, 310, 80, 100), line('v2', '3l', 320, 310, 80, 100)],
  ]) assert.equal(reviewableStackedDeclarationProposals([h, ...extras]).proposals.length, 0)
})
