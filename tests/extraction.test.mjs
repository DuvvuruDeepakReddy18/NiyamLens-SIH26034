import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDeclarations, normalizeUnit } from '../src/lib/extraction.mjs'

test('normalizes common package units', () => {
  assert.equal(normalizeUnit('GMS'), 'g')
  assert.equal(normalizeUnit('LTR'), 'l')
  assert.equal(normalizeUnit('PCS'), 'pcs')
})

test('extracts structured declarations from an OCR packet', () => {
  const result = extractDeclarations(`ROOT & RAIN TURMERIC POWDER
MRP Rs. 40.00 (inclusive of all taxes)
NET QTY 100 g
PACKED 08/2026
MANUFACTURED BY: ROOT & RAIN FOODS
CONSUMER CARE: care@rootrain.in
Helpline: 1800 000 2026`)
  assert.equal(result.byId.mrp.value, '40.00')
  assert.equal(result.suggestions.quantity, 100)
  assert.equal(result.suggestions.unit, 'g')
  assert.equal(result.byId.email.value, 'care@rootrain.in')
  assert.equal(result.byId.phone.detected, true)
})

test('suggests imported and tobacco contexts without issuing a verdict', () => {
  const result = extractDeclarations('IMPORTED BY: ACME INDIA\nCOUNTRY OF ORIGIN: INDONESIA\nTOBACCO PRODUCT\nNET QTY 8 g')
  assert.equal(result.suggestions.category, 'imported')
  assert.equal(result.suggestions.commodityClass, 'tobacco')
})

test('classifies pan masala before broader tobacco signals', () => {
  const result = extractDeclarations('PAN MASALA WITH TOBACCO\nNET QTY 8 g')
  assert.equal(result.suggestions.commodityClass, 'pan_masala')
})

test('extracts full numeric and month-name packing dates without truncation', () => {
  assert.equal(extractDeclarations('MFD 12.08.2026').byId.packDate.value, '12.08.2026')
  assert.equal(extractDeclarations('PKD AUG 2026').byId.packDate.value, 'AUG 2026')
})
