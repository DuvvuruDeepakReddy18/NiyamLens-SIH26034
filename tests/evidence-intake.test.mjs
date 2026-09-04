import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { inspectImageHeader, inspectEvidenceFile, evidenceFromFile, processImage, reprocessEvidence } from '../src/lib/evidence.mjs'

test('bounded file headers admit real supported formats and reject oversized decoded dimensions before browser decoding', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await sharp({ create: { width: 160, height: 80, channels: 3, background: '#448855' } }).toFormat(format).toBuffer()
    assert.deepEqual(inspectImageHeader(bytes, `image/${format}`), { width: 160, height: 80 })
    assert.deepEqual(await inspectEvidenceFile(new File([bytes], `test.${format}`, { type: `image/${format}` })), { width: 160, height: 80 })
  }
  const oversized = await sharp({ create: { width: 10001, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer()
  // FileReader and Image do not exist in this Node test: rejection must precede them.
  await assert.rejects(evidenceFromFile(new File([oversized], 'huge.png', { type: 'image/png' })), /exceeds 25 megapixels/)
  await assert.rejects(evidenceFromFile(new File(['<svg/>'], 'active.svg', { type: 'image/svg+xml' })), /JPEG, PNG or WebP only/)
  await assert.rejects(inspectEvidenceFile(new File([], 'empty.png', { type: 'image/png' })), /nonempty/)
})

test('cancelled header reads and image decoding settle without publishing an image', async () => {
  const controller = new AbortController()
  const header = inspectEvidenceFile({ type: 'image/jpeg', size: 100, slice: () => ({ arrayBuffer: () => new Promise(() => {}) }) }, { signal: controller.signal })
  controller.abort(); await assert.rejects(header, { name: 'AbortError' })
  const priorImage = globalThis.Image; let instance
  try {
    globalThis.Image = class { constructor() { instance = this } set src(value) { this.url = value } }
    const cancelled = new AbortController(); const output = processImage('data:image/png;base64,AA==', { signal: cancelled.signal })
    cancelled.abort(); await assert.rejects(output, { name: 'AbortError' }); assert.equal(instance.url, '')
  } finally { if (priorImage === undefined) delete globalThis.Image; else globalThis.Image = priorImage }
})

test('processing validates canvas controls before decoding or allocating pixels', async () => {
  for (const options of [{ rotation: 45 }, { maxDimension: 100000 }, { contrast: Infinity }, { maxDimension: 0 }]) await assert.rejects(processImage('not-needed', options), /valid quarter-turn/)
})

test('reprocessing updates analysis dimensions, clears stale OCR and preserves original evidence', async () => {
  const old = { Image: globalThis.Image, document: globalThis.document }
  try {
    globalThis.Image = class { naturalWidth = 4000; naturalHeight = 2000; set src(value) { if (value) queueMicrotask(() => this.onload?.()) } }
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext() { return { save() {}, translate() {}, rotate() {}, drawImage() {}, restore() {}, getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4) }) } }, toDataURL: () => 'data:image/jpeg;base64,RESULT' }) }
    const original = { id: 'panel', originalUrl: 'data:image/jpeg;base64,ORIGINAL', originalWidth: 4000, originalHeight: 2000, analysisUrl: 'old', sha256: 'digest', ocrText: 'stale', connectedOcrText: 'stale', ocrPasses: [{ text: 'stale' }], ocrWords: [], ocrConfidence: 99 }
    const changed = await reprocessEvidence(original, { rotation: 90 })
    assert.equal(changed.analysisWidth, 1100); assert.equal(changed.analysisHeight, 2200)
    assert.equal(changed.width, 1100); assert.equal(changed.height, 2200)
    assert.equal(changed.originalUrl, original.originalUrl); assert.equal(changed.sha256, 'digest')
    assert.equal(changed.originalWidth, 4000); assert.equal(changed.ocrText, undefined); assert.equal(changed.connectedOcrText, undefined); assert.equal(changed.ocrPasses, undefined)
    assert.equal(original.ocrText, 'stale')
  } finally { for (const key of ['Image', 'document']) { if (old[key] === undefined) delete globalThis[key]; else globalThis[key] = old[key] } }
})
