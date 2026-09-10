import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { evaluateInspection } from '../src/lib/inspectionSafety.mjs'
import { validateInspectionMetadata } from '../src/lib/inspectionMetadata.mjs'
import { invalidateOcrEvidence, invalidateCapturedEvidence } from '../src/lib/inspectionWorkflow.mjs'
import { applyContextAutofill, markContextEdited, useDetectedContext, verificationPrefill, updateGeometryDimension } from '../src/lib/inspectionAutofill.mjs'

const initial = () => ({ productName: '', category: 'general', commodityClass: 'standard', quantity: '', unit: 'g', barcode: '', enforceEvidenceReview: true })
const read = text => extractDeclarations(text)
const label = 'COMMON NAME: TEST MILK\nFSSAI 10012002300045\nNET QTY 500 ml\nMRP Rs 40.00\nPACKED 08/2026'

test('autofills supported context but never physical measurements or attestations', () => {
  const meta = applyContextAutofill(initial(), read(label))
  assert.equal(meta.productName, 'TEST MILK')
  assert.equal(meta.category, 'food')
  assert.equal(meta.quantity, 500)
  assert.equal(meta.unit, 'ml')
  assert.equal(meta.contextAutofill.fields.quantity.value, 500)
  assert.match(meta.contextAutofill.fields.quantity.evidence, /500 ml/)
  for (const key of ['fieldReviews', 'pdpArea', 'panelWidthCm', 'referencePx', 'glyphPx', 'measurementSurface']) assert.equal(meta[key], undefined, key)
  for (const key of ['classificationConfirmed', 'rule3ApplicabilityConfirmed', 'allPanelsCaptured', 'pdpConfirmed', 'measurementConfirmed']) assert.notEqual(meta[key], true, key)
  assert.equal(evaluateInspection({ text: label, meta }).status, 'manual_review')
  assert.deepEqual(validateInspectionMetadata(meta), [])
  assert.deepEqual(applyContextAutofill(meta, read(label)), meta, 'idempotent')
})

test('manual quantity and unit stay paired through OCR reruns; explicit reuse restores both', () => {
  let meta = applyContextAutofill(initial(), read(label))
  meta = { ...meta, quantity: '450', ...markContextEdited(meta, 'quantity') }
  meta = applyContextAutofill(meta, read('COMMON NAME: NEW\nNET QTY 1 kg'))
  assert.equal(meta.quantity, '450')
  assert.equal(meta.unit, 'ml', 'no silent unit conversion')
  assert.equal(meta.productName, 'NEW')
  const restored = useDetectedContext(meta, 'quantity', read('NET QTY 1 kg'))
  assert.equal(restored.quantity, 1)
  assert.equal(restored.unit, 'kg')
})

test('explicit default and blank edits are protected, including after draft round trip', () => {
  let meta = applyContextAutofill(initial(), read(label))
  meta = { ...meta, category: 'general', ...markContextEdited(meta, 'category') }
  meta = { ...meta, productName: '', ...markContextEdited(meta, 'productName') }
  meta = applyContextAutofill(JSON.parse(JSON.stringify(meta)), read(label))
  assert.equal(meta.category, 'general')
  assert.equal(meta.productName, '')
  assert.equal(meta.contextAutofill.manual.productName, true)
})

test('legacy officer context is not overwritten and unknown readings do not become classification evidence', () => {
  const meta = applyContextAutofill({ ...initial(), category: 'imported', productName: 'Officer title', quantity: 40, unit: 'g' }, read(label))
  assert.equal(meta.category, 'imported')
  assert.equal(meta.productName, 'Officer title')
  assert.equal(meta.quantity, 40)
  const unknown = applyContextAutofill(initial(), read('MRP Rs 40'))
  assert.equal(unknown.contextAutofill.fields.category, undefined)
  assert.equal(unknown.contextAutofill.fields.commodityClass, undefined)
})

test('new conflicting or missing readings clear only previous automatic values', () => {
  const meta = applyContextAutofill(initial(), read(label))
  const next = applyContextAutofill(meta, read('NET QTY 200 g\nNET QTY 300 g'))
  assert.equal(next.quantity, '')
  assert.equal(next.unit, 'g')
  assert.equal(next.productName, '')
  assert.equal(next.category, 'general')
  assert.notEqual(next.classificationConfirmed, true)
  assert.equal(applyContextAutofill(meta, read('')).quantity, '')
})

test('invalid quantity and barcode do not autofill', () => {
  const meta = applyContextAutofill(initial(), read('NET QTY 0 g\nBARCODE: 1234567890123'))
  assert.equal(meta.quantity, '')
  assert.equal(meta.barcode, '')
})

