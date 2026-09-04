import { analyzeImageQuality, rectifyPerspective, rectifyPlaneFromReference } from './vision.mjs'

export const EVIDENCE_LIMITS = Object.freeze({ bytes: 15 * 1024 * 1024, pixels: 25000000, axis: 10000, headerBytes: 1024 * 1024 })
const checkAbort = (signal) => { if (signal?.aborted) throw signal.reason || new DOMException('Image operation cancelled.', 'AbortError') }
const waitFor = (promise, signal, timeoutMs = 15000) => new Promise((resolve, reject) => {
  let timer
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  const abort = () => { cleanup(); reject(signal.reason || new DOMException('Image operation cancelled.', 'AbortError')) }
  Promise.resolve(promise).then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  if (signal?.aborted) { abort(); return }
  signal?.addEventListener('abort', abort, { once: true })
  timer = setTimeout(() => { cleanup(); reject(new Error('Image processing timed out. Original evidence was not replaced.')) }, timeoutMs)
})
const bounds = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > EVIDENCE_LIMITS.axis || height > EVIDENCE_LIMITS.axis || width * height > EVIDENCE_LIMITS.pixels) throw new Error('Image exceeds 25 megapixels or 10,000 pixels per side. Export a smaller original or crop it before upload.')
  return { width, height }
}
// Parse only a bounded header before creating Image/FileReader or a canvas. This
// is a resource guard, not a replacement for browser/server full-image decoding.
export function inspectImageHeader(input, mime) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end))
  if (mime === 'image/png' && bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && ascii(12, 16) === 'IHDR') return bounds(view.getUint32(16), view.getUint32(20))
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if ([216, 217, 218].includes(marker)) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) return bounds(view.getUint16(offset + 5), view.getUint16(offset + 3))
      offset += length
    }
  }
  if (mime === 'image/webp' && bytes.length >= 30 && ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') {
    const chunk = ascii(12, 16)
    if (chunk === 'VP8X') {
      if (bytes[20] & 2) throw new Error('Animated images are not supported as package evidence.')
      const read24 = (i) => bytes[i] | bytes[i+1] << 8 | bytes[i+2] << 16
      return bounds(1 + read24(24), 1 + read24(27))
    }
    if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) return bounds(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383)
    if (chunk === 'VP8L' && bytes[20] === 47) return bounds(1 + (bytes[21] | (bytes[22] & 63) << 8), 1 + ((bytes[22] >> 6) | bytes[23] << 2 | (bytes[24] & 15) << 10))
  }
  throw new Error('Image type or dimensions could not be verified from its header. Use a complete JPEG, PNG or WebP image.')
}
export async function inspectEvidenceFile(file, { signal } = {}) {
  checkAbort(signal)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) throw new Error('Package uploads accept JPEG, PNG or WebP only. Convert HEIC, GIF or SVG before capture.')
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > EVIDENCE_LIMITS.bytes) throw new Error('Evidence must be a nonempty image no larger than 15 MB.')
  const header = await waitFor(file.slice(0, EVIDENCE_LIMITS.headerBytes).arrayBuffer(), signal)
  return inspectImageHeader(header, file.type)
}
const readAsDataUrl = (file, { signal } = {}) => new Promise((resolve, reject) => {
  checkAbort(signal)
  const reader = new FileReader()
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reader.onload = reader.onerror = reader.onabort = null }
  const abort = () => { cleanup(); reader.abort(); reject(signal?.reason || new DOMException('Image read cancelled.', 'AbortError')) }
  const timer = setTimeout(() => { cleanup(); reader.abort(); reject(new Error('Image read timed out. Retake or select the file again.')) }, 15000)
  signal?.addEventListener('abort', abort, { once: true })
  reader.onload = () => { cleanup(); resolve(String(reader.result)) }
  reader.onerror = () => { cleanup(); reject(reader.error || new Error('Unable to read the image.')) }
  reader.onabort = () => { cleanup(); reject(new DOMException('Image read cancelled.', 'AbortError')) }
  try { reader.readAsDataURL(file) } catch (error) { cleanup(); reject(error) }
})

const loadImage = (url, { signal } = {}) => new Promise((resolve, reject) => {
  checkAbort(signal)
  const image = new Image()
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = image.onerror = null }
  const abort = () => { cleanup(); image.src = ''; reject(signal?.reason || new DOMException('Image decode cancelled.', 'AbortError')) }
  const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('Image decoding timed out. Use a smaller complete image.')) }, 15000)
  signal?.addEventListener('abort', abort, { once: true })
  image.onload = () => { cleanup(); resolve(image) }
  image.onerror = () => { cleanup(); reject(new Error('The selected image could not be decoded.')) }
  try { image.src = url } catch (error) { cleanup(); reject(error) }
})

const toHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

export async function sha256File(file, { signal } = {}) {
  checkAbort(signal)
  if (!globalThis.crypto?.subtle) throw new Error('Secure image hashing is unavailable. Open the app over HTTPS or localhost before capturing evidence.')
  const buffer = await waitFor(file.arrayBuffer(), signal)
  return toHex(await waitFor(globalThis.crypto.subtle.digest('SHA-256', buffer), signal))
}

