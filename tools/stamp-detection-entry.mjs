// Development-only detector isolation. No app parser, expected values, product
// metadata, text repair, field confirmation, photometric change or crop.
import { PaddleOCR } from '@paddleocr/paddleocr-js'

const PADDLE_PATH = '/ocr/paddle-v1/'
export const STAMP_PROBE_CONFIGS = Object.freeze({
  baseline: Object.freeze({ textDetThresh: 0.3, textDetBoxThresh: 0.6 }),
  lower: Object.freeze({ textDetThresh: 0.2, textDetBoxThresh: 0.4 }),
})

async function bound(promise, timeoutMs, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs) })]) }
  finally { clearTimeout(timer) }
}

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')

async function originalCanvas(dataUrl) {
  if (!/^data:image\/jpeg;base64,/.test(dataUrl)) throw new Error('Only fixed local JPEG inputs are permitted.')
  const image = new Image()
  await bound(new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = () => reject(new Error('Image decode failed')); image.src = dataUrl
  }), 20000, 'Original image decode')
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 10000 || image.naturalHeight > 10000) throw new Error('Invalid image dimensions.')
  const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas unavailable.')
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  return { canvas, metadata: { originalWidth: image.naturalWidth, originalHeight: image.naturalHeight, width: canvas.width, height: canvas.height, rgbaSha256: hex(await crypto.subtle.digest('SHA-256', pixels)), transform: 'original-colour-max-side-2000-white-background', scale } }
}

export async function probeStampDetection({ dataUrl, configId }) {
  const config = STAMP_PROBE_CONFIGS[configId]
  if (!config) throw new Error('Unknown fixed threshold configuration.')
  const { canvas, metadata } = await originalCanvas(dataUrl)
  const params = { textDetLimitSideLen: 960, textDetLimitType: 'max', textDetMaxSideLimit: 2000, ...config }
  let worker; let engine
  try {
    engine = await PaddleOCR.create({
      initialize: false,
      worker: { enabled: true, createWorker: () => (worker = new Worker(`${PADDLE_PATH}worker.js`, { type: 'module' })) },
      textDetectionModelName: 'PP-OCRv6_small_det', textRecognitionModelName: 'PP-OCRv6_small_rec',
      textDetectionModelAsset: { url: `${PADDLE_PATH}models/PP-OCRv6_small_det_onnx_infer.tar` },
      textRecognitionModelAsset: { url: `${PADDLE_PATH}models/PP-OCRv6_small_rec_onnx_infer.tar` },
      ortOptions: { backend: 'wasm', numThreads: 1, proxy: false, wasmPaths: `${PADDLE_PATH}runtime/` },
      ...params,
    })
    const initializeStart = performance.now()
    await bound(engine.initialize(), 60000, 'Model initialization')
    const initializeMs = Math.round(performance.now() - initializeStart)
    const predictStart = performance.now()
    // Pass prediction parameters explicitly as documented by the installed SDK.
    const outputs = await bound(engine.predict(canvas, params), 90000, 'Detector and recognizer')
    const predictMs = Math.round(performance.now() - predictStart)
    if (!Array.isArray(outputs) || outputs.length !== 1 || !Array.isArray(outputs[0]?.items)) throw new Error('Malformed raw SDK output.')
    if (outputs[0].image.width !== canvas.width || outputs[0].image.height !== canvas.height) throw new Error('Raw SDK output has the wrong frame.')
    return { configId, params, input: metadata, initializeMs, predictMs, originalOutput: outputs[0], rawText: outputs[0].items.map(line => line.text).join('\n') }
  } finally {
    if (engine) await bound(engine.dispose(), 500, 'Worker shutdown').catch(() => {})
    worker?.terminate()
  }
}
