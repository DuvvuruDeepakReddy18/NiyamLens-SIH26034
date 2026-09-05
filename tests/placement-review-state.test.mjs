import test from 'node:test'
import assert from 'node:assert/strict'
import { updatePlacementReview } from '../src/lib/placementReviewState.mjs'
import { evaluatePlacement } from '../src/lib/placement.mjs'

const field = { id: 'mrp', label: 'MRP', detected: true, value: '49.00', validation: { status: 'valid' } }
const saved = { state: 'outside_pdp', value: '40.00', panelId: 'panel-a', reason: 'Price printed on the rear panel.' }
const meta = { category: 'general', evidencePanelIds: ['panel-a', 'panel-b'], placementScope: 'general_flat', placementPdpConfirmed: true, measurementSurface: 'flat' }
const placementStatus = review => evaluatePlacement({ meta: { ...meta, placementReviews: { mrp: review } }, extraction: { byId: { mrp: field } } }).find(check => check.id === 'placement:mrp').status

test('editing a note cannot silently confirm placement for a changed reading', () => {
  assert.equal(placementStatus(saved), 'review')
  const updated = updatePlacementReview(field, saved, { reason: 'Rear panel checked again for the new price.' })
  assert.equal(updated.value, '49.00')
  assert.equal(updated.state, 'unreviewed')
  assert.equal(placementStatus(updated), 'review')
  assert.equal(saved.value, '40.00')
  assert.equal(saved.state, 'outside_pdp')
})

test('a changed reading requires an explicit new placement decision', () => {
  const updated = updatePlacementReview(field, saved, { state: 'inside_pdp' })
  assert.equal(updated.state, 'inside_pdp')
  assert.equal(updated.value, field.value)
  assert.equal(placementStatus(updated), 'pass')
})

test('changing the source panel clears even a current placement decision', () => {
  const updated = updatePlacementReview(field, { ...saved, value: field.value }, { panelId: 'panel-b' })
  assert.equal(updated.panelId, 'panel-b')
  assert.equal(updated.state, 'unreviewed')
  assert.equal(placementStatus(updated), 'review')
})

test('editing a note for an unchanged declaration preserves its explicit observation', () => {
  const updated = updatePlacementReview(field, { ...saved, value: field.value }, { reason: 'Rear panel observation clarified.' })
  assert.equal(updated.state, 'outside_pdp')
  assert.equal(placementStatus(updated), 'fail')
})

test('invalid or conflicting readings cannot gain a decisive placement from an edit', () => {
  for (const invalid of [{ ...field, conflict: true }, { ...field, validation: { status: 'invalid' } }, { ...field, value: '' }]) {
    const updated = updatePlacementReview(invalid, { ...saved, value: invalid.value }, { state: 'inside_pdp' })
    assert.equal(updated.state, 'unreviewed')
  }
})
