import { adminClient, requireMember, quota, failure, HttpError } from '../server/security.mjs'
import { validateImageBytes } from '../server/imageValidation.mjs'
const MAX_BASE64_LENGTH = 4_000_000
const MAX_RESPONSE_BYTES = 8_000_000
const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate'

const send = (res, status, payload) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.status(status).json(payload)
}

export function parseImageDataUrl(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'A JPEG, PNG or WebP data URL is required.')
  if (value.length > MAX_BASE64_LENGTH + 40) throw new HttpError(413, 'The connected-OCR image exceeds the 3 MB transfer limit. Crop the declaration panel first.')
  const match = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) throw new HttpError(400, 'A JPEG, PNG or WebP data URL is required.')
  if (match[1].length > MAX_BASE64_LENGTH || match[1].length % 4 !== 0 || Buffer.from(match[1], 'base64').toString('base64') !== match[1]) throw new HttpError(400, 'The image must contain canonical base64 data within the 3 MB transfer limit.')
  return match[1]
}

export function languageHints(value) {
  const map = { eng: 'en', hin: 'hi', tel: 'te', tam: 'ta' }
  return [...new Set(String(value || 'eng').split('+').map((language) => map[language]).filter(Boolean))]
}

const verticesToBox = (vertices = []) => {
  const points = vertices
    .map((vertex) => ({ x: Number(vertex?.x), y: Number(vertex?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (!points.length) return { x0: 0, y0: 0, x1: 0, y1: 0 }

  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x), 0),
    y1: Math.max(...points.map((point) => point.y), 0),
  }
}

const responseError = () => new HttpError(502, 'The OCR provider returned malformed or oversized data. Local evidence was preserved.')
const list = (value, max = 20000) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > max) throw responseError(); return value }
const visionWordText = (word) => { if (!word || typeof word !== 'object') throw responseError(); return list(word.symbols, 1000).map((symbol) => typeof symbol?.text === 'string' ? symbol.text : '').join('').trim() }
const confidenceValue = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null

export function normalizeVisionAnnotation(annotation = {}) {
  const words = []
  const confidences = []
  let visited = 0
  for (const page of list(annotation.fullTextAnnotation?.pages, 4)) {
    for (const block of list(page?.blocks)) {
      for (const paragraph of list(block?.paragraphs)) {
        const paragraphWords = list(paragraph?.words)
        const paragraphText = paragraphWords.map(visionWordText).filter(Boolean).join(' ')
        if (paragraphText.length > 100000) throw responseError()
        for (const word of paragraphWords) {
          if (++visited > 20000 || !word || typeof word !== 'object') throw responseError()
          const text = visionWordText(word)
          if (!text) continue
          // Zero is a real provider observation, not permission to substitute a
          // paragraph/block score. Missing confidence remains explicitly unknown.
          const score = confidenceValue(word.confidence ?? paragraph.confidence ?? block.confidence)
          const confidence = score === null ? null : Number((score * 100).toFixed(1))
          if (score !== null) confidences.push(confidence)
          words.push({
            text,
            lineText: paragraphText,
            confidence,
            bbox: verticesToBox(list(word.boundingBox?.vertices, 8)),
            pageWidth: Number.isFinite(page.width) && page.width > 0 ? page.width : 1,
            pageHeight: Number.isFinite(page.height) && page.height > 0 ? page.height : 1,
          })
        }
      }
    }
  }
  const confidenceAvailable = words.length > 0 && confidences.length === words.length
  const confidence = confidenceAvailable ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0
  const text = annotation.fullTextAnnotation?.text ?? annotation.textAnnotations?.[0]?.description ?? ''
  if (typeof text !== 'string' || text.length > 100000) throw responseError()
  return { text: text.trim(), confidence: Number(confidence.toFixed(1)), confidenceAvailable, words }
}

const abortable = (promise, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason || new DOMException('OCR cancelled.', 'AbortError'))
  Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  if (signal.aborted) { abort(); return }
  signal.addEventListener('abort', abort, { once: true })
})
async function readProviderJson(response, signal) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body?.getReader) throw responseError()
  const reader = response.body.getReader(); const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      size += value.byteLength; if (size > MAX_RESPONSE_BYTES) throw responseError()
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) } catch { throw responseError() }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
export function createOcrHandler({ authorize = (req) => requireMember(req, [], adminClient({ signal: req.signal, timeoutMs: 27000 })), limit = quota, timeoutMs = 27000 } = {}) {
return async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { configured: Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY), provider: 'google-vision', mode: 'explicit-opt-in' })
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY
  if (!apiKey) return send(res, 503, { error: 'Connected OCR is not configured. Add GOOGLE_CLOUD_VISION_API_KEY to the server environment.' })
  const cancellation = new AbortController()
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([deadline, cancellation.signal, ...(req.signal ? [req.signal] : [])])
  const aborted = () => cancellation.abort(new DOMException('OCR request cancelled.', 'AbortError'))
  const disconnected = () => { if (!res.writableEnded) aborted() }
  req.once?.('aborted', aborted); res.once?.('close', disconnected)
  try {
    const scopedReq = Object.create(req); Object.defineProperty(scopedReq, 'signal', { value: signal })
    const context = await abortable(authorize(scopedReq), signal)
    await abortable(limit(context, 'connected-ocr', 10, 100), signal)
    const content = parseImageDataUrl(req.body?.image)
    const mime = req.body.image.slice(5, req.body.image.indexOf(';')).replace('image/jpg', 'image/jpeg')
    await abortable(validateImageBytes(Buffer.from(content, 'base64'), mime), signal)
    const response = await abortable(fetch(GOOGLE_VISION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({ requests: [{ image: { content }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: languageHints(req.body?.language) } }] }),
      signal,
    }), signal)
    const payload = await readProviderJson(response, signal)
    if (!response.ok) return send(res, response.status === 429 ? 429 : 502, { error: response.status === 429 ? 'Connected OCR is rate-limited. Retry later; local evidence is preserved.' : 'The OCR provider rejected the request. Check server configuration or retry with a clearer crop.' })
    const annotation = payload.responses?.[0] || {}
    if (annotation.error) return send(res, 502, { error: 'The OCR provider could not process this image. Local evidence is preserved.' })
    const result = normalizeVisionAnnotation(annotation)
    if (!result.text) return send(res, 422, { error: 'Connected OCR found no readable text. Retake or crop the declaration panel.' })
    return send(res, 200, { ...result, provider: 'google-vision', retention: 'NiyamLens does not persist the transferred image.' })
  } catch (error) {
    if (res.destroyed || res.writableEnded) return
    if (signal.aborted) return send(res, deadline.aborted ? 504 : 499, { error: deadline.aborted ? 'Connected OCR timed out. Local evidence was preserved; retry a smaller crop or use browser OCR.' : 'OCR was cancelled. Local evidence was preserved.' })
    if (error.status) return failure(res, error)
    const status = /required|exceeds/i.test(error.message || '') ? 400 : 502
    return send(res, status, { error: status === 400 ? error.message : 'Connected OCR is temporarily unavailable. Local evidence was preserved.' })
  } finally { req.off?.('aborted', aborted); res.off?.('close', disconnected) }
}
}
export default createOcrHandler()