async function renderImage(sourceUrl, options = {}) {
  const { rotation = 0, grayscale = false, contrast = 112, maxDimension = 2200, signal } = options
  if (!Number.isFinite(rotation) || rotation % 90 !== 0 || !Number.isFinite(contrast) || contrast < 0 || contrast > 300 || !Number.isInteger(maxDimension) || maxDimension < 1 || maxDimension > 4400) throw new Error('Use a valid quarter-turn rotation, contrast and bounded output size.')
  const image = await loadImage(sourceUrl, { signal })
  checkAbort(signal)
  const radians = ((rotation % 360) * Math.PI) / 180
  const quarterTurn = Math.abs(rotation % 180) === 90
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  bounds(sourceWidth, sourceHeight)
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale))
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = quarterTurn ? drawHeight : drawWidth
  canvas.height = quarterTurn ? drawWidth : drawHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('This browser could not allocate an image canvas.')
  context.save()
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(radians)
  context.filter = `${grayscale ? 'grayscale(1)' : 'grayscale(0)'} contrast(${contrast}%)`
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
  context.restore()
  checkAbort(signal)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height, sourceWidth, sourceHeight }
}
export async function processImage(sourceUrl, options = {}) { return (await renderImage(sourceUrl, options)).dataUrl }

export async function evidenceFromFile(file, options = {}) {
  await inspectEvidenceFile(file, options)
  const originalUrl = await readAsDataUrl(file, options)
  const rendered = await renderImage(originalUrl, options)
  const analysisUrl = rendered.dataUrl
  const sha256 = await sha256File(file, options)
  const quality = await waitFor(analyzeImageQuality(analysisUrl), options.signal)
  checkAbort(options.signal)
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    type: file.type,
    size: file.size,
    width: rendered.width,
    height: rendered.height,
    analysisWidth: rendered.width, analysisHeight: rendered.height,
    originalWidth: rendered.sourceWidth, originalHeight: rendered.sourceHeight,
    quality,
    sha256,
    originalUrl,
    analysisUrl,
    rotation: 0,
    grayscale: false,
    contrast: 112,
    capturedAt: new Date().toISOString(),
  }
}

const clearRecognition = (evidence) => {
  const { ocrText, connectedOcrText, ocrConfidence, ocrReliability, ocrAgreement, ocrWords, ocrPasses, ocrProvider, ...rest } = evidence
  return rest
}
export async function reprocessEvidence(evidence, changes, { signal } = {}) {
  const next = { ...clearRecognition(evidence), ...changes }
  const rendered = await renderImage(next.perspectiveBaseUrl || next.originalUrl, { ...next, signal })
  next.analysisUrl = rendered.dataUrl
  next.width = next.analysisWidth = rendered.width; next.height = next.analysisHeight = rendered.height
  next.quality = await waitFor(analyzeImageQuality(next.analysisUrl), signal)
  checkAbort(signal)
  return next
}

export async function rectifyEvidence(evidence, points, { signal } = {}) {
  checkAbort(signal)
  const flattened = await waitFor(rectifyPerspective(evidence.analysisUrl, points), signal)
  const quality = await waitFor(analyzeImageQuality(flattened.dataUrl), signal)
  checkAbort(signal)
  return {
    ...clearRecognition(evidence),
    analysisUrl: flattened.dataUrl,
    perspectiveBaseUrl: flattened.dataUrl,
    perspective: { method: 'four-point-homography', points: flattened.sourcePoints, width: flattened.width, height: flattened.height },
    width: flattened.width,
    height: flattened.height,
    analysisWidth: flattened.width, analysisHeight: flattened.height,
    rotation: 0,
    grayscale: false,
    contrast: 100,
    quality,
  }
}

const BARCODE_ASPECTS = { ean_13: 37.29 / 25.93, upc_a: 37.29 / 25.93, ean_8: 26.73 / 21.31, qr_code: 1 }

export async function rectifyEvidenceFromBarcode(evidence, barcode, { signal } = {}) {
  checkAbort(signal)
  if (barcode?.cornerPoints?.length !== 4) throw new Error('This browser did not return four barcode corners.')
  const flattened = await waitFor(rectifyPlaneFromReference(evidence.analysisUrl, barcode.cornerPoints, BARCODE_ASPECTS[barcode.format] || 0), signal)
  const quality = await waitFor(analyzeImageQuality(flattened.dataUrl), signal)
  checkAbort(signal)
  return {
    ...clearRecognition(evidence),
    analysisUrl: flattened.dataUrl,
    perspectiveBaseUrl: flattened.dataUrl,
    perspective: { method: 'barcode-plane-homography', format: barcode.format, points: flattened.sourcePoints, width: flattened.width, height: flattened.height },
    width: flattened.width,
    height: flattened.height,
    analysisWidth: flattened.width, analysisHeight: flattened.height,
    rotation: 0,
    grayscale: false,
    contrast: 100,
    quality,
  }
}

export async function detectBarcode(imageUrl) {
  if (!('BarcodeDetector' in globalThis)) return { supported: false, values: [] }
  const detector = new globalThis.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] })
  const image = await loadImage(imageUrl)
  const results = await detector.detect(image)
  return {
    supported: true,
    values: results.map((item) => ({
      value: item.rawValue,
      format: item.format,
      cornerPoints: Array.from(item.cornerPoints || [], (point) => ({ x: Number(point.x), y: Number(point.y) })),
      boundingBox: item.boundingBox
        ? { x: Number(item.boundingBox.x), y: Number(item.boundingBox.y), width: Number(item.boundingBox.width), height: Number(item.boundingBox.height) }
        : null,
    })),
  }
}
