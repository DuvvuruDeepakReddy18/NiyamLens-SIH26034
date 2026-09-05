import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateRule3Applicability } from '../src/lib/applicability.mjs'
import { evaluateCompliance } from '../src/lib/rules.mjs'
import { evaluateInspection } from '../src/lib/inspectionSafety.mjs'
import { validateInspectionMetadata } from '../src/lib/inspectionMetadata.mjs'

const confirmed = (patch = {}) => ({
  rule3ConsumerScope: 'retail',
  rule3CommodityClass: 'ordinary',
  rule3ApplicabilityConfirmed: true,
  ...patch,
})

const completeLargeLabel = `
GENERIC NAME: DETERGENT
MRP Rs. 600.00 inclusive of all taxes
NET QTY 30 kg
PACKED 08/2026
MANUFACTURED BY: CLEAN WORKS, 24 Factory Road, Chennai 600001
CONSUMER CARE: CLEAN WORKS HELPDESK
12 Market Road, Chennai 600001
Telephone: 1800 111 2026 · care@example.in
UNIT SALE PRICE Rs. 20.00/kg
`

test('Rule 3 gates an ordinary retail package above 25 kg before declaration checks', () => {
  const result = evaluateCompliance({
    text: completeLargeLabel,
    meta: { ...confirmed(), quantity: 30, unit: 'kg', category: 'general', commodityClass: 'standard', ocrConfidence: 95 },
  })
  assert.equal(result.status, 'exempt')
  assert.equal(result.context.applicability.state, 'outside_chapter_ii')
  assert.equal(result.context.exemption.exempt, false)
  assert.equal(result.checks.find(check => check.id === 'rule3Applicability').status, 'exempt')
  assert.equal(result.checks.some(check => check.id === 'mrp'), false)
  assert.match(result.checks[0].reason, /not certification of compliance with any other law/i)
})

test('Rule 3 mass and special-commodity boundaries abstain conservatively', () => {
  const assess = (quantity, rule3CommodityClass = 'ordinary', text = '') => evaluateRule3Applicability({ quantity, unit: 'kg', text, meta: confirmed({ rule3CommodityClass }) })
  assert.equal(assess(25).state, 'in_scope')
  assert.equal(assess(25.001).state, 'outside_chapter_ii')
  assert.equal(assess(25, 'cement', 'CEMENT').state, 'in_scope')
  assert.equal(assess(25.001, 'cement', 'CEMENT').state, 'review')
  assert.equal(assess(50, 'fertilizer', 'FERTILIZER').state, 'review')
  assert.equal(assess(50.001, 'agricultural_farm_produce', 'AGRICULTURAL FARM PRODUCE').state, 'outside_chapter_ii')
  const volumeSpecial = evaluateRule3Applicability({ quantity: 60, unit: 'l', text: 'CEMENT', meta: confirmed({ rule3CommodityClass: 'cement' }) })
  assert.equal(volumeSpecial.state, 'review')
  assert.equal(volumeSpecial.code, 'rule3-special-non-mass')
})

test('Rule 3 converts gram and millilitre quantities at the 25-unit boundary', () => {
  assert.equal(evaluateRule3Applicability({ quantity: 25000, unit: 'g', meta: confirmed() }).state, 'in_scope')
  assert.equal(evaluateRule3Applicability({ quantity: 25001, unit: 'g', meta: confirmed() }).state, 'outside_chapter_ii')
  assert.equal(evaluateRule3Applicability({ quantity: 25000, unit: 'ml', meta: confirmed() }).state, 'in_scope')
  assert.equal(evaluateRule3Applicability({ quantity: 25001, unit: 'ml', meta: confirmed() }).state, 'outside_chapter_ii')
})

test('industrial and institutional scope requires explicit purchase-context confirmation', () => {
  for (const scope of ['industrial', 'institutional']) {
    assert.equal(evaluateRule3Applicability({ quantity: 1, unit: 'kg', text: 'BUYER: FACTORY', meta: confirmed({ rule3ConsumerScope: scope, rule3ApplicabilityConfirmed: false }) }).state, 'review')
    const outside = evaluateRule3Applicability({ quantity: 1, unit: 'kg', text: 'BUYER: FACTORY', meta: confirmed({ rule3ConsumerScope: scope }) })
    assert.equal(outside.state, 'outside_chapter_ii')
    assert.match(outside.reason, /direct manufacturer purchase/i)
  }
  assert.equal(evaluateRule3Applicability({ quantity: 1, unit: 'kg', text: 'INDUSTRIAL BUYER', meta: { enforceEvidenceReview: true } }).state, 'review')
})

