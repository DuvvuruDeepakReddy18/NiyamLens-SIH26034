import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeOcrPassTexts } from '../src/lib/vision.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

test('OCR merging retains short literal quantities and prices instead of classifying them as noise', () => {
  for (const value of ['1L', '1l', '1ℓ', '5g', '27', '0', '+5', '-5']) {
    assert.equal(mergeOcrPassTexts([value]), value, `The original observation ${value} must remain inspectable`)
  }
})

test('separate heading and short value observations survive merge without invented association', () => {
  const merged = mergeOcrPassTexts(['NET QUANTITY:\n1L\nMRP:\n27'])
  assert.equal(merged, 'NET QUANTITY:\n1L\nMRP:\n27')
  const extraction = extractDeclarations('1L\n27')
  assert.notEqual(extraction.byId.netQuantity.validation?.status, 'format_valid')
  assert.notEqual(extraction.byId.mrp.validation?.status, 'format_valid')
})

test('short conflicting or damaged numeric observations remain literal and are not reconciled', () => {
  const observations = ['27', '28', '1L', '1g', '-5', '5', '5?', '?5', '1I']
  assert.equal(mergeOcrPassTexts(observations), observations.join('\n'))
  assert.equal(mergeOcrPassTexts(['1L', '1L', '27', '27']), '1L\n27')
})

test('fuzzy deduplication cannot replace damaged numeric declarations with cleaner readings', () => {
  const observations = ['MRP Rs. 50?', 'MRP Rs. 50', 'NET QUANTITY 1ℓ', 'NET QUANTITY 1L', 'MFD: 20/11/25?', 'MFD: 20/11/25']
  assert.equal(mergeOcrPassTexts(observations), observations.join('\n'))
})

test('retaining numeric fragments does not turn ordinary short alphabetic noise into evidence', () => {
  assert.equal(mergeOcrPassTexts(['Il\nzm rer\n?\n1L']), '1L')
})
