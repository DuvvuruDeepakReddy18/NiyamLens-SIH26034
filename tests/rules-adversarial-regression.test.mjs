import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { evaluateCompliance, isSmallPack } from '../src/lib/rules.mjs'
import { evaluateInspection, fieldCandidates } from '../src/lib/inspectionSafety.mjs'
import { validateInspectionMetadata } from '../src/lib/inspectionMetadata.mjs'
import { findBoundedEmail } from '../src/lib/labelParser.mjs'
import { PLACEMENT_FIELDS } from '../src/lib/placement.mjs'

const blocks = ['COMMON NAME: PAPER', 'MRP Rs. 40.00 inclusive of all taxes', 'NET QTY 100 g', 'PACKED 08/2026', 'MANUFACTURED BY: PAPER WORKS, 24 Factory Road, Chennai 600001', 'CONSUMER CARE: PAPER WORKS HELPDESK\n12 Market Road, Chennai 600001\nTelephone: 1800 111 2026 · care@example.in', 'UNIT SALE PRICE Rs. 0.40/g']
const complete = blocks.join('\n')
const verifiedMeta = (text, patch = {}) => {
  const e = extractDeclarations(text)
  return { ...e.suggestions, pdpArea: 75, pdpUncertainty: 2, referenceMm: 20, referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5, measurementUncertainty: 3, ocrConfidence: 95, enforceEvidenceReview: true, classificationConfirmed: true, allPanelsCaptured: true, pdpConfirmed: true, measurementConfirmed: true, widthCharacterConfirmed: true, measurementSurface: 'flat', fieldReviews: Object.fromEntries(e.fields.filter(f => f.detected).map(f => [f.id, { state: 'confirmed', value: f.value, reason: 'Exact transcription of synthetic package declaration.' }])), ...patch }
}
const inspect = (text = complete, patch = {}) => evaluateInspection({ text, meta: verifiedMeta(text, patch) })
const noClear = result => assert.ok(!['compliant', 'exempt'].includes(result.status), JSON.stringify(result))