test('large-package label signals cannot be contradicted to obtain a clear Rule 3 result', () => {
  const conflict = evaluateRule3Applicability({ quantity: 30, unit: 'kg', text: 'PORTLAND CEMENT', meta: confirmed({ rule3CommodityClass: 'ordinary' }) })
  assert.equal(conflict.state, 'review')
  assert.equal(conflict.code, 'rule3-classification-conflict')
  const result = evaluateCompliance({ text: completeLargeLabel.replace('DETERGENT', 'PORTLAND CEMENT'), meta: { quantity: 30, unit: 'kg', ocrConfidence: 95, ...confirmed({ rule3CommodityClass: 'ordinary' }) } })
  assert.equal(result.status, 'manual_review')
})

test('unknown large-package class and malformed applicability metadata remain review', () => {
  const unknown = evaluateCompliance({ text: completeLargeLabel, meta: { quantity: 30, unit: 'kg', ocrConfidence: 95 } })
  assert.equal(unknown.status, 'manual_review')
  assert.equal(unknown.context.applicability.code, 'rule3-unconfirmed')
  assert.ok(validateInspectionMetadata({ rule3ConsumerScope: 'retail', rule3CommodityClass: 'bulk', rule3ApplicabilityConfirmed: true }).length)
  assert.ok(validateInspectionMetadata({ rule3ConsumerScope: 'unknown', rule3CommodityClass: 'ordinary', rule3ApplicabilityConfirmed: true }).length)
})

test('food typography measurements remain review pending cross-regime sign-off', () => {
  const result = evaluateInspection({
    text: completeLargeLabel.replace('30 kg', '20 kg').replace('20.00/kg', '30.00/kg') + '\nFSSAI 12345678901234',
    meta: {
      ...confirmed(), category: 'food', commodityClass: 'standard', quantity: 20, unit: 'kg', ocrSource: 'local', ocrConfidence: 95,
      enforceEvidenceReview: true, classificationConfirmed: true, pdpArea: 200, pdpUncertainty: 1,
      referenceMm: 10, referencePx: 100, glyphPx: 10, glyphWidthPx: 5, measurementUncertainty: 1,
      measurementSurface: 'flat', pdpConfirmed: true, measurementConfirmed: true, widthCharacterConfirmed: true,
    },
  })
  for (const check of result.checks.filter(check => /panelArea|fontHeight|fontWidth/.test(check.id))) {
    assert.equal(check.status, 'review')
    assert.match(check.reason, /pending qualified cross-regime review/i)
  }
  assert.equal(result.status, 'manual_review')
})

test('Rule 3 gate preserves Rule 26 small-package and carve-out behavior', () => {
  const small = evaluateCompliance({ text: 'NET QTY 10 g', meta: { quantity: 10, unit: 'g', commodityClass: 'standard', ocrConfidence: 95, ...confirmed() } })
  assert.equal(small.status, 'exempt')
  assert.equal(small.context.exemption.code, 'rule26-small-package')
  for (const commodityClass of ['tobacco', 'pan_masala']) {
    const result = evaluateCompliance({ text: `${commodityClass.replace('_', ' ')}\nNET QTY 8 g`, meta: { quantity: 8, unit: 'g', commodityClass, ocrConfidence: 95, ...confirmed() } })
    assert.equal(result.context.exemption.exempt, false)
    assert.notEqual(result.status, 'exempt')
  }
})

test('scope routing cannot hide conflicting quantities or clear an unreviewed large OCR reading', () => {
  const conflict = evaluateCompliance({ text: 'NET QTY 1 kg', meta: { ...confirmed({ rule3ConsumerScope: 'industrial' }), quantity: 30, unit: 'kg' } })
  assert.equal(conflict.status, 'manual_review')
  assert.equal(conflict.context.applicability.code, 'rule3-quantity-conflict')
  const meta = { ...confirmed(), enforceEvidenceReview: true, quantity: 30, unit: 'kg' }
  const unconfirmed = evaluateInspection({ text: completeLargeLabel, meta })
  assert.equal(unconfirmed.status, 'manual_review')
  assert.equal(unconfirmed.checks.find(check => check.id === 'rule3QuantityEvidence').status, 'review')
  const verified = evaluateInspection({ text: completeLargeLabel, meta: { ...meta, fieldReviews: { netQuantity: { state: 'confirmed', value: '30 kg', reason: 'Read and checked the 30 kg declaration on the physical bag.' } } } })
  assert.equal(verified.status, 'exempt')
})
