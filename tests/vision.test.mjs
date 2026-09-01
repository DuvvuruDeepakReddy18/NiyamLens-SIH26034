import test from 'node:test'
import assert from 'node:assert/strict'
import { flattenOcrWords, matchDeclarationRegions, measureRegion, mergeOcrPassTexts, selectReferenceCandidate } from '../src/lib/vision.mjs'

const blocks = [{
  paragraphs: [{
    lines: [{
      text: 'MRP Rs. 48 inclusive of all taxes',
      words: [
        { text: 'MRP', confidence: 96, bbox: { x0: 10, y0: 20, x1: 40, y1: 35 } },
        { text: 'Rs.', confidence: 94, bbox: { x0: 44, y0: 20, x1: 65, y1: 35 } },
        { text: '48', confidence: 93, bbox: { x0: 69, y0: 20, x1: 87, y1: 35 } },
        { text: 'inclusive', confidence: 91, bbox: { x0: 91, y0: 20, x1: 155, y1: 35 } },
      ],
    }],
  }],
}]

test('OCR word geometry maps a declaration to its evidence region', () => {
  const words = flattenOcrWords(blocks, 'panel-1', 200, 100)
  const extraction = { fields: [{ id: 'mrp', label: 'MRP', detected: true, evidence: 'MRP Rs. 48 inclusive' }] }
  const regions = matchDeclarationRegions(extraction, words)
  assert.equal(words.length, 4)
  assert.equal(regions.length, 1)
  assert.equal(regions[0].panelId, 'panel-1')
  assert.deepEqual(regions[0].bbox, { x0: 10, y0: 20, x1: 155, y1: 35 })
})

test('region calibration propagates measurement uncertainty', () => {
  const result = measureRegion({ pixelHeight: 15 }, 100, 20, 10)
  assert.equal(result.valueMm, 3)
  assert.equal(result.lower, 2.7)
  assert.equal(result.upper, 3.3)
})

test('reference-card selection rejects sparse green blobs and prefers a filled marker-like rectangle', () => {
  const selected = selectReferenceCandidate([
    { width: 100, height: 25, pixels: 300, areaRatio: .01 },
    { width: 120, height: 24, pixels: 2600, areaRatio: .012 },
  ])
  assert.equal(selected.width, 120)
  assert.ok(selected.fillRatio > .8)
})

test('dual-pass OCR merging repairs a common trailing-S substitution and rejects short noise', () => {
  const merged = mergeOcrPassTexts([
    'MANUFACTURED BY: FIELD HARVEST FOOD$\nMRP Rs. 48.00',
    'TURMERIC POWDER\nIl\nzm rer\n[ 20 mmrer |',
  ])
  assert.match(merged, /FIELD HARVEST FOODS/)
  assert.match(merged, /TURMERIC POWDER/)
  assert.match(merged, /20 mm REF/)
  assert.doesNotMatch(merged, /^Il$/m)
  assert.doesNotMatch(merged, /^zm rer$/m)
})
