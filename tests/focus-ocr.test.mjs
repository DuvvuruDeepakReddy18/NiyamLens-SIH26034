import test from 'node:test'
import assert from 'node:assert/strict'
import { focusPlan, mapFocusWords, appendFocusedTranscript } from '../src/lib/focusOcr.mjs'

test('focus crops are bounded, padded and independent of drag direction', () => {
  const rect = { x0: .25, y0: .2, x1: .75, y1: .4 }
  const plan = focusPlan(rect, 4000, 3000)
  assert.equal(plan.x, 1000); assert.equal(plan.y, 600); assert.equal(plan.cropWidth, 2000)
  assert.ok(plan.width <= 2248); assert.ok(plan.height <= 2248)
  assert.deepEqual(focusPlan({ x0: rect.x1, y0: rect.y1, x1: rect.x0, y1: rect.y0 }, 4000, 3000), plan)
  for (const bad of [{ ...rect, x0: -1 }, { ...rect, x1: NaN }, { ...rect, x1: '0.75' }, { ...rect, y1: .20001 }]) assert.throws(() => focusPlan(bad, 4000, 3000))
})
test('crop OCR boxes map back to the analysis image, not the high-resolution crop scale', () => {
  const plan = focusPlan({ x0: .25, y0: .2, x1: .75, y1: .4 }, 4000, 3000)
  const [mapped] = mapFocusWords([{ text: 'MRP', bbox: { x0: 24, y0: 24, x1: plan.width - 24, y1: plan.height - 24 } }], plan, { width: 2000, height: 1500 })
  assert.deepEqual(mapped.bbox, { x0: 500, y0: 300, x1: 1500, y1: 600 })
  assert.equal(mapped.pageWidth, 2000)
})

test('fractional selection includes every edge pixel instead of clipping the declaration end', () => {
  const rect = { x0: .1009, y0: .2009, x1: .4001, y1: .3001 }
  const plan = focusPlan(rect, 1000, 1000)
  assert.equal(plan.x, 100); assert.equal(plan.y, 200)
  assert.equal(plan.x + plan.cropWidth, 401)
  assert.equal(plan.y + plan.cropHeight, 301)
  assert.deepEqual(focusPlan({ x0: rect.x1, y0: rect.y1, x1: rect.x0, y1: rect.y0 }, 1000, 1000), plan)
})
test('focused readings append without silently replacing manual corrections or conflicting values', () => {
  const result = appendFocusedTranscript({ text: 'Officer corrected text', rawOcrText: 'MRP 40', focusedText: 'MRP 48', panelIndex: 1 })
  assert.match(result.text, /^Officer corrected text/)
  assert.match(result.rawOcrText, /^MRP 40/)
  assert.match(result.text, /MRP 48/); assert.match(result.rawOcrText, /MRP 48/)
  assert.match(result.text, /PANEL 2/)
  assert.throws(() => appendFocusedTranscript({ text: 'x'.repeat(99999), focusedText: 'MRP 20' }), /exceed/)
})
