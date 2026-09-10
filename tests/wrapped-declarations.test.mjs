import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { applyContextAutofill } from '../src/lib/inspectionAutofill.mjs'

test('literal wrapped name, origin, manufacturer and expiry fill from adjacent OCR lines', () => {
  const text = 'COMMON NAME:\nTurmeric powder\nCOUNTRY OF ORIGIN:\nIndia\nMANUFACTURED BY:\nExample Foods Pvt Ltd\n12 Market Road, Chennai 600001\nCONSUMER CARE: care@example.in\nBEST BEFORE:\n6 MONTHS FROM PACKING'
  const parsed = extractDeclarations(text)
  assert.equal(parsed.byId.productName.value, 'Turmeric powder')
  assert.equal(parsed.byId.countryOrigin.value, 'India')
  assert.match(parsed.byId.responsibleEntity.value, /Example Foods.*12 Market Road/)
  assert.doesNotMatch(parsed.byId.responsibleEntity.value, /CONSUMER CARE/)
  assert.equal(parsed.byId.bestBefore.value, '6 MONTHS FROM PACKING')
  assert.equal(parsed.raw, text, 'raw characters are unchanged')
  assert.equal(applyContextAutofill({ productName: '' }, parsed).productName, 'Turmeric powder')
})
test('empty headings cannot consume other declarations, uncaptured panels, or gaps', () => {
  for (const divider of ['\nMRP Rs 40', '\n[PANEL 2]\nOther product', '\n\nOther product']) {
    for (const [heading, id] of [['COMMON NAME:', 'productName'], ['COUNTRY OF ORIGIN:', 'countryOrigin'], ['MANUFACTURED BY:', 'responsibleEntity'], ['BEST BEFORE:', 'bestBefore']]) {
      const field = extractDeclarations(heading + divider).byId[id]
      assert.equal(field.value, '', `${heading} ${divider}`)
      assert.equal(field.validation.status, 'invalid')
    }
  }
})
test('wrapped declaration values are bounded and placeholder text is not promoted', () => {
  assert.equal(extractDeclarations('COMMON NAME:\n' + 'A'.repeat(301)).byId.productName.value, '')
  assert.equal(extractDeclarations('COUNTRY OF ORIGIN:\nUNKNOWN').byId.countryOrigin.value, '')
  assert.equal(extractDeclarations('COMMON NAME:\n500ml').byId.productName.value, '')
  assert.equal(extractDeclarations('COMMON NAME:\n24 pieces').byId.productName.value, '')
})
