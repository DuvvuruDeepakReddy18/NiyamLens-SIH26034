import test from 'node:test'
import assert from 'node:assert/strict'
import { createOcrHandler, languageHints, normalizeVisionAnnotation, parseImageDataUrl } from '../api/ocr.js'
const handler = createOcrHandler({ authorize: async () => ({}), limit: async () => {} })

const responseRecorder = () => ({
  statusCode: 0,
  payload: null,
  headers: {},
  setHeader(name, value) { this.headers[name] = value },
  status(value) { this.statusCode = value; return this },
  json(value) { this.payload = value; return this },
})

test('connected OCR validates image payloads and language hints', () => {
  assert.equal(parseImageDataUrl('data:image/jpeg;base64,YWJj'), 'YWJj')
  assert.deepEqual(languageHints('eng+hin+eng'), ['en', 'hi'])
  assert.throws(() => parseImageDataUrl('https://example.com/private.jpg'), /data URL/i)
})

test('connected OCR normalizes Google words without returning the raw response', () => {
  const result = normalizeVisionAnnotation({ fullTextAnnotation: { text: 'MRP 48', pages: [{ width: 200, height: 100, blocks: [{ paragraphs: [{ words: [{ confidence: .9, boundingBox: { vertices: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 40 }, { x: 10, y: 40 }] }, symbols: [{ text: 'M' }, { text: 'R' }, { text: 'P' }] }] }] }] }] } })
  assert.equal(result.text, 'MRP 48')
  assert.equal(result.confidence, 90)
  assert.equal(result.words[0].lineText, 'MRP')
  assert.deepEqual(result.words[0].bbox, { x0: 10, y0: 20, x1: 50, y1: 40 })
})

test('connected OCR remains unavailable when the server secret is absent', async () => {
  const previous = process.env.GOOGLE_CLOUD_VISION_API_KEY
  delete process.env.GOOGLE_CLOUD_VISION_API_KEY
  const response = responseRecorder()
  await handler({ method: 'POST', body: { image: 'data:image/jpeg;base64,YWJj' } }, response)
  assert.equal(response.statusCode, 503)
  assert.match(response.payload.error, /not configured/i)
  if (previous) process.env.GOOGLE_CLOUD_VISION_API_KEY = previous
})

test('connected OCR sends only base64 content and returns normalized evidence', async () => {
  const previousKey = process.env.GOOGLE_CLOUD_VISION_API_KEY
  const previousFetch = globalThis.fetch
  process.env.GOOGLE_CLOUD_VISION_API_KEY = 'server-only-test-key'
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) }
    return { ok: true, status: 200, json: async () => ({ responses: [{ fullTextAnnotation: { text: 'NET QTY 100 g', pages: [] } }] }) }
  }
  const response = responseRecorder()
  await handler({ method: 'POST', body: { image: 'data:image/jpeg;base64,YWJj', language: 'eng+tel' } }, response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.text, 'NET QTY 100 g')
  assert.deepEqual(request.body.requests[0].imageContext.languageHints, ['en', 'te'])
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'server-only-test-key')
  assert.doesNotMatch(request.options.body, /data:image/)
  globalThis.fetch = previousFetch
  if (previousKey) process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey
  else delete process.env.GOOGLE_CLOUD_VISION_API_KEY
})

test('connected OCR rejects an empty recognition as a retake instead of a successful scan', async () => {
  const previousKey = process.env.GOOGLE_CLOUD_VISION_API_KEY
  const previousFetch = globalThis.fetch
  try {
    process.env.GOOGLE_CLOUD_VISION_API_KEY = 'server-only-test-key'
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ responses: [{}] }) })
    const response = responseRecorder()
    await handler({ method: 'POST', body: { image: 'data:image/jpeg;base64,YWJj' } }, response)
    assert.equal(response.statusCode, 422)
    assert.match(response.payload.error, /no readable text/i)
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey) process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey
    else delete process.env.GOOGLE_CLOUD_VISION_API_KEY
  }
})
