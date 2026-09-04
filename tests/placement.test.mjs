import test from 'node:test'
import assert from 'node:assert/strict'
import { PLACEMENT_FIELDS, validatePlacementMetadata, evaluatePlacement } from '../src/lib/placement.mjs'
const extraction = { byId: Object.fromEntries(PLACEMENT_FIELDS.map(id => [id, { id, label: id, value: `${id} value`, detected: true }])) }
const meta = {
  evidencePanelIds: ['front'], category: 'general', placementScope: 'general_flat', placementPdpConfirmed: true, measurementSurface: 'flat',
  placementReviews: Object.fromEntries(PLACEMENT_FIELDS.map(id => [id, { state: 'inside_pdp', panelId: 'front', value: `${id} value`, reason: 'Observed on the physical PDP.' }])),
  quantitySpacing: { panelId: 'front', value: 'netQuantity value', numeralHeightPx: 10, abovePx: 12, belowPx: 12, leftPx: 24, rightPx: 24, uncertaintyPercent: 5, confirmed: true, reason: 'Measured individual numeral and clear gaps.' },
}
test('placement records are explicitly officer-assisted and bound to captured panels and field values', () => {
  assert.deepEqual(validatePlacementMetadata(meta), [])
  assert.ok(evaluatePlacement({ meta, extraction }).every(c => c.status === 'pass'))
  const changed = { byId: { ...extraction.byId, mrp: { ...extraction.byId.mrp, value: 'changed' } } }
  assert.equal(evaluatePlacement({ meta, extraction: changed }).find(c => c.id === 'placement:mrp').status, 'review')
  assert.ok(validatePlacementMetadata({ ...meta, evidencePanelIds: ['other'] }).length > 0)
  assert.ok(evaluatePlacement({ meta: { ...meta, measurementSurface: 'curved' }, extraction }).every(c => c.status === 'review'))
})
test('quantity clear-space uses measured numeral height, horizontal double gap and uncertainty', () => {
  const assess = patch => evaluatePlacement({ meta: { ...meta, quantitySpacing: { ...meta.quantitySpacing, ...patch } }, extraction }).find(c => c.id === 'quantityClearSpace')
  assert.equal(assess({}).status, 'pass')
  assert.equal(assess({ leftPx: 10 }).status, 'fail')
  assert.equal(assess({ abovePx: 10 }).status, 'review')
  assert.equal(assess({ abovePx: 10, uncertaintyPercent: 0 }).status, 'pass')
  assert.equal(assess({ value: 'different quantity' }).status, 'review')
  assert.equal(assess({ confirmed: false }).status, 'review')
})
test('invalid placement flags, wrong types and malformed geometry never pass', () => {
  for (const patch of [{ placementPdpConfirmed: 'true' }, { placementScope: 'all' }, { placementReviews: [] }, { quantitySpacing: { numeralHeightPx: -1 } }, { quantitySpacing: { uncertaintyPercent: Infinity } }, { quantitySpacing: { confirmed: 'false' } }]) {
    assert.ok(validatePlacementMetadata({ ...meta, ...patch }).length > 0)
    assert.ok(evaluatePlacement({ meta: { ...meta, ...patch }, extraction }).every(c => c.status === 'review'))
  }
  assert.deepEqual(evaluatePlacement({ meta, extraction, exempt: true }), [])
})
