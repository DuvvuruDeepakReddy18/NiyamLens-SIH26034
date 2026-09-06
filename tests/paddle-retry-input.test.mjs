import test from 'node:test'
import assert from 'node:assert/strict'
import { darkInkPixels, mapRetryWords, createPaddleRetryInput, PADDLE_RETRY_MODES } from '../src/lib/paddleRetryInput.mjs'
import { runPaddleOcr, paddleSourceBinding } from '../src/lib/paddleOcr.mjs'
import { focusPlan, mapFocusWords } from '../src/lib/focusOcr.mjs'

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

const orientations = [
  { rotation: 0, mode: 'dark-ink', width: 400, height: 300, bbox: { x0: 40, y0: 160, x1: 120, y1: 200 } },
  { rotation: 90, mode: 'dark-ink-90', width: 300, height: 400, bbox: { x0: 100, y0: 40, x1: 140, y1: 120 } },
  { rotation: 180, mode: 'dark-ink-180', width: 400, height: 300, bbox: { x0: 280, y0: 100, x1: 360, y1: 140 } },
  { rotation: 270, mode: 'dark-ink-270', width: 300, height: 400, bbox: { x0: 160, y0: 280, x1: 200, y1: 360 } },
]

test('recovery exposes only four immutable max-RGB orientation modes', () => {
  assert.deepEqual(Object.keys(PADDLE_RETRY_MODES), orientations.map(({ mode }) => mode))
  for (const { mode, rotation } of orientations) {
    assert.deepEqual(PADDLE_RETRY_MODES[mode], { photometric: 'max-rgb-v1', rotation })
    assert.ok(Object.isFrozen(PADDLE_RETRY_MODES[mode]))
  }
})

for (const orientation of orientations) {
  test(`${orientation.rotation} degree retry restores a non-square frame before unequal analysis scaling`, () => {
    const words = [{ text: '5?', confidence: 17, bbox: orientation.bbox, pageWidth: orientation.width, pageHeight: orientation.height }]
    const before = structuredClone(words)
    const result = mapRetryWords(words, { width: 400, height: 300, rotation: orientation.rotation }, { width: 200, height: 90 })
    assert.deepEqual(result[0].bbox, { x0: 20, y0: 48, x1: 60, y1: 60 })
    assert.equal(result[0].pageWidth, 200)
    assert.equal(result[0].pageHeight, 90)
    assert.equal(result[0].text, '5?')
    assert.equal(result[0].confidence, 17)
    assert.deepEqual(words, before)
    const full = mapRetryWords([{ text: 'frame', bbox: { x0: 0, y0: 0, x1: orientation.width, y1: orientation.height } }], { width: 400, height: 300, rotation: orientation.rotation }, { width: 400, height: 300 })
    assert.deepEqual(full[0].bbox, { x0: 0, y0: 0, x1: 400, y1: 300 })
  })

  test(`${orientation.rotation} degree retry maps through the real crop padding and source scale exactly once`, () => {
    // A 100 x 75 pixel source crop becomes 448 x 348 after 4x enlargement
    // and 24px borders. Scale the fixture to that exact non-square frame.
    const plan = focusPlan({ x0: .1, y0: .2, x1: .2, y1: .275 }, 1000, 1000)
    assert.equal(plan.width, 448)
    assert.equal(plan.height, 348)
    const originalBox = { x0: 64, y0: 88, x1: 104, y1: 128 }
    const forward = {
      0: originalBox,
      90: { x0: 220, y0: 64, x1: 260, y1: 104 },
      180: { x0: 344, y0: 220, x1: 384, y1: 260 },
      270: { x0: 88, y0: 344, x1: 128, y1: 384 },
    }
    let mappingCalls = 0
    const result = mapRetryWords([{ text: '5?', bbox: forward[orientation.rotation] }], { width: plan.width, height: plan.height, rotation: orientation.rotation }, { width: 500, height: 400 }, restored => {
      mappingCalls++
      assert.deepEqual(restored[0].bbox, originalBox)
      assert.equal(restored[0].pageWidth, 448)
      assert.equal(restored[0].pageHeight, 348)
      return mapFocusWords(restored, plan, { width: 500, height: 400 })
    })
    assert.equal(mappingCalls, 1)
    assert.deepEqual(result[0].bbox, { x0: 55, y0: 86.4, x1: 60, y1: 90.4 })
    assert.equal(result[0].pageWidth, 500)
    assert.equal(result[0].pageHeight, 400)
    assert.equal(result[0].text, '5?')
  })

  test(`${orientation.rotation} degree inference retains its exact preview, raw reading and source-bound mapped geometry`, async () => {
    const item = { id: 'retry-panel', analysisUrl: 'unchanged-source' }
    const { x0, y0, x1, y1 } = orientation.bbox
    const frame = { input: {}, width: orientation.width, height: orientation.height, source: 'fixture', previewUrl: `data:image/png;base64,${Buffer.from(orientation.mode).toString('base64')}`, sourceBinding: paddleSourceBinding(item), retryMode: PADDLE_RETRY_MODES[orientation.mode], mapWords: words => mapRetryWords(words, { width: 400, height: 300, rotation: orientation.rotation }, { width: 200, height: 90 }) }
    const provider = { image: { width: frame.width, height: frame.height }, items: [{ text: '5?', score: .17, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }] }
    let disposed = 0
    const output = await runPaddleOcr({ evidenceItems: [item], inputFactory: async () => frame, engineFactory: async () => ({ initialize: async () => {}, predict: async input => { assert.equal(input, frame.input); return [provider] }, dispose: () => { disposed++ } }) })
    const reading = output.items[0]
    assert.equal(reading.previewUrl, frame.previewUrl)
    assert.deepEqual(reading.sourceBinding, paddleSourceBinding(item))
    assert.deepEqual(reading.retryMode, { photometric: 'max-rgb-v1', rotation: orientation.rotation })
    assert.equal(reading.ocrPasses[0].strategy, `local-alternative-dark-ink-${orientation.rotation}`)
    assert.equal(reading.text, '5?')
    assert.equal(reading.ocrPasses[0].text, '5?')
    assert.deepEqual(reading.lines[0].box, provider.items[0].poly)
    assert.deepEqual(reading.ocrWords[0].bbox, { x0: 20, y0: 48, x1: 60, y1: 60 })
    if (orientation.rotation) assert.match(reading.focusGuidance.withheld[0].reason, /rotated_retry/)
    assert.equal(disposed, 1)
  })
}

