import test from 'node:test'
import assert from 'node:assert/strict'
import { createOcrHandler, languageHints, normalizeVisionAnnotation, parseImageDataUrl } from '../api/ocr.js'
import sharp from 'sharp'
const handler = createOcrHandler({ authorize: async () => ({}), limit: async () => {} })
const fixture = `data:image/png;base64,${(await sharp({ create: { width: 32, height: 24, channels: 3, background: '#477744' } }).png().toBuffer()).toString('base64')}`
const providerResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

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
    return providerResponse({ responses: [{ fullTextAnnotation: { text: 'NET QTY 100 g', pages: [] } }] })
  }
  const response = responseRecorder()
  await handler({ method: 'POST', body: { image: fixture, language: 'eng+tel' } }, response)
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
    globalThis.fetch = async () => providerResponse({ responses: [{}] })
    const response = responseRecorder()
    await handler({ method: 'POST', body: { image: fixture } }, response)
    assert.equal(response.statusCode, 422)
    assert.match(response.payload.error, /no readable text/i)
  } finally {
    globalThis.fetch = previousFetch
    if (previousKey) process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey
    else delete process.env.GOOGLE_CLOUD_VISION_API_KEY
  }
})

test('zero confidence is retained instead of replaced by a high paragraph score', () => {
  const result = normalizeVisionAnnotation({ fullTextAnnotation: { text: 'UNCERTAIN CLEAR', pages: [{ width: 100, height: 100, blocks: [{ confidence: 1, paragraphs: [{ confidence: 1, words: [{ confidence: 0, symbols: [{ text: 'UNCERTAIN' }] }, { confidence: 1, symbols: [{ text: 'CLEAR' }] }] }] }] }] } })
  assert.equal(result.words[0].confidence, 0); assert.equal(result.confidence, 50)
  const unknown = normalizeVisionAnnotation({ fullTextAnnotation: { text: 'UNKNOWN CLEAR', pages: [{ blocks: [{ paragraphs: [{ words: [{ symbols: [{ text: 'UNKNOWN' }] }, { confidence: 1, symbols: [{ text: 'CLEAR' }] }] }] }] }] } })
  assert.equal(unknown.words[0].confidence, null); assert.equal(unknown.confidenceAvailable, false); assert.equal(unknown.confidence, 0)
})

test('malformed or oversized provider output is rejected rather than returned as reliable evidence', () => {
  for (const annotation of [{ fullTextAnnotation: { text: 'x'.repeat(100001) } }, { fullTextAnnotation: { pages: {} } }, { fullTextAnnotation: { pages: [{ blocks: [{ paragraphs: [{ words: [null] }] }] }] } }]) assert.throws(() => normalizeVisionAnnotation(annotation), { status: 502 })
})

test('invalid image data is fully decoded before any connected provider request', async () => {
  const previousKey = process.env.GOOGLE_CLOUD_VISION_API_KEY; const previousFetch = globalThis.fetch
  try {
    process.env.GOOGLE_CLOUD_VISION_API_KEY = 'test-only'
    let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Must not run') }
    for (const image of ['data:image/jpeg;base64,YWJj', 'data:image/jpeg;base64,/9j/', 'data:image/png;base64,====']) {
      const res = responseRecorder(); await handler({ method: 'POST', body: { image } }, res)
      assert.ok([400, 422].includes(res.statusCode)); assert.equal(calls, 0)
    }
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY; else process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey }
})

test('one deadline bounds authorization, stalled provider headers and stalled response bodies', async () => {
  const previousKey = process.env.GOOGLE_CLOUD_VISION_API_KEY; const previousFetch = globalThis.fetch
  const keepAlive = setInterval(() => {}, 100)
  try {
    process.env.GOOGLE_CLOUD_VISION_API_KEY = 'test-only'
    for (const phase of ['auth', 'headers', 'body']) {
      globalThis.fetch = async () => phase === 'headers' ? new Promise(() => {}) : new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } })
      const bounded = createOcrHandler({ authorize: phase === 'auth' ? () => new Promise(() => {}) : async () => ({}), limit: async () => {}, timeoutMs: 30 })
      const res = responseRecorder(); await bounded({ method: 'POST', body: { image: fixture } }, res)
      assert.equal(res.statusCode, 504, phase); assert.match(res.payload.error, /preserved/i)
    }
    const signal = AbortSignal.abort(new DOMException('User cancelled', 'AbortError'))
    const res = responseRecorder(); await handler({ method: 'POST', signal, body: { image: fixture } }, res)
    assert.equal(res.statusCode, 499)
  } finally { clearInterval(keepAlive); globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY; else process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey }
})

test('provider body size and error details are bounded without exposing provider messages', async () => {
  const previousKey = process.env.GOOGLE_CLOUD_VISION_API_KEY; const previousFetch = globalThis.fetch
  try {
    process.env.GOOGLE_CLOUD_VISION_API_KEY = 'test-only'
    globalThis.fetch = async () => new Response('{}', { headers: { 'Content-Length': '9000000' } })
    const oversized = responseRecorder(); await handler({ method: 'POST', body: { image: fixture } }, oversized); assert.equal(oversized.statusCode, 502)
    globalThis.fetch = async () => providerResponse({ error: { message: 'private provider configuration detail' } }, 403)
    const denied = responseRecorder(); await handler({ method: 'POST', body: { image: fixture } }, denied)
    assert.equal(denied.statusCode, 502); assert.doesNotMatch(denied.payload.error, /private provider/)
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY; else process.env.GOOGLE_CLOUD_VISION_API_KEY = previousKey }
})
