import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePaddleOutput, runPaddleOcr, preparePaddleAppend, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'

const panel = { id: 'p1', name: 'real.jpg', analysisUrl: 'same-photo', ocrText: 'ORIGINAL', ocrPasses: [{ id: 'old', text: 'ORIGINAL' }], ocrWords: [] }
const box = [[2, 2], [50, 2], [50, 15], [2, 15]]
const frame = { input: 'pixels-only', width: 100, height: 80, source: 'fixture' }
const result = (text = 'NET QTY. 100 g') => ({ image: { width: 100, height: 80 }, items: [{ text, score: .9, poly: box }] })
const limits = { initializeMs: 100, passMs: 100, totalMs: 1000 }
async function run(overrides = {}) {
  let disposed = 0
  const engine = { initialize: async () => {}, predict: async () => [result()], dispose: () => { disposed++ }, ...(overrides.engine || {}) }
  const output = await runPaddleOcr({ evidenceItems: [panel], inputFactory: async () => frame, engineFactory: async () => engine, limits, ...overrides })
  return { output, disposed }
}

test('Paddle preserves exact raw line text/polygons and identifies line geometry, not physical glyphs', () => {
  const input = result('MRP ₹ 22O.00')
  const parsed = parsePaddleOutput(input, panel.id, frame)
  assert.equal(parsed.text, 'MRP ₹ 22O.00')
  assert.equal(parsed.words[0].geometryKind, 'line-box-not-glyph')
  assert.deepEqual(parsed.lines[0].box, box)
  parsed.lines[0].box[0][0] = 99
  assert.equal(input.items[0].poly[0][0], 2)
})

test('Paddle rejects malformed, mismatched and unbounded outputs without text repair', () => {
  for (const change of [r => { r.image.width = 99 }, r => { r.items[0].score = NaN }, r => { r.items[0].score = 2 }, r => { r.items[0].poly[0][0] = -1 }, r => { r.items[0].poly[0][0] = 101 }, r => { r.items[0].text = 'x'.repeat(513) }, r => { r.items[0].text = 'A\nB' }, r => { r.items = Array(1001).fill(r.items[0]) }]) {
    const value = structuredClone(result()); change(value)
    assert.throws(() => parsePaddleOutput(value, panel.id, frame))
  }
})

test('Paddle runner disposes the engine, has real provider provenance and no invented reliability', async () => {
  const { output, disposed } = await run()
  assert.equal(disposed, 1)
  assert.equal(output.model, PADDLE_MODEL)
  assert.equal(output.reliability, null)
  assert.equal(output.items[0].ocrPasses[0].text, 'NET QTY. 100 g')
  assert.equal(output.items[0].ocrPasses[0].provider, 'paddleocr-js')
  assert.equal(panel.ocrText, 'ORIGINAL')
})

test('Paddle initialization cancellation disposes the already-created worker', async () => {
  let disposed = 0; const controller = new AbortController()
  const engineFactory = async () => ({ initialize: () => { controller.abort(); return new Promise(() => {}) }, dispose: () => { disposed++ } })
  await assert.rejects(runPaddleOcr({ evidenceItems: [panel], engineFactory, limits, signal: controller.signal }), { name: 'AbortError' })
  assert.equal(disposed, 1)
})

test('Paddle recognition timeout disposes worker without publishing partial panels', async () => {
  let disposed = 0
  const engineFactory = async () => ({ initialize: async () => {}, predict: () => new Promise(() => {}), dispose: () => { disposed++ } })
  await assert.rejects(runPaddleOcr({ evidenceItems: [panel], engineFactory, inputFactory: async () => frame, limits: { ...limits, passMs: 5 } }), /timed out/)
  assert.equal(disposed, 1)
})

