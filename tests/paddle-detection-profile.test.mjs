import test from 'node:test'
import assert from 'node:assert/strict'
import { createPaddleEngine, PADDLE_DETECTION_PROFILES, paddleSourceBinding, preparePaddleAppend, runPaddleOcr } from '../src/lib/paddleOcr.mjs'

const panel = { id: 'p', analysisUrl: 'original-pixels', ocrText: 'EARLIER RAW', ocrPasses: [{ id: 'old', text: 'EARLIER RAW' }], ocrWords: [] }
const frame = { input: 'pixels-only', width: 200, height: 100, source: 'fixture', previewUrl: 'data:image/png;base64,cGl4ZWxz', sourceBinding: paddleSourceBinding(panel) }
const raw = { image: { width: 200, height: 100 }, items: [{ text: 'BATCH42/MRP27', score: .93, poly: [[10, 10], [180, 10], [180, 30], [10, 30]] }] }
const limits = { initializeMs: 100, passMs: 100, totalMs: 1000 }

async function run(options = {}) {
  const calls = { options: null, disposed: 0, inputs: [] }
  const output = await runPaddleOcr({
    evidenceItems: [panel], limits, inputFactory: async () => frame,
    engineFactory: async factoryOptions => {
      calls.options = factoryOptions
      return { initialize: async () => {}, predict: async input => { calls.inputs.push(input); return [structuredClone(raw)] }, dispose: () => { calls.disposed++ } }
    }, ...options,
  })
  return { output, calls }
}

test('detector profile allowlist is deeply frozen with exactly the two tested threshold pairs', () => {
  assert.deepEqual(PADDLE_DETECTION_PROFILES, { baseline: { textDetThresh: .3, textDetBoxThresh: .6 }, sensitive: { textDetThresh: .2, textDetBoxThresh: .4 } })
  assert.ok(Object.isFrozen(PADDLE_DETECTION_PROFILES))
  for (const value of Object.values(PADDLE_DETECTION_PROFILES)) {
    assert.ok(Object.isFrozen(value))
    assert.throws(() => { value.textDetThresh = 0 }, TypeError)
    assert.ok(Object.values(value).every(number => Number.isFinite(number) && number > 0 && number < 1))
  }
})

test('default run explicitly preserves baseline thresholds, strategy, raw pixels and text', async () => {
  const { output, calls } = await run()
  assert.deepEqual(calls.options, { detectionProfile: 'baseline' })
  assert.ok(Object.isFrozen(calls.options))
  assert.deepEqual(calls.inputs, ['pixels-only'])
  assert.equal(calls.disposed, 1)
  assert.equal(output.detectionProfile, 'baseline')
  assert.deepEqual(output.detectionThresholds, PADDLE_DETECTION_PROFILES.baseline)
  assert.equal(output.items[0].text, raw.items[0].text)
  assert.equal(output.items[0].ocrPasses[0].strategy, 'local-alternative-original')
  assert.equal(output.items[0].detectionProfile, 'baseline')
  assert.deepEqual(output.items[0].ocrPasses[0].detectionThresholds, PADDLE_DETECTION_PROFILES.baseline)
  assert.equal(output.reliability, null)
})

test('sensitive run passes a fixed engine profile and persists it without changing or confirming evidence', async () => {
  const before = structuredClone(panel)
  const { output, calls } = await run({ detectionProfile: 'sensitive' })
  assert.deepEqual(calls.options, { detectionProfile: 'sensitive' })
  assert.deepEqual(output.detectionThresholds, { textDetThresh: .2, textDetBoxThresh: .4 })
  const item = output.items[0]
  assert.equal(item.detectionProfile, 'sensitive')
  assert.equal(item.ocrPasses[0].detectionProfile, 'sensitive')
  assert.equal(item.ocrPasses[0].strategy, 'local-alternative-original-sensitive-detector')
  assert.equal(item.text, raw.items[0].text)
  assert.equal(item.previewUrl, frame.previewUrl)
  assert.equal(item.confirmed, undefined)
  assert.equal(item.eligibleForAutomaticVerdict, undefined)
  const next = preparePaddleAppend({ evidenceItems: [panel], text: 'OFFICER NOTES', rawOcrText: 'EARLIER RAW', output, runId: 'sensitivity-test' })
  assert.equal(next.evidenceItems[0].ocrPasses[0].text, 'EARLIER RAW')
  assert.equal(next.evidenceItems[0].ocrPasses[1].detectionProfile, 'sensitive')
  assert.deepEqual(next.evidenceItems[0].ocrPasses[1].detectionThresholds, PADDLE_DETECTION_PROFILES.sensitive)
  assert.ok(next.rawOcrText.startsWith('EARLIER RAW'))
  assert.deepEqual(panel, before)
})

test('sensitive profile combines with crop and stamp provenance without losing source identity or exceeding strategy bounds', async () => {
  const crop = { x0: .1, y0: .1, x1: .9, y1: .9 }
  const retryMode = { photometric: 'max-rgb-v1', rotation: 90 }
  const { output } = await run({ detectionProfile: 'sensitive', inputFactory: async () => ({ ...frame, crop, retryMode }) })
  const item = output.items[0]
  assert.equal(item.ocrPasses[0].strategy, 'local-alternative-dark-ink-90-focus-sensitive-detector')
  assert.ok(item.ocrPasses[0].strategy.length <= 80)
  assert.deepEqual(item.crop, crop)
  assert.deepEqual(item.retryMode, retryMode)
  assert.deepEqual(item.sourceBinding, paddleSourceBinding(panel))
  assert.deepEqual(item.focusGuidance.suggestions, [])
})

test('invalid detector profiles fail before engine creation or image preparation', async () => {
  let engines = 0; let decodes = 0
  for (const detectionProfile of ['unknown', '__proto__', 'constructor', '', null, 0, {}, { textDetThresh: .1 }, ['sensitive']]) {
    await assert.rejects(runPaddleOcr({ evidenceItems: [panel], detectionProfile, engineFactory: () => { engines++ }, inputFactory: () => { decodes++ } }), /Unknown Paddle detector profile/)
  }
  assert.equal(engines, 0)
  assert.equal(decodes, 0)
})

test('public engine factory refuses arbitrary parameters and unknown profiles before importing the browser SDK', async () => {
  for (const options of [null, [], 0, { textDetThresh: .1 }, { detectionProfile: 'sensitive', textDetBoxThresh: 0 }, { ortOptions: { backend: 'remote' } }]) {
    await assert.rejects(createPaddleEngine(options), /allowlisted detector profile/)
  }
  await assert.rejects(createPaddleEngine({ detectionProfile: 'unexpected' }), /Unknown Paddle detector profile/)
})

test('sensitive mode retains existing panel bounds and hard inference timeout cleanup', async () => {
  let engines = 0; let disposed = 0
  const engineFactory = async () => { engines++; return { initialize: async () => {}, predict: () => new Promise(() => {}), dispose: () => { disposed++ } } }
  await assert.rejects(runPaddleOcr({ evidenceItems: Array.from({ length: 5 }, (_, index) => ({ ...panel, id: `p${index}` })), detectionProfile: 'sensitive', engineFactory }), /one to four/)
  assert.equal(engines, 0)
  await assert.rejects(runPaddleOcr({ evidenceItems: [panel], detectionProfile: 'sensitive', engineFactory, inputFactory: async () => frame, limits: { ...limits, passMs: 5 } }), /timed out/)
  assert.equal(engines, 1)
  assert.equal(disposed, 1)
  assert.equal(panel.ocrText, 'EARLIER RAW')
})
