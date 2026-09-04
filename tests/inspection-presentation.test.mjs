import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceCoverage, evidenceTrace, fieldReviewProgress, inspectionProgress, qualityDecisionRequired, qualityIdentity } from '../src/lib/inspectionPresentation.mjs'

const extraction = {
  raw: 'MRP Rs. 40',
  fields: [{ id: 'mrp', label: 'MRP', detected: true, value: '40.00' }],
  byId: { mrp: { id: 'mrp', label: 'MRP', detected: true, value: '40.00' } },
}

test('evidence coverage uses real role assignments and does not invent a front view', () => {
  const full = { id: 'all', panelRole: 'full_declaration', quality: { status: 'good' } }
  const coverage = evidenceCoverage([full])
  assert.equal(coverage.find((item) => item.id === 'front').covered, false)
  assert.equal(coverage.filter((item) => item.covered).length, 3)
  assert.ok(coverage.filter((item) => item.covered).every((item) => item.evidence === full))
})

test('field review progress rejects stale or unexplained confirmations', () => {
  const result = { checks: [{ id: 'mrp' }] }
  assert.equal(fieldReviewProgress(extraction, { classificationConfirmed: true, fieldReviews: { mrp: { state: 'confirmed', value: '39.00', reason: 'front panel' } } }, result).reviewed, 0)
  assert.equal(fieldReviewProgress(extraction, { classificationConfirmed: true, fieldReviews: { mrp: { state: 'confirmed', value: '40.00', reason: '' } } }, result).reviewed, 0)
  assert.deepEqual(fieldReviewProgress(extraction, { classificationConfirmed: true, fieldReviews: { mrp: { state: 'confirmed', value: '40.00', reason: 'Visible on captured panel' } } }, result), { reviewed: 1, total: 1, complete: true })
})

test('inspection stages report observed state without treating manual text as OCR', () => {
  const stages = inspectionProgress({ evidenceItems: [{ id: 'front', panelRole: 'front' }], extraction, provenance: { hasRun: false }, meta: {}, result: { status: 'manual_review', context: {} } })
  assert.equal(stages.find((item) => item.id === 'capture').summary, '1/4 suggested views covered')
  assert.equal(stages.find((item) => item.id === 'recognize').summary, 'Manual text only')
  assert.equal(stages.find((item) => item.id === 'recognize').complete, false)
  assert.equal(stages.find((item) => item.id === 'evaluate').summary, 'manual review')
})

test('trace joins an extracted field only to its actual panel and applicable checks', () => {
  const panel = { id: 'panel-a', name: 'label.jpg' }
  const trace = evidenceTrace({ fieldId: 'mrp', extraction, regions: [{ id: 'mrp', panelId: 'panel-a', bbox: { x0: 10, y0: 20, x1: 40, y1: 28 } }], evidenceItems: [panel], result: { checks: [{ id: 'mrp', rule: 'Rule 6', status: 'pass' }, { id: 'packDate', rule: 'Rule 6', status: 'fail' }] }, meta: { fieldReviews: { mrp: { state: 'confirmed', value: '40.00' } } } })
  assert.equal(trace.panel, panel)
  assert.equal(trace.panelIndex, 0)
  assert.deepEqual(trace.checks.map((item) => item.id), ['mrp'])
  assert.equal(trace.review.state, 'confirmed')
})

test('image-quality gate accepts only a decision bound to the current transformed evidence', () => {
  const item = { id: 'panel-a', sha256: 'original-hash', rotation: 0, contrast: 100, grayscale: false, quality: { status: 'review' } }
  assert.equal(qualityDecisionRequired([item], {}), true)
  assert.equal(qualityDecisionRequired([item], { 'panel-a': { identity: qualityIdentity(item) } }), false)
  assert.equal(qualityDecisionRequired([{ ...item, rotation: 90 }], { 'panel-a': { identity: qualityIdentity(item) } }), true)
  assert.equal(qualityDecisionRequired([{ ...item, quality: { status: 'good' } }], {}), false)
})