test('focused Paddle maps overlay boxes to the full panel and records crop provenance separately', async () => {
  const crop = { x0: .2, y0: .3, x1: .6, y1: .7 }
  const { output } = await run({ inputFactory: async () => ({ ...frame, crop, source: 'officer-selected-original-resolution', previewUrl: 'crop-pixels', mapWords: words => words.map(word => ({ ...word, bbox: { x0: 200, y0: 300, x1: 400, y1: 450 }, pageWidth: 1000, pageHeight: 1000 })) }) })
  const item = output.items[0]
  assert.equal(item.imageUrl, 'same-photo')
  assert.equal(item.previewUrl, 'crop-pixels')
  assert.equal(item.ocrWords[0].pageWidth, 1000)
  assert.deepEqual(item.lines[0].box, box)
  assert.equal(item.ocrPasses[0].strategy, 'local-alternative-officer-focus')
  assert.deepEqual(item.crop, crop)
  const next = preparePaddleAppend({ evidenceItems: [panel], text: '', rawOcrText: '', output, runId: 'crop-run' })
  assert.match(next.rawOcrText, /PADDLE FOCUSED RAW OCR/)
})

test('empty and malformed Paddle pages are not completed readings', async () => {
  await assert.rejects(run({ engine: { predict: async () => [result('')] } }), /no readable/)
  await assert.rejects(run({ engine: { predict: async () => [] } }), /page count/)
  await assert.rejects(run({ evidenceItems: [panel, panel] }), /uniquely/)
})

test('alternative OCR appends without overwriting corrections or prior raw passes', async () => {
  const { output } = await run()
  const next = preparePaddleAppend({ evidenceItems: [panel], text: 'OFFICER CORRECTION', rawOcrText: 'ORIGINAL', output, runId: 'run-1' })
  assert.ok(next.text.startsWith('OFFICER CORRECTION'))
  assert.ok(next.rawOcrText.startsWith('ORIGINAL'))
  assert.equal(next.evidenceItems[0].ocrPasses.length, 2)
  assert.equal(next.evidenceItems[0].ocrPasses[0].text, 'ORIGINAL')
  assert.equal(panel.ocrPasses.length, 1)
  assert.equal(next.evidenceItems[0].ocrPasses[1].id, 'p1:paddle-original:run-1')
})

test('layout suggestions cannot change any raw token or enter original OCR transcript', async () => {
  const value = result('PACKED ON:')
  value.items.push({ text: '02/08/2026', score: .9, poly: [[55, 2], [98, 2], [98, 15], [55, 15]] })
  const { output } = await run({ engine: { predict: async () => [value] } })
  const proposal = { panelId: panel.id, sourceIds: ['p1:line-0', 'p1:line-1'], text: 'PACKED ON: 02/08/2026' }
  const request = { evidenceItems: [panel], text: '', rawOcrText: '', output, runId: 'run-2', proposedRows: [proposal] }
  const next = preparePaddleAppend(request)
  assert.match(next.text, /OFFICER-SELECTED LAYOUT/)
  assert.doesNotMatch(next.rawOcrText, /OFFICER-SELECTED LAYOUT/)
  assert.equal(next.reviewedRows[0].parts[1].text, '02/08/2026')
  assert.throws(() => preparePaddleAppend({ ...request, proposedRows: [{ ...proposal, text: 'PACKED ON: 03/08/2026' }] }), /changed/)
})

test('stale images, repeated runs and overflowing OCR history are rejected atomically', async () => {
  const { output } = await run()
  const request = { evidenceItems: [panel], text: '', rawOcrText: '', output, runId: 'run-3' }
  assert.throws(() => preparePaddleAppend({ ...request, evidenceItems: [{ ...panel, analysisUrl: 'new-photo' }] }), /image changed/)
  assert.throws(() => preparePaddleAppend({ ...request, text: 'x'.repeat(100000) }), /limit/)
  const next = preparePaddleAppend(request)
  assert.throws(() => preparePaddleAppend({ ...request, evidenceItems: next.evidenceItems }), /Duplicate/)
})