test('best-before context is suggested from evidence, cleared when lost, and never overrides explicit edits', () => {
  const parsed = read('BEST BEFORE: 6 MONTHS FROM PACKING')
  let meta = applyContextAutofill({ ...initial(), perishable: false }, parsed)
  assert.equal(meta.perishable, true)
  assert.match(meta.contextAutofill.fields.perishable.evidence, /BEST BEFORE/)
  assert.equal(applyContextAutofill(meta, read('MRP Rs 40')).perishable, false)
  meta = { ...meta, perishable: false, ...markContextEdited(meta, 'perishable') }
  assert.equal(applyContextAutofill(meta, parsed).perishable, false)
  assert.equal(useDetectedContext(meta, 'perishable', parsed).perishable, true)
})

test('unchanged context preserves explicit confirmation; changed context invalidates dependent approvals', () => {
  const meta = { ...applyContextAutofill(initial(), read(label)), classificationConfirmed: true, placementPdpConfirmed: true, rule3ApplicabilityConfirmed: true }
  assert.equal(applyContextAutofill(meta, read(label)).classificationConfirmed, true)
  const changed = applyContextAutofill(meta, read(label.replace('500 ml', '1 l')))
  assert.equal(changed.classificationConfirmed, false)
  assert.equal(changed.rule3ApplicabilityConfirmed, false)
  assert.equal(changed.placementPdpConfirmed, false)
})

test('verification prefill supplies bounded source notes, not confirmations', () => {
  const field = read(label).byId.mrp
  const note = verificationPrefill(field, {}, [{ id: 'mrp', panelId: 'p1', matchScore: .8 }], [{ id: 'p1', name: 'milk.jpg' }])
  assert.match(note.reason, /Auto-filled/)
  assert.match(note.reason, /Panel 1.*milk.jpg/)
  assert.match(note.reason, /MRP Rs 40.00/)
  assert.equal(note.state, 'unreviewed')
  const missing = verificationPrefill(read('').byId.mrp)
  assert.equal(missing.reason, '')
  assert.equal(missing.state, 'unreviewed')
  const conflict = verificationPrefill(read('MRP Rs 40\nMRP Rs 50').byId.mrp)
  assert.equal(conflict.reason, '')
  const unlocated = verificationPrefill(field, {}, [{ id: 'mrp', panelId: 'deleted' }], [])
  assert.doesNotMatch(unlocated.reason, /Panel/)
  assert.match(unlocated.reason, /source not located/i)
  assert.ok(verificationPrefill({ ...field, evidence: 'x'.repeat(6000) }).reason.length <= 2000)
})

test('officer notes survive refresh, and changed values lose confirmation', () => {
  const field = read(label).byId.mrp
  const reviewed = { state: 'confirmed', value: field.value, reason: 'Physically compared the price.', reasonSource: 'officer' }
  assert.equal(verificationPrefill(field, reviewed).reason, reviewed.reason)
  assert.equal(verificationPrefill(field, reviewed).state, 'confirmed')
  assert.equal(verificationPrefill({ ...field, value: '50.00' }, reviewed).state, 'unreviewed')
  assert.equal(verificationPrefill(field, { ...reviewed, reason: '' }).reason, '', 'intentional blank stays blank')
  const refreshed = verificationPrefill({ ...field, value: '50.00', evidence: 'MRP Rs 50.00' }, { ...reviewed, reasonSource: 'extraction' })
  assert.match(refreshed.reason, /50.00/)
  assert.equal(refreshed.state, 'unreviewed')
})

test('geometry computes from supplied dimensions only and clears stale calculated area', () => {
  let meta = updateGeometryDimension({}, 'panelWidthCm', '10')
  assert.equal(meta.pdpArea, '')
  meta = updateGeometryDimension(meta, 'panelHeightCm', '8')
  assert.equal(meta.pdpArea, 80)
  assert.equal(meta.pdpConfirmed, false)
  assert.equal(updateGeometryDimension(meta, 'panelWidthCm', '').pdpArea, '')
  assert.equal(updateGeometryDimension(meta, 'panelHeightCm', '-1').pdpArea, '')
  assert.equal(updateGeometryDimension(meta, 'panelHeightCm', 'Infinity').pdpArea, '')
  const curved = updateGeometryDimension({ cylinderDiameterCm: 6, cylinderCoverage: 40 }, 'cylinderHeightCm', '10')
  assert.equal(curved.pdpArea, 75.4)
  assert.notEqual(curved.measurementSurface, 'flat')
  assert.equal(updateGeometryDimension(curved, 'cylinderCoverage', 101).pdpArea, '')
  assert.throws(() => updateGeometryDimension({}, 'quantity', 4), /dimension/)
})

test('new OCR retains officer notes but resets decisions; new photos invalidate both', () => {
  const meta = { fieldReviews: { mrp: { state: 'confirmed', value: '40', reason: 'Officer note', reasonSource: 'officer' } }, classificationConfirmed: true }
  const reset = invalidateOcrEvidence(meta)
  assert.equal(reset.fieldReviews.mrp.reason, 'Officer note')
  assert.equal(reset.fieldReviews.mrp.state, 'unreviewed')
  assert.equal(reset.classificationConfirmed, false)
  assert.deepEqual(invalidateCapturedEvidence(meta).fieldReviews, {})
})
