import { requireMember, quota, failure } from '../server/security.mjs'
const MAX_BASE64_LENGTH = 4_000_000
const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate'

const send = (res, status, payload) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  return res.status(status).json(payload)
}

export function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('A JPEG, PNG or WebP data URL is required.')
  if (match[1].length > MAX_BASE64_LENGTH) throw new Error('The connected-OCR image exceeds the 3 MB transfer limit. Crop the declaration panel first.')
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

const visionWordText = (word) => (word.symbols || []).map((symbol) => symbol.text || '').join('').trim()

export function normalizeVisionAnnotation(annotation = {}) {
  const words = []
  const confidences = []
  for (const page of annotation.fullTextAnnotation?.pages || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        const paragraphText = (paragraph.words || []).map(visionWordText).filter(Boolean).join(' ')
        for (const word of paragraph.words || []) {
          const text = visionWordText(word)
          if (!text) continue
          const confidence = Number(word.confidence || paragraph.confidence || block.confidence || 0) * 100
          if (confidence > 0) confidences.push(confidence)
          words.push({
            text,
            lineText: paragraphText,
            confidence: Number(confidence.toFixed(1)),
            bbox: verticesToBox(word.boundingBox?.vertices),
            pageWidth: Number(page.width || 1),
            pageHeight: Number(page.height || 1),
          })
        }
      }
    }
  }
  const confidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0
  return { text: String(annotation.fullTextAnnotation?.text || annotation.textAnnotations?.[0]?.description || '').trim(), confidence: Number(confidence.toFixed(1)), words }
}

export function createOcrHandler({ authorize = requireMember, limit = quota } = {}) {
return async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { configured: Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY), provider: 'google-vision', mode: 'explicit-opt-in' })
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY
  if (!apiKey) return send(res, 503, { error: 'Connected OCR is not configured. Add GOOGLE_CLOUD_VISION_API_KEY to the server environment.' })
  try {
    const context = await authorize(req)
    await limit(context, 'connected-ocr', 10, 100)
    const content = parseImageDataUrl(req.body?.image)
    const response = await fetch(GOOGLE_VISION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({ requests: [{ image: { content }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: languageHints(req.body?.language) } }] }),
      signal: AbortSignal.timeout(25_000),
    })
    const payload = await response.json()
    if (!response.ok) return send(res, response.status, { error: payload.error?.message || 'Google Vision rejected the OCR request.' })
    const annotation = payload.responses?.[0] || {}
    if (annotation.error) return send(res, 502, { error: annotation.error.message || 'Google Vision could not process the image.' })
    const result = normalizeVisionAnnotation(annotation)
    if (!result.text) return send(res, 422, { error: 'Connected OCR found no readable text. Retake or crop the declaration panel.' })
    return send(res, 200, { ...result, provider: 'google-vision', retention: 'NiyamLens does not persist the transferred image.' })
  } catch (error) {
    if (error.status) return failure(res, error)
    const status = /required|exceeds/i.test(error.message || '') ? 400 : 502
    return send(res, status, { error: error.message || 'Connected OCR failed.' })
  }
}
}
export default createOcrHandler()
