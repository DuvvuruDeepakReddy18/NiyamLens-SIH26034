import test from 'node:test'
import assert from 'node:assert/strict'
import { calibrateOcrReliability, flattenOcrWords, matchDeclarationRegions, measureRegion, mergeOcrPassTexts, selectReferenceCandidate } from '../src/lib/vision.mjs'

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

test('multi-pass OCR merging repairs a common trailing-S substitution and rejects short noise', () => {
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

test('OCR reliability rewards agreement instead of trusting one high engine score', () => {
  const reliable = calibrateOcrReliability([
    { text: 'MRP Rs 48 net quantity 100 g packed August 2026 consumer care', confidence: 88 },
    { text: 'MRP Rs 48 net quantity 100 g packed August 2026 consumer care', confidence: 81 },
  ], 84)
  const conflicting = calibrateOcrReliability([
    { text: 'MRP Rs 48 net quantity 100 g', confidence: 92 },
    { text: 'decorative package artwork unrelated noise', confidence: 70 },
  ], 84)
  assert.ok(reliable.score > conflicting.score)
  assert.equal(conflicting.engineConfidence, 92)
  assert.equal(conflicting.agreement, 0)
})

test('OCR reliability rejects empty recognition even when capture quality is high', () => {
  const result = calibrateOcrReliability([{ text: '', confidence: 99 }], 95)
  assert.equal(result.score, 0)
  assert.match(result.reason, /no readable/i)
})

test('OCR merging never erases conflicting numeric declarations or units', () => {
  for (const [first, second] of [['MRP Rs. 40.00', 'MRP Rs. 48.00'], ['NET QTY 100 g', 'NET QTY 100 ml'], ['PACKED 08/2026', 'PACKED 09/2026'], ['MRP Rs. 50', 'MRP Rs. -50']]) {
    const merged = mergeOcrPassTexts([first, second])
    assert.ok(merged.includes(first))
    assert.ok(merged.includes(second))
  }
})

test('OCR merging bounds malformed output and keeps long distinct lines without quadratic edit-distance work', () => {
  assert.throws(() => mergeOcrPassTexts(['x'.repeat(500001)]), /too large/)
  assert.throws(() => mergeOcrPassTexts([{}]), /too large/)
  const start = performance.now()
  const merged = mergeOcrPassTexts(['a'.repeat(90000), 'b'.repeat(90000)])
  assert.equal(merged.split('\n').length, 2)
  assert.ok(performance.now() - start < 1000)
})