test('unsupported coordinate rotations and mode names fail closed', async () => {
  for (const rotation of [-90, 45, 360, '90', null, undefined, NaN]) {
    assert.throws(() => mapRetryWords([], { width: 400, height: 300, rotation }, { width: 200, height: 150 }), /Invalid retry coordinate/)
  }
  for (const mode of ['dark-ink-360', 'dark-ink--90', '__proto__', null, undefined]) await assert.rejects(createPaddleRetryInput({}, mode), /Unknown/)
})

test('invalid retry provenance is rejected before inference and disposes the owned worker', async () => {
  const item = { id: 'p', analysisUrl: 'source' }
  for (const retryMode of [{ photometric: 'max-rgb-v1', rotation: 360 }, { photometric: 'max-rgb-v1', rotation: '180' }, { photometric: 'made-up', rotation: 270 }]) {
    let predictions = 0, disposed = 0
    const frame = { input: {}, width: 200, height: 100, previewUrl: 'data:image/png;base64,dGVzdA==', sourceBinding: paddleSourceBinding(item), retryMode }
    await assert.rejects(runPaddleOcr({ evidenceItems: [item], inputFactory: async () => frame, engineFactory: async () => ({ initialize: async () => {}, predict: async () => { predictions++; return [] }, dispose: () => { disposed++ } }) }), /retry provenance/)
    assert.equal(predictions, 0)
    assert.equal(disposed, 1)
  }
})

test('cancelled orientation recovery returns no readings and disposes its inference worker', async () => {
  const item = { id: 'p', analysisUrl: 'source' }
  const controller = new AbortController()
  const frame = { input: {}, width: 300, height: 400, source: 'fixture dark ink 270', previewUrl: 'data:image/png;base64,dGVzdA==', sourceBinding: paddleSourceBinding(item), retryMode: { photometric: 'max-rgb-v1', rotation: 270 } }
  let predictions = 0, disposed = 0
  await assert.rejects(runPaddleOcr({ evidenceItems: [item], signal: controller.signal, inputFactory: async () => frame, engineFactory: async () => ({ initialize: async () => {}, predict: () => { predictions++; controller.abort(); return new Promise(() => {}) }, dispose: () => { disposed++ } }) }), { name: 'AbortError' })
  assert.equal(predictions, 1)
  assert.equal(disposed, 1)
  await assert.rejects(runPaddleOcr({ evidenceItems: [item], signal: controller.signal, engineFactory: async () => { throw new Error('Must not create a worker after cancellation') } }), { name: 'AbortError' })
})
