import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedOcr } from '../src/lib/ocrLifecycle.mjs'
import { runLocalOcr } from '../src/lib/ocrRunner.mjs'

const items = [{ id: 'panel', name: 'fixture.jpg', analysisUrl: 'test', quality: { score: 70 } }]
const variants = async () => [{ id: 'plain', dataUrl: 'test', pageSegmentationMode: '6', width: 100, height: 100 }]
const options = { evidenceItems: items, variantFactory: variants, limits: { initializeMs: 100, passMs: 100, totalMs: 1000 } }
test('OCR publishes complete results and always disposes its worker', async () => {
  let terminated = 0
  const workerFactory = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text: 'NET QTY 100 g', confidence: 84 } }), terminate: async () => { terminated++ } })
  const result = await runLocalOcr({ ...options, workerFactory })
  assert.match(result.text, /NET QTY 100 g/)
  assert.equal(terminated, 1)
  assert.equal(items[0].ocrText, undefined)
})
test('cancelling pending recognition terminates worker and does not publish partial evidence', async () => {
  const controller = new AbortController(); let terminated = 0
  const workerFactory = async () => ({ setParameters: async () => {}, recognize: () => { controller.abort(); return new Promise(() => {}) }, terminate: async () => { terminated++ } })
  await assert.rejects(runLocalOcr({ ...options, workerFactory, signal: controller.signal }), { name: 'AbortError' })
  assert.equal(terminated, 1)
})
test('late initialized workers are disposed after cancellation', async () => {
  const controller = new AbortController(); let resolveWorker; let terminated = 0
  const pending = new Promise((resolve) => { resolveWorker = resolve })
  const task = boundedOcr(pending, { signal: controller.signal, onLateResolve: (worker) => worker.terminate() })
  controller.abort(); await assert.rejects(task, { name: 'AbortError' })
  resolveWorker({ terminate: () => { terminated++ } }); await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(terminated, 1)
})
test('stuck engine operation times out instead of locking the inspection', async () => {
  let terminated = 0
  const workerFactory = async () => ({ setParameters: () => new Promise(() => {}), terminate: async () => { terminated++ } })
  await assert.rejects(runLocalOcr({ ...options, limits: { ...options.limits, passMs: 5 }, workerFactory }), /timed out/)
  assert.equal(terminated, 1)
})
test('empty OCR is not published as successful evidence', async () => {
  const workerFactory = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text: '', confidence: 99 } }), terminate: async () => {} })
  await assert.rejects(runLocalOcr({ ...options, workerFactory }), /No readable OCR/)
})

test('oversized raw OCR is rejected before a trailing conflicting declaration can be truncated', async () => {
  let terminated = 0
  const text = 'NET QTY 5 g\n' + 'NOISE\n'.repeat(17000) + 'NET QTY 100 g'
  const workerFactory = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text, confidence: 90 } }), terminate: async () => { terminated++ } })
  await assert.rejects(runLocalOcr({ ...options, workerFactory }), /text.*limit|oversized/i)
  assert.equal(terminated, 1)
})

test('a new local scan cannot inherit stale connected provider or transcript provenance', async () => {
  const old = { ...items[0], ocrProvider: 'google-vision', connectedOcrText: 'OLD CONNECTED', ocrPasses: [{ id: 'old', text: 'OLD CONNECTED' }] }
  const workerFactory = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text: 'NEW LOCAL', confidence: Infinity } }), terminate: async () => {} })
  const result = await runLocalOcr({ ...options, evidenceItems: [old], workerFactory })
  assert.equal(result.items[0].connectedOcrText, undefined)
  assert.equal(result.items[0].ocrProvider, 'tesseract.js')
  assert.equal(result.items[0].ocrPasses[0].provider, 'tesseract.js')
  assert.equal(result.engineConfidence, 0)
  assert.equal(old.connectedOcrText, 'OLD CONNECTED')
})

test('oversized nested OCR word output is rejected and the worker is terminated', async () => {
  let terminated = 0
  const blocks = [{ paragraphs: [{ lines: [{ text: 'MRP', words: Array.from({ length: 12001 }, () => ({ text: 'MRP' })) }] }] }]
  const workerFactory = async () => ({ setParameters: async () => {}, recognize: async () => ({ data: { text: 'MRP40', confidence: 99, blocks } }), terminate: async () => { terminated++ } })
  await assert.rejects(runLocalOcr({ ...options, workerFactory }), /word.*limit/i)
  assert.equal(terminated, 1)
})
