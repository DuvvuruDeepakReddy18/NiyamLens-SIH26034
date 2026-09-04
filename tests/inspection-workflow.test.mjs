import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateInspection } from '../src/lib/inspectionSafety.mjs'
import { EMPTY_OCR, ocrProvenance, restoreEvidencePolicy, invalidateCapturedEvidence, validateSealableEvidence, nextPageOffset } from '../src/lib/inspectionWorkflow.mjs'

const event = { type: 'ocr_completed', at: '2026-09-04T10:00:00Z', payload: {} }
test('manual input cannot acquire OCR confidence from default metadata or a seal event', () => {
  const record = { text: 'NET QTY 5 g', rawOcrText: '', meta: { ocrConfidence: 100, ocrEngineConfidence: 100 }, auditChain: [{ ...event, type: 'inspection_sealed' }] }
  assert.equal(ocrProvenance(record).hasRun, false)
  assert.equal(ocrProvenance(record).reliability, null)
  assert.equal(ocrProvenance({ ...record, auditChain: [event] }).hasRun, false)
  assert.equal(ocrProvenance({ ...record, rawOcrText: 'text' }).hasRun, false)
  assert.deepEqual(restoreEvidencePolicy(record), { ...record.meta, ...EMPTY_OCR, enforceEvidenceReview: true })
})
test('recorded completed OCR is distinguished from missing, invalidated and malformed runs', () => {
  const record = { rawOcrText: 'NET QTY 100 g', meta: { ocrSource: 'local', ocrConfidence: 67, ocrEngineConfidence: 82 }, auditChain: [event] }
  assert.equal(ocrProvenance(record).hasRun, true)
  assert.equal(ocrProvenance(record).reliability, 67)
  assert.equal(ocrProvenance({ ...record, auditChain: [null, { type: 'ocr_completed' }] }).hasRun, false)
  assert.equal(ocrProvenance({ ...record, meta: { ...record.meta, ocrSource: 'none' } }).hasRun, false)
  assert.equal(ocrProvenance({ ...record, meta: { ...record.meta, ocrConfidence: Infinity } }).reliability, null)
  assert.equal(ocrProvenance({ ...record, auditChain: [], clientAuditChain: [event] }).hasRun, true)
})
test('restoration normalizes scores even when a completed run exists and never fabricates timestamps', () => {
  const fixture = { rawOcrText: 'NET QTY 100 g', meta: { productName: 'Officer edit', ocrSource: 'local', ocrCompletedAt: '2099-01-01', ocrConfidence: 67, ocrEngineConfidence: 82 }, auditChain: [event] }
  for (const invalid of ['95', '', true, {}, [], Infinity, NaN, -1, 101, null, undefined]) {
    const record = { ...fixture, meta: { ...fixture.meta, ocrConfidence: invalid, ocrEngineConfidence: invalid } }
    const restored = restoreEvidencePolicy(record)
    assert.equal(ocrProvenance(record).hasRun, true)
    assert.equal(restored.ocrConfidence, null); assert.equal(restored.ocrEngineConfidence, null)
    assert.equal(restored.ocrCompletedAt, event.at); assert.equal(restored.productName, 'Officer edit')
  }
  for (const score of [0, 67, 100]) {
    const restored = restoreEvidencePolicy({ ...fixture, meta: { ...fixture.meta, ocrConfidence: score, ocrEngineConfidence: score } })
    assert.equal(restored.ocrConfidence, score); assert.equal(restored.ocrEngineConfidence, score)
  }
  const missing = restoreEvidencePolicy({ ...fixture, auditChain: [] })
  assert.equal(missing.ocrCompletedAt, null); assert.equal(missing.ocrConfidence, null)
  assert.equal(ocrProvenance({ ...fixture, auditChain: [{ ...event, at: 0 }] }).hasRun, false)
  assert.equal(ocrProvenance({ ...fixture, meta: { ...fixture.meta, ocrSource: {} } }).hasRun, false)
  assert.equal(ocrProvenance(null).hasRun, false)
})
test('capture changes clear image-bound observations without mutating officer edits or inventing OCR', () => {
  const original = {
    productName: 'Keep the officer edit', quantity: 100, unit: 'g', pdpArea: 80, panelMeasurements: { front: { referencePx: 20 } },
    ...Object.fromEntries(Object.keys(EMPTY_OCR).map(key => [key, key === 'ocrSource' ? 'local' : 95])),
    fieldReviews: { mrp: { state: 'confirmed', value: '100' } }, fieldCandidates: { mrp: ['100'] },
    placementReviews: { mrp: { state: 'inside_pdp' } }, quantitySpacing: { confirmed: true, numeralHeightPx: 12 },
    allPanelsCaptured: true, classificationConfirmed: true, placementPdpConfirmed: true, measurementConfirmed: true, widthCharacterConfirmed: true,
  }
  const before = structuredClone(original)
  const changed = invalidateCapturedEvidence(original)
  for (const [key, value] of Object.entries(EMPTY_OCR)) assert.equal(changed[key], value)
  for (const key of ['fieldReviews', 'fieldCandidates', 'placementReviews', 'quantitySpacing']) assert.deepEqual(changed[key], {})
  for (const key of ['allPanelsCaptured', 'classificationConfirmed', 'placementPdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed']) assert.equal(changed[key], false)
  for (const key of ['productName', 'quantity', 'unit', 'pdpArea', 'panelMeasurements']) assert.deepEqual(changed[key], original[key])
  assert.deepEqual(original, before)
  assert.equal(ocrProvenance({ meta: changed, rawOcrText: 'Old raw transcript retained separately.', auditChain: [event] }).hasRun, false)
  assert.deepEqual(invalidateCapturedEvidence(changed), changed)
  assert.notEqual(invalidateCapturedEvidence(original).fieldReviews, changed.fieldReviews)
})
test('local finalization refuses zero photos, empty text, duplicates and unfinished processing', () => {
  const input = { text: 'NET QTY 5 g\nNET QTY 100 g', evidenceItems: [{ id: 'front', analysisUrl: 'data:image/png;base64,AA==' }] }
  assert.equal(validateSealableEvidence(input), true)
  for (const patch of [{ evidenceItems: [] }, { text: '' }, { text: ' '.repeat(50) }, { evidenceItems: [input.evidenceItems[0], input.evidenceItems[0]] }, { processing: true }, { ocrRunning: true }, { text: 'a'.repeat(100001) }]) assert.throws(() => validateSealableEvidence({ ...input, ...patch }))
})
test('pagination rejects nonadvancing and out-of-range cursors without looping', () => {
  assert.equal(nextPageOffset(0, 20), 20)
  assert.equal(nextPageOffset(100000, null), null)
  for (const next of [0, -1, '20', 20.1, NaN, Infinity, 100020, undefined]) assert.throws(() => nextPageOffset(20, next))
  assert.throws(() => nextPageOffset(0, 20, 5000))
})
test('partial or unavailable OCR scores remain unavailable rather than reported as zero accuracy', () => {
  const result = evaluateInspection({ text: 'MRP 22.00', meta: { ocrSource: 'local-focus', ocrConfidence: null, enforceEvidenceReview: true } })
  const gate = result.checks.find((check) => check.id === 'ocrConfidence')
  assert.equal(gate.status, 'review')
  assert.match(gate.evidence, /unavailable/i)
  assert.doesNotMatch(gate.evidence, /0\.0%/)
})
