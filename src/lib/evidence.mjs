import { analyzeImageQuality, rectifyPerspective, rectifyPlaneFromReference } from './vision.mjs'

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error || new Error('Unable to read the image.'))
  reader.readAsDataURL(file)
})

const loadImage = (url) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('The selected image could not be decoded.'))
  image.src = url
})

const toHex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

export async function sha256File(file) {
  if (!globalThis.crypto?.subtle) return ''
  const buffer = await file.arrayBuffer()
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', buffer))
}

export async function processImage(sourceUrl, options = {}) {
  const { rotation = 0, grayscale = false, contrast = 112, maxDimension = 2200 } = options
  const image = await loadImage(sourceUrl)
  const radians = ((rotation % 360) * Math.PI) / 180
  const quarterTurn = Math.abs(rotation % 180) === 90
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const drawWidth = Math.round(sourceWidth * scale)
  const drawHeight = Math.round(sourceHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = quarterTurn ? drawHeight : drawWidth
  canvas.height = quarterTurn ? drawWidth : drawHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.save()
  context.translate(canvas.width / 2, canvas.height / 2)
  context.rotate(radians)
  context.filter = `${grayscale ? 'grayscale(1)' : 'grayscale(0)'} contrast(${contrast}%)`
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
  context.restore()
  return canvas.toDataURL('image/jpeg', 0.9)
}

export async function evidenceFromFile(file) {
  if (!file?.type?.startsWith('image/')) throw new Error(`${file?.name || 'File'} is not an image.`)
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} exceeds the 15 MB evidence limit.`)
  const originalUrl = await readAsDataUrl(file)
  const [analysisUrl, sha256, quality] = await Promise.all([
    processImage(originalUrl),
    sha256File(file),
    analyzeImageQuality(originalUrl),
  ])
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    type: file.type,
    size: file.size,
    width: quality.width,
    height: quality.height,
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

export async function reprocessEvidence(evidence, changes) {
  const next = { ...evidence, ...changes }
  next.analysisUrl = await processImage(next.perspectiveBaseUrl || next.originalUrl, next)
  next.quality = await analyzeImageQuality(next.analysisUrl)
  return next
}

export async function rectifyEvidence(evidence, points) {
  const flattened = await rectifyPerspective(evidence.analysisUrl, points)
  const quality = await analyzeImageQuality(flattened.dataUrl)
  return {
    ...evidence,
    analysisUrl: flattened.dataUrl,
    perspectiveBaseUrl: flattened.dataUrl,
    perspective: { method: 'four-point-homography', points: flattened.sourcePoints, width: flattened.width, height: flattened.height },
    width: flattened.width,
    height: flattened.height,
    rotation: 0,
    grayscale: false,
    contrast: 100,
    quality,
  }
}

const BARCODE_ASPECTS = { ean_13: 37.29 / 25.93, upc_a: 37.29 / 25.93, ean_8: 26.73 / 21.31, qr_code: 1 }

export async function rectifyEvidenceFromBarcode(evidence, barcode) {
  if (barcode?.cornerPoints?.length !== 4) throw new Error('This browser did not return four barcode corners.')
  const flattened = await rectifyPlaneFromReference(evidence.analysisUrl, barcode.cornerPoints, BARCODE_ASPECTS[barcode.format] || 0)
  const quality = await analyzeImageQuality(flattened.dataUrl)
  return {
    ...evidence,
    analysisUrl: flattened.dataUrl,
    perspectiveBaseUrl: flattened.dataUrl,
    perspective: { method: 'barcode-plane-homography', format: barcode.format, points: flattened.sourcePoints, width: flattened.width, height: flattened.height },
    width: flattened.width,
    height: flattened.height,
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
