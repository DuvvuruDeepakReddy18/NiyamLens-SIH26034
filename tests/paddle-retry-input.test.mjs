import test from 'node:test'
import assert from 'node:assert/strict'
import { darkInkPixels, mapRetryWords, createPaddleRetryInput } from '../src/lib/paddleRetryInput.mjs'
import { runPaddleOcr, paddleSourceBinding } from '../src/lib/paddleOcr.mjs'

test('dark ink transformation only copies the brightest physical channel and preserves alpha/source', () => {
  const original = new Uint8ClampedArray([20, 80, 180, 255, 12, 10, 11, 128, 200, 255, 240, 0])
  const before = original.slice()
  assert.deepEqual(darkInkPixels(original), new Uint8ClampedArray([180, 180, 180, 255, 12, 12, 12, 128, 255, 255, 255, 0]))
  assert.deepEqual(original, before)
  assert.throws(() => darkInkPixels([0, 0, 0, 255]))
  assert.throws(() => darkInkPixels(new Uint8ClampedArray(3)))
})

test('90 degree retry boxes map back to the full analysis image with unequal scaling', () => {
  const words = [{ text: 'PKD:23/11/25', bbox: { x0: 100, y0: 40, x1: 140, y1: 120 } }]
  const original = structuredClone(words)
  const result = mapRetryWords(words, { width: 400, height: 300, rotation: 90 }, { width: 200, height: 150 })
  assert.deepEqual(result[0].bbox, { x0: 20, y0: 80, x1: 60, y1: 100 })
  assert.equal(result[0].pageWidth, 200); assert.equal(result[0].pageHeight, 150)
  assert.deepEqual(words, original)
})

test('crop mapping is applied after undoing retry rotation, not in the wrong frame', () => {
  let observed
  const words = [{ text: 'MRP48', bbox: { x0: 100, y0: 40, x1: 140, y1: 120 } }]
  mapRetryWords(words, { width: 400, height: 300, rotation: 90 }, { width: 900, height: 700 }, restored => { observed = restored; return restored })
  assert.deepEqual(observed[0].bbox, { x0: 40, y0: 160, x1: 120, y1: 200 })
  assert.equal(observed[0].pageWidth, 400); assert.equal(observed[0].pageHeight, 300)
  assert.throws(() => mapRetryWords([], { width: 400, height: 300, rotation: 45 }, { width: 900, height: 700 }))
})

test('unknown retry mode fails before decoding an image', async () => {
  await assert.rejects(createPaddleRetryInput({}, 'guess-missing-digits'), /Unknown/)
})

test('rotated retry preserves provider strategy but never offers wrong-frame guidance', async () => {
  const item = { id: 'p', analysisUrl: 'source' }
  const frame = { input: 'pixels', width: 200, height: 100, source: 'fixture dark ink 90', previewUrl: 'data:image/png;base64,dGVzdA==', sourceBinding: paddleSourceBinding(item), retryMode: { photometric: 'max-rgb-v1', rotation: 90 } }
  const input = { image: { width: 200, height: 100 }, items: [{ text: 'NET QUANTITY:', score: .8, poly: [[10,10], [180,10], [180,30], [10,30]] }] }
  let disposed = false
  const engineFactory = async () => ({ initialize: async () => {}, predict: async () => [input], dispose: () => { disposed = true } })
  const output = await runPaddleOcr({ evidenceItems: [item], inputFactory: async () => frame, engineFactory })
  assert.equal(output.items[0].ocrPasses[0].strategy, 'local-alternative-dark-ink-90')
  assert.equal(output.items[0].text, input.items[0].text)
  assert.deepEqual(output.items[0].focusGuidance.suggestions, [])
  assert.match(output.items[0].focusGuidance.withheld[0].reason, /rotated_retry/)
  assert.equal(disposed, true)
  await assert.rejects(runPaddleOcr({ evidenceItems: [item], inputFactory: async () => ({ ...frame, retryMode: { photometric: 'made-up', rotation: 90 } }), engineFactory }), /retry provenance/)
})
