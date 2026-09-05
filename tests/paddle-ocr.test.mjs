import test from 'node:test'
import assert from 'node:assert/strict'
import { createPaddleInput, createPaddleFocusInput, paddleSourceBinding, parsePaddleOutput, runPaddleOcr, preparePaddleAppend, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'

const panel = { id: 'p1', name: 'real.jpg', originalUrl: 'data:image/jpeg;base64,b3JpZ2luYWw=', analysisUrl: 'same-photo', rotation: 0, perspective: null, grayscale: false, contrast: 112, width: 100, height: 80, analysisWidth: 100, analysisHeight: 80, originalWidth: 100, originalHeight: 80, ocrText: 'ORIGINAL', ocrPasses: [{ id: 'old', text: 'ORIGINAL' }], ocrWords: [] }
const box = [[2, 2], [50, 2], [50, 15], [2, 15]]
const exactPreview = 'data:image/png;base64,cGl4ZWxzLW9ubHk='
const frame = { input: 'pixels-only', width: 100, height: 80, source: 'fixture', previewUrl: exactPreview, sourceBinding: paddleSourceBinding(panel) }
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
  assert.equal(output.items[0].previewUrl, exactPreview)
  assert.deepEqual(output.items[0].sourceBinding, paddleSourceBinding(panel))
  assert.equal(output.items[0].focusGuidance.method, 'heading-guided-focus-v1')
  assert.equal(panel.ocrText, 'ORIGINAL')
})

test('Paddle refuses an injected frame unless its PNG preview and source binding match the current evidence', async () => {
  let predictions = 0
  const engine = { initialize: async () => {}, predict: async () => { predictions++; return [result()] } }
  await assert.rejects(run({ engine, inputFactory: async () => ({ ...frame, sourceBinding: undefined }) }), /not bound/)
  await assert.rejects(run({ engine, inputFactory: async () => ({ ...frame, previewUrl: 'data:image/jpeg;base64,bm90LXBuZw==' }) }), /not bound/)
  await assert.rejects(run({ engine, inputFactory: async () => ({ ...frame, sourceBinding: paddleSourceBinding({ ...panel, originalUrl: 'changed-original' }) }) }), /not bound/)
  assert.equal(predictions, 0)
})

test('Paddle snapshots the exact bounded input canvas as a lossless PNG for officer review', async () => {
  const savedImage = globalThis.Image; const savedDocument = globalThis.document
  let drawn = null; let encodedAfterDraw = false
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: (...args) => { drawn = args } }),
    toDataURL: type => { assert.equal(type, 'image/png'); encodedAfterDraw = Boolean(drawn); return exactPreview },
  }
  class TestImage {
    constructor() { this.naturalWidth = 400; this.naturalHeight = 200 }
    set src(value) { this.value = value; queueMicrotask(() => this.onload?.()) }
    get src() { return this.value }
  }
  try {
    globalThis.Image = TestImage
    globalThis.document = { createElement: tag => { assert.equal(tag, 'canvas'); return canvas } }
    const input = await createPaddleInput(panel, 200)
    assert.equal(input.input, canvas)
    assert.equal(input.width, 200); assert.equal(input.height, 100)
    assert.equal(input.previewUrl, exactPreview)
    assert.equal(input.source, 'original-resolution-bounded')
    assert.equal(encodedAfterDraw, true)
    assert.deepEqual(drawn.slice(1), [0, 0, 200, 100])
    assert.deepEqual(input.sourceBinding, paddleSourceBinding(panel))
  } finally {
    if (savedImage === undefined) delete globalThis.Image; else globalThis.Image = savedImage
    if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument
  }
})

test('focused Paddle review keeps the second-stage exact input PNG instead of the crop source URL', async () => {
  const savedImage = globalThis.Image; const savedDocument = globalThis.document
  const dimensions = new Map(); const encoded = []
  class TestImage {
    set src(value) {
      this.value = value
      const size = dimensions.get(value) || { width: 100, height: 80 }
      this.naturalWidth = size.width; this.naturalHeight = size.height
      queueMicrotask(() => this.onload?.())
    }
    get src() { return this.value }
  }
  try {
    globalThis.Image = TestImage
    globalThis.document = { createElement: tag => {
      assert.equal(tag, 'canvas')
      const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: '', filter: '', fillRect: () => {}, drawImage: () => {} }) }
      canvas.toDataURL = type => {
        assert.equal(type, 'image/png')
        const url = `data:image/png;base64,${Buffer.from(`canvas-${encoded.length}`).toString('base64')}`
        dimensions.set(url, { width: canvas.width, height: canvas.height }); encoded.push(url); return url
      }
      return canvas
    } }
    const input = await createPaddleFocusInput(panel, { x0: .1, y0: .1, x1: .8, y1: .8 })
    assert.equal(encoded.length, 4)
    assert.equal(input.previewUrl, encoded[3])
    assert.notEqual(input.previewUrl, encoded[0])
    assert.match(input.source, /^officer-selected-/)
    assert.deepEqual(input.sourceBinding, paddleSourceBinding(panel))
  } finally {
    if (savedImage === undefined) delete globalThis.Image; else globalThis.Image = savedImage
    if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument
  }
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
  const cropPreview = 'data:image/png;base64,Y3JvcC1waXhlbHM='
  const { output } = await run({ inputFactory: async () => ({ ...frame, crop, source: 'officer-selected-original-resolution', previewUrl: cropPreview, mapWords: words => words.map(word => ({ ...word, bbox: { x0: 200, y0: 300, x1: 400, y1: 450 }, pageWidth: 1000, pageHeight: 1000 })) }) })
  const item = output.items[0]
  assert.equal(item.imageUrl, 'same-photo')
  assert.equal(item.previewUrl, cropPreview)
  assert.equal(item.ocrWords[0].pageWidth, 1000)
  assert.deepEqual(item.lines[0].box, box)
  assert.equal(item.ocrPasses[0].strategy, 'local-alternative-officer-focus')
  assert.deepEqual(item.crop, crop)
  assert.equal(item.focusGuidance.suggestions.length, 0)
  assert.match(item.focusGuidance.withheld[0].reason, /already_focused/)
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
  assert.throws(() => preparePaddleAppend({ ...request, evidenceItems: [{ ...panel, originalUrl: 'data:image/jpeg;base64,bmV3LW9yaWdpbmFs' }] }), /image changed/)
  assert.throws(() => preparePaddleAppend({ ...request, evidenceItems: [{ ...panel, rotation: 90 }] }), /image changed/)
  assert.throws(() => preparePaddleAppend({ ...request, evidenceItems: [{ ...panel, perspective: { method: 'changed' } }] }), /image changed/)
  assert.throws(() => preparePaddleAppend({ ...request, text: 'x'.repeat(100000) }), /limit/)
  const next = preparePaddleAppend(request)
  assert.throws(() => preparePaddleAppend({ ...request, evidenceItems: next.evidenceItems }), /Duplicate/)
})
