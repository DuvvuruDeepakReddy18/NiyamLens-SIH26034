import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSourceRegions } from '../src/lib/sourceRegions.mjs'
import { normalizeCase } from '../src/lib/caseRecords.mjs'

const panel = { id: 'panel-a' }
const extraction = { fields: [{ id: 'mrp', label: 'Maximum retail price', detected: true }] }
const valid = { id: 'mrp', label: 'Forged label', panelId: 'panel-a', text: 'MRP Rs. 40', bbox: { x0: 1, y0: 2, x1: 40, y1: 18 }, pageWidth: 100, pageHeight: 60 }

test('client region normalization canonicalizes labels and drops unsafe imported geometry', () => {
  const regions = normalizeSourceRegions([
    valid,
    { ...valid, id: 'unknown' },
    { ...valid, panelId: 'missing' },
    { ...valid, bbox: { ...valid.bbox, x1: 1000 } },
  ], [panel], extraction)
  assert.equal(regions.length, 1)
  assert.equal(regions[0].label, 'Maximum retail price')
})

test('normalizing a transferred case cannot retain malformed report regions', () => {
  const record = normalizeCase({ id: 'case-a', result: { status: 'manual_review' }, evidenceItems: [panel], extraction, regions: [{ ...valid, bbox: null }] })
  assert.deepEqual(record.regions, [])
  assert.throws(() => normalizeCase(null), /JSON object/)
})
