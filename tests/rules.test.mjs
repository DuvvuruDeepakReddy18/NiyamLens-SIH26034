import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateCompliance, getFontRequirement, isSmallPack } from '../src/lib/rules.mjs'

const baseMeta = {
  category: 'general',
  quantity: 100,
  unit: 'g',
  pdpArea: 75,
  pdpUncertainty: 2,
  referenceMm: 20,
  referencePx: 100,
  glyphPx: 9,
  glyphWidthPx: 3.5,
  measurementUncertainty: 3,
  ocrConfidence: 95,
}

const completeText = `
GENERIC NAME: TEST PRODUCT
MRP Rs. 40.00 inclusive of all taxes
NET QTY 100 g
PACKED 08/2026
MANUFACTURED BY: EXAMPLE FOODS, CHENNAI
CONSUMER CARE: EXAMPLE FOODS HELPDESK
12 Market Road, Chennai 600001
Telephone: 1800 111 2026 · care@example.in
UNIT SALE PRICE Rs. 0.40/g
`

test('maps principal display panel area to the Table-I tier', () => {
  assert.equal(getFontRequirement(49, false).minimum, 1)
  assert.equal(getFontRequirement(75, false).minimum, 1.5)
  assert.equal(getFontRequirement(300, true).minimum, 4)
  assert.equal(getFontRequirement(3000, false).minimum, 6)
})

test('detects small packs in grams and millilitres', () => {
  assert.equal(isSmallPack(8, 'ml'), true)
  assert.equal(isSmallPack(10, 'g'), true)
  assert.equal(isSmallPack(11, 'g'), false)
})

test('returns compliant when declarations and geometry pass', () => {
  const result = evaluateCompliance({ text: completeText, meta: baseMeta })
  assert.equal(result.status, 'compliant')
  assert.equal(result.counts.fail, 0)
})

test('flags a missing required declaration at high OCR confidence', () => {
  const result = evaluateCompliance({
    text: completeText.replace(/CONSUMER CARE:[\s\S]*?care@example\.in\n/, ''),
    meta: baseMeta,
  })
  assert.equal(result.status, 'non_compliant')
  assert.equal(result.checks.find((check) => check.id === 'consumerCare').status, 'fail')
})

test('accepts an inspector-verified generic name when OCR misses it', () => {
  const result = evaluateCompliance({
    text: completeText.replace('GENERIC NAME: TEST PRODUCT', ''),
    meta: { ...baseMeta, productName: 'Test product' },
  })
  assert.equal(result.checks.find((check) => check.id === 'genericName').status, 'pass')
})

test('abstains instead of failing missing text when OCR confidence is low', () => {
  const result = evaluateCompliance({ text: 'MRP Rs. 20.00', meta: { ...baseMeta, ocrConfidence: 50 } })
  assert.equal(result.status, 'manual_review')
  assert.equal(result.checks.find((check) => check.id === 'consumerCare').status, 'review')
})

test('applies the Rule 26 exemption to an eligible small package', () => {
  const result = evaluateCompliance({
    text: completeText.replace('UNIT SALE PRICE Rs. 0.40/g', ''),
    meta: { ...baseMeta, quantity: 8, unit: 'g' },
  })
  assert.equal(result.context.exemption.exempt, true)
  assert.equal(result.status, 'exempt')
  assert.equal(result.checks.find((check) => check.id === 'rule26Exemption').status, 'exempt')
  assert.equal(result.checks.some((check) => check.id === 'unitSalePrice'), false)
})

test('does not apply the small-package exemption to tobacco products', () => {
  const result = evaluateCompliance({
    text: completeText,
    meta: { ...baseMeta, quantity: 8, unit: 'g', commodityClass: 'tobacco' },
  })
  assert.equal(result.context.exemption.exempt, false)
  assert.equal(result.status, 'compliant')
  assert.equal(result.checks.find((check) => check.id === 'tobaccoApplicability').status, 'info')
})

test('requires phone and address in addition to consumer-care email', () => {
  const emailOnly = completeText
    .replace('CONSUMER CARE: EXAMPLE FOODS HELPDESK\n12 Market Road, Chennai 600001\nTelephone: 1800 111 2026 · care@example.in', 'CONSUMER CARE: care@example.in')
  const result = evaluateCompliance({ text: emailOnly, meta: baseMeta })
  assert.equal(result.status, 'non_compliant')
  assert.equal(result.checks.find((check) => check.id === 'consumerAddress').status, 'fail')
  assert.equal(result.checks.find((check) => check.id === 'consumerPhone').status, 'fail')
})

test('accepts full numeric and month-name packing dates', () => {
  for (const date of ['MFD 12.08.2026', 'PKD AUG 2026']) {
    const result = evaluateCompliance({ text: completeText.replace('PACKED 08/2026', date), meta: baseMeta })
    assert.equal(result.checks.find((check) => check.id === 'packDate').status, 'pass')
  }
})

test('abbreviated inclusive-tax wording requires review', () => {
  const result = evaluateCompliance({ text: completeText.replace('inclusive of all taxes', 'Incl. of all taxes'), meta: baseMeta })
  assert.equal(result.checks.find((check) => check.id === 'mrpFormat').status, 'review')
  assert.equal(result.status, 'manual_review')
})

test('does not apply the small-package exemption to pan masala', () => {
  const result = evaluateCompliance({
    text: 'PAN MASALA\nNET QTY 8 g',
    meta: { ...baseMeta, quantity: 8, unit: 'g', commodityClass: 'pan_masala' },
  })
  assert.equal(result.context.exemption.exempt, false)
  assert.equal(result.status, 'non_compliant')
  assert.equal(result.checks.find((check) => check.id === 'panMasalaCarveout').status, 'info')
})

test('flags font height that is below the requirement even with uncertainty', () => {
  const result = evaluateCompliance({
    text: completeText,
    meta: { ...baseMeta, glyphPx: 6, measurementUncertainty: 5 },
  })
  assert.equal(result.checks.find((check) => check.id === 'fontHeight').status, 'fail')
})

test('never reuses one panel calibration for another evidence plane', () => {
  const result = evaluateCompliance({
    text: completeText,
    meta: {
      ...baseMeta,
      evidencePanelIds: ['front', 'back'],
      panelMeasurements: {
        front: { referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5 },
      },
    },
  })
  assert.equal(result.checks.find((check) => check.id === 'fontHeight:front').status, 'pass')
  assert.equal(result.checks.find((check) => check.id === 'fontHeight:back').status, 'review')
  assert.equal(result.status, 'manual_review')
})

test('medical-device packages defer declarations and typography to specialist rules', () => {
  const result = evaluateCompliance({
    text: completeText,
    meta: { ...baseMeta, category: 'medical', commodityClass: 'medical_device', glyphPx: 1 },
  })
  assert.equal(result.status, 'manual_review')
  assert.equal(result.checks.find((check) => check.id === 'medicalProfile').status, 'review')
  assert.equal(result.checks.some((check) => check.id.startsWith('fontHeight')), false)
  assert.equal(result.checks.some((check) => check.id === 'genericName'), false)
})

test('keeps a blank inspection in manual review instead of treating empty quantity as zero', () => {
  const result = evaluateCompliance({ text: '', meta: { category: 'general', unit: 'g', ocrConfidence: 100 } })
  assert.equal(result.status, 'manual_review')
  assert.equal(result.context.smallPack, false)
  assert.equal(result.checks.find((check) => check.id === 'mrp').status, 'review')
})
