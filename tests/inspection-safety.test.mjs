import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateInspection, fieldCandidates, calibrationSummary } from '../src/lib/inspectionSafety.mjs'
import { appendReview, effectiveStatus } from '../src/lib/caseRecords.mjs'
import { verifyAuditChain } from '../src/lib/audit.mjs'
const meta = { enforceEvidenceReview: true, quantity: 100, unit: 'g', category: 'general', commodityClass: 'standard', rule3ConsumerScope: 'retail', rule3CommodityClass: 'ordinary', rule3ApplicabilityConfirmed: true, ocrConfidence: 100, pdpArea: 75, referenceMm: 20, referencePx: 100, glyphPx: 20, glyphWidthPx: 15, pdpUncertainty: 2, measurementUncertainty: 2 }
const check = (text, change, id) => evaluateInspection({ text, meta: { ...meta, ...change } }).checks.find((item) => item.id === id)
test('high-confidence missing OCR is not proof a physical declaration is absent', () => {
  assert.equal(check('SHAMPOO', {}, 'mrp').status, 'review')
  assert.equal(check('SHAMPOO', { allPanelsCaptured: true, fieldReviews: { mrp: { state: 'absent', reason: 'All package panels inspected; no price printed.' } } }, 'mrp').status, 'fail')
})
test('confirmation is bound to the field value and is invalidated by a changed reading', () => {
  const change = { fieldReviews: { mrp: { state: 'confirmed', value: '40.00', reason: 'Price panel checked' } } }
  assert.equal(check('MRP Rs. 40.00', change, 'mrp').status, 'pass')
  assert.equal(check('MRP Rs. 90.00', change, 'mrp').status, 'review')
})
test('exemption cannot be obtained by supplying a smaller metadata quantity than the actual reading', () => {
  const result = evaluateInspection({ text: 'NET QTY 100 g', meta: { ...meta, quantity: 5, classificationConfirmed: true, fieldReviews: { netQuantity: { state: 'confirmed', value: '100 g', reason: 'Quantity seen on the back' } } } })
  assert.equal(result.status, 'manual_review'); assert.equal(result.context.exemption.exempt, false); assert.ok(result.checks.find((item) => item.id === 'quantityConflict'))
})
test('curved, unknown and unverified measurement planes abstain', () => {
  for (const measurementSurface of ['curved', 'unverified', undefined]) assert.equal(check('', { measurementSurface, pdpConfirmed: true, measurementConfirmed: true }, 'fontHeight').status, 'review')
  assert.equal(check('', { measurementSurface: 'flat', pdpConfirmed: true, measurementConfirmed: true }, 'fontHeight').status, 'pass')
  assert.equal(check('', { measurementSurface: 'flat', pdpConfirmed: true, measurementConfirmed: true }, 'fontWidth').status, 'review')
})
test('OCR pass disagreement is retained with source identities, not silently picked', () => {
  const candidates = fieldCandidates([{ id: 'original', text: 'MRP Rs. 40' }, { id: 'contrast', text: 'MRP Rs. 90' }, { id: 'tile', text: 'MRP Rs. 40' }])
  assert.equal(candidates.mrp.length, 2); assert.deepEqual(candidates.mrp[0].sources, ['original', 'tile'])
})
test('measurement statistics never self-certify lab validation', () => {
  assert.equal(calibrationSummary([{ referenceMm: 2, measuredMm: 2.1 }]).validated, false)
  assert.equal(calibrationSummary().count, 0)
})
test('reviews append, are idempotent, and never rewrite automated result', async () => {
  const original = { id: 'test-case', result: { status: 'manual_review', checks: [{ id: 'mrp', status: 'review' }] } }
  const actor = { id: 'reviewer', role: 'supervisor' }
  const first = await appendReview(original, { actor, status: 'compliant', reason: 'Inspected physical price panel.', id: 'one' })
  const second = await appendReview(first, { actor, status: 'non_compliant', reason: 'Second inspection found a defect.', id: 'two' })
  assert.equal(second.result.status, 'manual_review'); assert.deepEqual(second.result.checks, original.result.checks)
  assert.equal(effectiveStatus(second), 'non_compliant'); assert.equal(second.reviewHistory.length, 2); assert.equal(await verifyAuditChain(second.auditChain), true)
  assert.equal((await appendReview(second, { actor, status: 'non_compliant', reason: 'Second inspection found a defect.', id: 'two' })).reviewHistory.length, 2)
  await assert.rejects(appendReview(original, { actor: { role: 'officer' }, status: 'compliant', reason: 'Invalid self-approved review' }), /supervisor/)
})
