import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLabelNumbers, parsePackingDates } from '../src/lib/labelParser.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

test('product-title fallback cannot search declaration-only crops for quantities or phone numbers', () => {
  for (const text of ['[PADDLE FOCUSED RAW OCR · PANEL 1]\nNet Content:\n500ml\nMRP:22.00\nlinclusive all taxes', 'CONSUMER CARE\n18001234567\nCall us now', '500ml', '1 litre', '+91 9988776655']) assert.equal(extractDeclarations(text).byId.productName.detected, false, text)
  assert.equal(extractDeclarations('TURMERIC POWDER\nNET QTY 100 g').byId.productName.value, 'TURMERIC POWDER')
  assert.equal(extractDeclarations('MRP40\nCOMMON NAME: TURMERIC POWDER').byId.productName.value, 'TURMERIC POWDER')
})

test('an adjacent standalone quantity line retains original evidence without repairing OCR', () => {
  for (const text of ['Net Content:\n500ml', 'NET QTY. :\n100 g', 'NET VOLUME:\n1 L']) {
    const values = parseLabelNumbers(text).netQuantity
    assert.equal(values.length, 1)
    assert.equal(values[0].valid, true)
    assert.equal(values[0].evidence, text)
  }
  for (const text of ['NET QTY:\nper serving 20 g', 'NET QTY:\n[Panel 2]\n100 g', 'NET QTY:\nManufacturer address\n100 g', 'NET QTY:\n500m', 'NET QTY:\n5OOml', 'NET QTY:\n100 g + 20 g free', 'NET QTY:\n-5 g']) {
    assert.equal(parseLabelNumbers(text).netQuantity.some(value => value.valid), false, text)
  }
  assert.equal(parsePackingDates('PACKED ON:\n01/08/2027').some(value => value.valid), false, 'Unaligned dates cannot inherit quantity-specific adjacent-line handling')
  const conflict = parseLabelNumbers('NET QTY:\n100 g\nNET QTY:\n200 g').netQuantity
  assert.deepEqual(conflict.map(value => value.quantity), [100, 200])
})

test('literal quantity headings accept printed abbreviation punctuation and volume wording', () => {
  for (const text of ['NET QTY. : 100 g', 'NET WT. : 100 g', 'NET VOLUME: 100 ml', 'Net Vol. 100 ml', 'NET CONTENTS: 100 ml']) {
    const values = parseLabelNumbers(text).netQuantity
    assert.equal(values.length, 1, text)
    assert.equal(values[0].valid, true, text)
    assert.equal(values[0].quantity, 100, text)
    assert.equal(values[0].evidence, text)
  }
})

test('MRP tax qualifier may precede the printed price without changing the original evidence', () => {
  for (const text of ['M.R.P. (Inclusive of all taxes): Rs. 90.00', 'MRP (incl. of all taxes) ₹ 90.00', 'MRP Rs. 90.00 (Inclusive of all taxes)']) {
    const values = parseLabelNumbers(text).mrp
    assert.equal(values.length, 1, text)
    assert.equal(values[0].valid, true, text)
    assert.equal(values[0].amount, 90, text)
    assert.equal(values[0].evidence, text)
  }
})

test('MRP parser does not skip arbitrary text, combined headings or ambiguous crossed-out prices', () => {
  for (const text of ['MRP (discount 30) 90.00', 'MRP/USP: 90.00 / 0.18/g', 'MRP old 90 new 80', 'MRP (inclusive of all taxes) -90', 'MRP (inclusive of all taxes) 22O.00']) {
    assert.equal(parseLabelNumbers(text).mrp.some(value => value.valid), false, text)
  }
})

test('packing abbreviation punctuation preserves real calendar validation', () => {
  for (const text of ['MFG. DATE: 08/2026', 'PKD. ON: 02/08/2026', 'MFD.: 08/2026']) {
    const values = parsePackingDates(text)
    assert.equal(values.length, 1, text)
    assert.equal(values[0].valid, true, text)
    assert.equal(values[0].year, 2026, text)
  }
  assert.equal(parsePackingDates('PKD. ON: 31/02/2026')[0].valid, false)
  assert.deepEqual(parsePackingDates('Pkd. by: EXAMPLE FOODS\nMfd. by: ANOTHER COMPANY'), [])
})

test('generic contents in handling instructions are not quantity headings', () => {
  for (const text of ['TRANSFER CONTENTS TO AN AIRTIGHT CONTAINER', 'Shake contents well', 'Ingredients: contains milk', 'CONTENTS MAY SETTLE']) {
    assert.deepEqual(parseLabelNumbers(text).netQuantity, [], text)
  }
  assert.equal(parseLabelNumbers('CONTENTS: 100 g').netQuantity[0].valid, true)
})