test('a complete semantically valid confirmed baseline still passes', () => assert.equal(inspect().status, 'compliant'))
test('canonical money parses Indian and international thousands grouping without truncation', () => {
  for (const [printed, expected] of [['1,000.00', '1000.00'], ['1,00,000.00', '100000.00'], ['100.50', '100.50']]) assert.equal(extractDeclarations(`MRP Rs. ${printed}`).byId.mrp.value, expected)
})
test('invalid money sign, precision and malformed grouping remain invalid rather than positive prices', () => {
  for (const value of ['-40.00', '+40.00', '40.999', '1,00.00', '0', '1.', '1e6', '100abc', '.50']) {
    const extraction = extractDeclarations(`MRP Rs. ${value}`)
    assert.equal(extraction.byId.mrp.validation.status, 'invalid', value)
    noClear(inspect(complete.replace('MRP Rs. 40.00', `MRP Rs. ${value}`)))
  }
})
test('a leading decimal point cannot be stripped into a different positive amount', () => {
  assert.equal(extractDeclarations('MRP .50').byId.mrp.validation.status, 'invalid')
  assert.equal(extractDeclarations('NET QTY .5 g').byId.netQuantity.validation.status, 'invalid')
})
test('ambiguous slash/range/composite quantities are not silently reduced to a first amount', () => {
  for (const value of ['100 g/200 g', '100 g / 200 g', '100 g - 200 g', '5 g + 100 g']) {
    assert.equal(extractDeclarations(`NET QTY ${value}`).byId.netQuantity.validation.status, 'invalid')
    noClear(inspect(`NET QTY ${value}`))
  }
})
test('distinct same-transcript quantity and price candidates cannot be resolved by confirming only the first', () => {
  for (const text of ['NET QTY 5 g\nNET QTY 100 g', 'NET QTY 100 g\nNET QTY 5 g', complete + '\nMRP Rs. 100.00']) {
    noClear(inspect(text))
    const extraction = extractDeclarations(text)
    assert.ok(Object.keys(extraction.conflicts).length)
    const field = text.includes('MRP') ? 'mrp' : 'netQuantity'
    assert.equal(fieldCandidates([{ id: 'one', text }])[field].length, 2)
  }
})
test('identical duplicated readings collapse without manufacturing a conflict', () => {
  const extraction = extractDeclarations('NET QTY 100 g\nNET QTY 100 GMS\nMRP Rs. 40\nMRP Rs. 40.00')
  assert.equal(extraction.candidates.netQuantity.length, 1)
  assert.equal(extraction.candidates.mrp.length, 1)
})
test('zero, negative, nonfinite and underflow quantity cannot establish exemption', () => {
  for (const value of [0, -1, -0, NaN, Infinity, -Infinity]) assert.equal(isSmallPack(value, 'g'), false)
  for (const text of ['NET QTY 0 g', 'NET QTY 0 kg', 'NET QTY -1 g', `NET QTY 0.${'0'.repeat(330)}1 g`]) noClear(inspect(text))
})
test('unknown commodity enum and contradictory tobacco/imported classification cannot bypass scope', () => {
  noClear(inspect('TOBACCO PRODUCT\nNET QTY 8 g', { commodityClass: 'typo_tobacco' }))
  noClear(inspect('TOBACCO PRODUCT\nNET QTY 8 g', { commodityClass: 'standard' }))
  noClear(inspect(`${complete}\nIMPORTED BY: PAPER IMPORTS`, { category: 'general' }))
})
test('calendar-invalid dates remain review even with exact transcription confirmation', () => {
  for (const date of ['31/02/2026', '29/02/2025', '32/08/2026', '12/13/2026', '00/01/2026']) {
    const result = inspect(complete.replace('08/2026', date))
    assert.equal(result.checks.find(c => c.id === 'packDate').status, 'review', date)
    noClear(result)
  }
  assert.equal(inspect(complete.replace('08/2026', '29/02/2024')).status, 'compliant')
})
test('month prefixes cannot turn invented month names into valid dates', () => {
  for (const date of ['JANgarbage 2026', 'FEBxyz 2026', 'SEPTwrong 2026']) {
    assert.equal(extractDeclarations(`PACKED ${date}`).byId.packDate.validation.status, 'invalid')
    noClear(inspect(complete.replace('08/2026', date)))
  }
})
test('date and USP conflicts on the same line retain every heading candidate', () => {
  const date = 'PACKED 08/2026 PACKED 09/2026'
  const usp = 'UNIT SALE PRICE Rs. 0.40 / g UNIT SALE PRICE Rs. 9.99 / g'
  assert.equal(extractDeclarations(date).candidates.packDate.length, 2)
  assert.equal(extractDeclarations(usp).candidates.unitSalePrice.length, 2)
  noClear(inspect(complete.replace('PACKED 08/2026', date)))
  noClear(inspect(complete.replace(blocks[6], usp)))
})
test('manufacturer heading/name without a distinguishable address never gets compliance pass', () => {
  for (const replacement of ['MANUFACTURED BY:', 'MANUFACTURED BY: PAPER WORKS', 'MANUFACTURED BY: UNKNOWN']) {
    const result = inspect(complete.replace(blocks[4], replacement))
    assert.equal(result.checks.find(c => c.id === 'manufacturer').status, 'review')
  }
})
test('unit-price heading, arithmetic disagreement and denominator mismatch remain review', () => {
  for (const replacement of ['UNIT SALE PRICE', 'UNIT SALE PRICE Rs. 99.00/g', 'UNIT SALE PRICE Rs. 0.40/kg']) {
    const result = inspect(complete.replace(blocks[6], replacement))
    assert.equal(result.checks.find(c => c.id === 'unitSalePrice').status, 'review')
  }
})
test('unknown origins and empty headings abstain while a recognized country passes presence validation', () => {
  for (const country of ['', 'UNKNOWN', 'Atlantis', 'N/A']) noClear(inspect(`${complete}\nCOUNTRY OF ORIGIN: ${country}`, { category: 'imported' }))
  assert.equal(inspect(`${complete}\nCOUNTRY OF ORIGIN: INDONESIA`, { category: 'imported' }).status, 'compliant')
})
test('punctuated MRP and unit spellings use the same canonical grammar in both engines', () => {
  assert.equal(inspect(complete.replace('MRP', 'M.R.P.')).status, 'compliant')
  assert.equal(inspect(complete.replace('100 g', '100 GRAMS')).status, 'compliant')
  assert.equal(inspect(complete.replace('100 g', '100 PIECES').replace('0.40/g', '0.40/unit')).status, 'compliant')
})
test('malformed metadata produces structured manual-review results without exceptions', () => {
  const patches = [{ referencePx: -100, glyphPx: -9, glyphWidthPx: -3.5 }, { pdpArea: 1e308, pdpUncertainty: 1e308 }, { measurementUncertainty: NaN }, { pdpUncertainty: 'Infinity' }, { measurementConfirmed: 'false' }, { fieldReviews: { mrp: { state: 'confirmed', value: '40.00', reason: 17 } } }, { panelMeasurements: { front: { glyphPx: -10 } } }]
  for (const patch of patches) {
    assert.ok(validateInspectionMetadata(verifiedMeta(complete, patch)).length)
    assert.doesNotThrow(() => noClear(inspect(complete, patch)))
  }
})
test('unknown OCR, missing capture and unknown package classification remain review', () => {
  for (const patch of [{ ocrConfidence: null }, { ocrSource: 'none' }, { evidencePanelIds: [] }, { classificationConfirmed: false }, { measurementUncertainty: null }, { pdpUncertainty: null }]) noClear(inspect(complete, patch))
})
test('drug and multi-pack applicability never self-certifies specialist rules', () => {
  noClear(inspect('NET QTY 100 g', { commodityClass: 'drug_formulation' }))
  noClear(inspect(`${complete}\nCOMBINATION PACKAGE`))
})
test('USP equal-to-MRP proviso is represented without falsely flagging a missing USP', () => {
  const text = complete.replace('100 g', '1 pcs').replace(blocks[6], '')
  const result = inspect(text)
  assert.equal(result.checks.find(c => c.id === 'unitSalePrice').status, 'info')
  assert.equal(result.status, 'compliant')
})
test('equal-price USP proviso also removes an inapplicable placement requirement', () => {
  const text = complete.replace('100 g', '1 pcs').replace(blocks[6], '')
  const extraction = extractDeclarations(text)
  const result = inspect(text, {
    evidencePanelIds: ['front'], panelMeasurements: { front: { referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5 } },
    placementScope: 'general_flat', placementPdpConfirmed: true,
    placementReviews: Object.fromEntries(PLACEMENT_FIELDS.filter(id => id !== 'unitSalePrice').map(id => [id, { state: 'inside_pdp', panelId: 'front', value: extraction.byId[id].value, reason: 'Observed on the same confirmed physical PDP.' }])),
    quantitySpacing: { confirmed: true, panelId: 'front', value: '1 pcs', reason: 'Measured all four gaps on the original physical label.', numeralHeightPx: 10, abovePx: 15, belowPx: 15, leftPx: 30, rightPx: 30, uncertaintyPercent: 5 },
  })
  assert.equal(result.status, 'compliant')
  assert.equal(result.checks.some(c => c.id === 'placement:unitSalePrice'), false)
})
test('width-ratio boundary uncertainty is reviewed even when nominal width equals one third', () => {
  const result = inspect(complete, { glyphWidthPx: 3, glyphPx: 9, measurementUncertainty: 3 })
  assert.equal(result.checks.find(c => c.id === 'fontWidth').status, 'review')
})
test('food and cosmetics date profiles are not certified by generic date presence', () => {
  const food = inspect(`${complete}\nFSSAI Lic. 10012002300045`, { category: 'food' })
  assert.equal(food.checks.find(c => c.id === 'packDate').status, 'review')
  assert.equal(food.checks.find(c => c.id === 'manufacturer').status, 'review')
  const cosmetic = inspect(complete.replace('COMMON NAME: PAPER', 'COMMON NAME: SHAMPOO'))
  assert.equal(cosmetic.checks.find(c => c.id === 'packDate').status, 'review')
})
test('bounded email scanner rejects long malformed tokens without suffix recovery', () => {
  assert.equal(findBoundedEmail('care@example.in').value, 'care@example.in')
  for (const text of ['a'.repeat(99000) + '@x.in', 'a@' + 'a'.repeat(99000) + '.in', 'a'.repeat(99000), 'care..team@example.in']) assert.equal(findBoundedEmail(text).found, false)
  const text = 'a'.repeat(99000) + '@x.in\ncare@example.in'
  assert.equal(findBoundedEmail(text).value, 'care@example.in')
  const start = performance.now()
  extractDeclarations(text)
  evaluateCompliance({ text, meta: {} })
  assert.ok(performance.now() - start < 3000, 'Bounded malformed email input must not take seconds of regex backtracking.')
})
test('deterministic 10000-case malformed-input sweep never clears or throws', () => {
  let seed = 26034
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const keys = ['pdpArea', 'referenceMm', 'referencePx', 'glyphPx', 'glyphWidthPx', 'measurementUncertainty', 'pdpUncertainty']
  for (let i = 0; i < 10000; i++) {
    const key = keys[i % keys.length]
    const value = [-1 - random() * 1000, NaN, Infinity, -Infinity, 'Infinity', 'invalid', {}, []][i % 8]
    const result = inspect(complete, { [key]: value })
    assert.equal(result.status, 'manual_review', `${i}:${key}`)
    assert.ok(result.checks.some(c => c.id.startsWith('invalidInput:')))
  }
})
test('100 deterministic valid declaration block permutations preserve a clear result', () => {
  for (let i = 0; i < 100; i++) {
    const k = i % blocks.length
    const permuted = [...blocks.slice(k), ...blocks.slice(0, k)]
    if (i % 2) permuted.reverse()
    assert.equal(inspect(permuted.join('\n')).status, 'compliant')
  }
})
