import { boundedOcr, OCR_LIMITS, ocrController, throwIfAborted } from './ocrLifecycle.mjs'
import { OCR_OUTPUT_LIMITS, validateOcrHistory, validateOcrWords, appendOcrHistory } from './ocrHistory.mjs'
import { createFocusedVariants } from './focusOcr.mjs'
import { planPaddleFocus } from './ocrFocusGuidance.mjs'
import { buildPaddleWorkingAddition, buildStructuredPaddleAddition } from './paddleWorkingText.mjs'

export const PADDLE_MODEL = 'PP-OCRv6_small@paddleocr-js-0.4.2'
export const PADDLE_PATH = '/ocr/paddle-v1/'
// Fixed choices, not an open-ended model parameter surface. Lower thresholds
// can recover faint stamps but also detect more noise; never use them by default.
export const PADDLE_DETECTION_PROFILES = Object.freeze({
  baseline: Object.freeze({ textDetThresh: 0.3, textDetBoxThresh: 0.6 }),
  sensitive: Object.freeze({ textDetThresh: 0.2, textDetBoxThresh: 0.4 }),
})

function detectionThresholds(profile) {
  if (typeof profile !== 'string' || !Object.hasOwn(PADDLE_DETECTION_PROFILES, profile)) throw new Error('Unknown Paddle detector profile. Choose baseline or sensitive.')
  return PADDLE_DETECTION_PROFILES[profile]
}

const ORIGINAL_IMAGE = /^data:image\/(jpeg|png|webp);base64,/

// A Paddle preview is temporary, but appending it must still prove that both
// possible pixel sources and the transform state are the same as at run time.
// Keep the snapshot as primitives so later mutation cannot rewrite it in place.
export function paddleSourceBinding(item) {
  if (typeof item?.analysisUrl !== 'string' || !item.analysisUrl) throw new Error('Paddle OCR requires a bound analysis image.')
  const originalUrl = typeof item.originalUrl === 'string' ? item.originalUrl : null
  const transform = JSON.stringify({
    rotation: item.rotation ?? 0,
    perspective: item.perspective ?? null,
    grayscale: item.grayscale ?? false,
    contrast: item.contrast ?? null,
    analysisWidth: item.analysisWidth ?? item.width ?? null,
    analysisHeight: item.analysisHeight ?? item.height ?? null,
    originalWidth: item.originalWidth ?? null,
    originalHeight: item.originalHeight ?? null,
  })
  return { schemaVersion: 1, originalUrl, analysisUrl: item.analysisUrl, inputKind: !item.perspective && !item.rotation && ORIGINAL_IMAGE.test(originalUrl || '') ? 'original' : 'analysis', transform }
}

const samePaddleSource = (left, right) => left?.schemaVersion === 1 && right?.schemaVersion === 1
  && left.originalUrl === right.originalUrl && left.analysisUrl === right.analysisUrl
  && left.inputKind === right.inputKind && left.transform === right.transform

// initialize:false gives us a disposable worker BEFORE the potentially slow
// model load. No remote image service, CDN fallback or inferred accuracy score.
export async function createPaddleEngine(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'detectionProfile')) throw new Error('Paddle engine accepts only an allowlisted detector profile, not arbitrary model parameters.')
  const profile = options.detectionProfile === undefined ? 'baseline' : options.detectionProfile
  const thresholds = detectionThresholds(profile)
  const predictionOptions = Object.freeze({ textDetLimitSideLen: 960, textDetLimitType: 'max', textDetMaxSideLimit: 2000, ...thresholds })
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
  let ownedWorker
  const engine = await PaddleOCR.create({
    initialize: false,
    worker: { enabled: true, createWorker: () => (ownedWorker = new Worker(`${PADDLE_PATH}worker.js`, { type: 'module' })) },
    textDetectionModelName: 'PP-OCRv6_small_det',
    textRecognitionModelName: 'PP-OCRv6_small_rec',
    textDetectionModelAsset: { url: `${PADDLE_PATH}models/PP-OCRv6_small_det_onnx_infer.tar` },
    textRecognitionModelAsset: { url: `${PADDLE_PATH}models/PP-OCRv6_small_rec_onnx_infer.tar` },
    ortOptions: { backend: 'wasm', numThreads: 1, proxy: false, wasmPaths: `${PADDLE_PATH}runtime/` },
    ...predictionOptions,
  })
  return {
    initialize: () => engine.initialize(), predict: input => engine.predict(input, predictionOptions),
    dispose: async () => {
      // SDK graceful disposal alone waits for a busy inference worker. Retain
      // ownership so cancellation also stops CPU/memory use after a hard bound.
      const timer = setTimeout(() => ownedWorker?.terminate(), 250)
      try { await boundedOcr(engine.dispose(), { timeoutMs: 500, label: 'Paddle worker shutdown' }).catch(() => {}) }
      finally { clearTimeout(timer); ownedWorker?.terminate() }
    },
  }
}

export async function createPaddleInput(item, maxSide = 2000) {
  // Retain the inspection's current rotation/perspective. Upscaling cannot
  // recover absent pixels, so use the original only for an untransformed panel.
  const sourceBinding = paddleSourceBinding(item)
  const original = sourceBinding.inputKind === 'original'
  const url = original ? item.originalUrl : item.analysisUrl
  if (typeof url !== 'string' || !ORIGINAL_IMAGE.test(url)) throw new Error('Paddle OCR requires a captured local image.')
  const image = await new Promise((resolve, reject) => {
    const target = new Image()
    const timer = setTimeout(() => { target.src = ''; reject(new Error('OCR image decoding timed out.')) }, 20000)
    target.onload = () => { clearTimeout(timer); resolve(target) }
    target.onerror = () => { clearTimeout(timer); reject(new Error('Unable to decode the captured image.')) }
    target.src = url
  })
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 10000 || image.naturalHeight > 10000) throw new Error('OCR image dimensions exceed the evidence limit.')
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable for local OCR.')
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  // The reviewer must see the exact bounded pixels passed to the engine. PNG is
  // lossless and snapshotting does not alter the canvas supplied as `input`.
  const previewUrl = canvas.toDataURL('image/png')
  if (!/^data:image\/png;base64,/.test(previewUrl)) throw new Error('Unable to preserve the exact Paddle input preview.')
  return { input: canvas, width: canvas.width, height: canvas.height, source: original ? 'original-resolution-bounded' : 'analysis-derivative', previewUrl, sourceBinding }
}

export async function createPaddleFocusInput(item, rect) {
  const sourceBinding = paddleSourceBinding(item)
  const [variant] = await createFocusedVariants(item, rect)
  // Preserve the crop's exact coordinate frame; its maximum side is 2248 px.
  const frame = await createPaddleInput({ ...item, originalUrl: variant.dataUrl, analysisUrl: variant.dataUrl, perspective: null, rotation: 0 }, 2400)
  return { ...frame, source: `officer-selected-${variant.source}`, sourceBinding, crop: rect, mapWords: variant.mapWords }
}

export function parsePaddleOutput(result, panelId, frame) {
  if (!result || !Array.isArray(result.items) || result.items.length > 1000) throw new Error('Paddle OCR returned too many or malformed text lines.')
  if (!['width', 'height'].every(key => Number.isFinite(frame?.[key]) && frame[key] > 0 && frame[key] <= 10000)) throw new Error('Paddle OCR image dimensions are invalid.')
  if (result.image?.width !== frame.width || result.image?.height !== frame.height) throw new Error('OCR output does not match its source image dimensions.')
  const lines = result.items.map((line, index) => {
    if (typeof line?.text !== 'string' || line.text.length > OCR_OUTPUT_LIMITS.wordLength || /[\r\n]/.test(line.text)) throw new Error('Paddle OCR returned malformed or overlong line text.')
    if (!Array.isArray(line.poly) || line.poly.length !== 4 || line.poly.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'number' || !Number.isFinite(n)) || p[0] < 0 || p[1] < 0 || p[0] > frame.width || p[1] > frame.height)) throw new Error('Paddle OCR returned out-of-image polygons.')
    if (typeof line.score !== 'number' || !Number.isFinite(line.score) || line.score < 0 || line.score > 1) throw new Error('Paddle OCR returned an invalid engine score.')
    return { id: `${panelId}:line-${index}`, panelId, text: line.text, confidence: line.score, box: line.poly.map(p => [...p]) }
  })
  const text = lines.map(line => line.text).join('\n')
  if (text.length > OCR_OUTPUT_LIMITS.textPerPass) throw new Error('Paddle OCR text exceeds the evidence limit.')
  const words = lines.filter(line => line.text).map(line => ({ panelId, text: line.text, lineText: line.text, confidence: line.confidence * 100, bbox: { x0: Math.min(...line.box.map(p => p[0])), y0: Math.min(...line.box.map(p => p[1])), x1: Math.max(...line.box.map(p => p[0])), y1: Math.max(...line.box.map(p => p[1])) }, pageWidth: frame.width, pageHeight: frame.height, geometryKind: 'line-box-not-glyph' }))
  validateOcrWords(words)
  return { text, words, lines, confidence: lines.length ? lines.reduce((sum, line) => sum + line.confidence * 100, 0) / lines.length : null }
}

export async function runPaddleOcr({ evidenceItems, signal, onProgress = () => {}, engineFactory = createPaddleEngine, inputFactory = createPaddleInput, limits = OCR_LIMITS, detectionProfile = 'baseline' }) {
  const thresholds = detectionThresholds(detectionProfile)
  if (!Array.isArray(evidenceItems) || evidenceItems.length < 1 || evidenceItems.length > 4 || evidenceItems.some(item => typeof item?.id !== 'string' || !item.id) || new Set(evidenceItems.map(item => item.id)).size !== evidenceItems.length) throw new Error('Paddle OCR requires one to four uniquely identified panels.')
  const job = ocrController(signal, limits.totalMs)
  let engine
  const update = (progress, label) => { if (!job.signal.aborted) onProgress({ running: true, progress, label, error: '' }) }
  try {
    throwIfAborted(job.signal)
    update(2, 'Loading Paddle OCR locally — first load may take a minute')
    engine = await boundedOcr(engineFactory(Object.freeze({ detectionProfile })), { signal: job.signal, timeoutMs: limits.initializeMs, label: 'Paddle worker creation', onLateResolve: late => late?.dispose() })
    await boundedOcr(engine.initialize(), { signal: job.signal, timeoutMs: limits.initializeMs, label: 'Paddle model initialization' })
    const items = []
    for (let index = 0; index < evidenceItems.length; index++) {
      throwIfAborted(job.signal)
      const item = evidenceItems[index]
      update(10 + Math.round(index / evidenceItems.length * 85), `Paddle OCR · panel ${index + 1}/${evidenceItems.length}`)
      const frame = await boundedOcr(inputFactory(item), { signal: job.signal, timeoutMs: limits.passMs, label: 'Paddle image preparation' })
      const sourceBinding = paddleSourceBinding(item)
      if (!samePaddleSource(frame?.sourceBinding, sourceBinding) || typeof frame?.previewUrl !== 'string' || !/^data:image\/png;base64,/.test(frame.previewUrl)) throw new Error('Paddle input preview is not bound to the current evidence pixels.')
      if (frame.retryMode && (frame.retryMode.photometric !== 'max-rgb-v1' || ![0, 90].includes(frame.retryMode.rotation))) throw new Error('Invalid Paddle retry provenance.')
      const output = await boundedOcr(engine.predict(frame.input), { signal: job.signal, timeoutMs: limits.passMs, label: 'Paddle recognition' })
      throwIfAborted(job.signal)
      if (!Array.isArray(output) || output.length !== 1) throw new Error('Paddle OCR returned an invalid page count.')
      const parsed = parsePaddleOutput(output[0], item.id, frame)
      const words = frame.mapWords ? frame.mapWords(parsed.words) : parsed.words
      validateOcrWords(words)
      const sourceStrategy = frame.retryMode ? `local-alternative-dark-ink-${frame.retryMode.rotation}${frame.crop ? '-focus' : ''}` : frame.crop ? 'local-alternative-officer-focus' : 'local-alternative-original'
      const strategy = `${sourceStrategy}${detectionProfile === 'sensitive' ? '-sensitive-detector' : ''}`
      const reading = { id: item.id, imageUrl: item.analysisUrl, previewUrl: frame.previewUrl, sourceBinding, crop: frame.crop || null, retryMode: frame.retryMode || null, detectionProfile, detectionThresholds: thresholds, source: frame.source, width: frame.width, height: frame.height, ...parsed,
        ocrPasses: [{ id: `${item.id}:paddle-${frame.crop ? 'focus' : 'original'}`, text: parsed.text, confidence: parsed.confidence, provider: 'paddleocr-js', model: PADDLE_MODEL, strategy, detectionProfile, detectionThresholds: thresholds }], ocrWords: words }
      // Rotated preview polygons are in the retry frame, not the captured
      // analysis frame. Never offer them as a crop on a different orientation.
      reading.focusGuidance = frame.retryMode?.rotation ? { method: 'heading-guided-focus-v1', suggestions: [], withheld: [{ reason: 'rotated_retry_select_region_on_original_or_recapture' }] } : planPaddleFocus(reading)
      items.push(reading)
      validateOcrHistory(items)
    }
    if (!items.some(item => item.text.trim())) throw new Error('Paddle OCR found no readable text. Previous evidence was preserved.')
    throwIfAborted(job.signal)
    return { items, model: PADDLE_MODEL, provider: 'paddleocr-js', reliability: null, detectionProfile, detectionThresholds: thresholds }
  } finally {
    job.dispose()
    if (engine) await boundedOcr(Promise.resolve().then(() => engine.dispose()), { timeoutMs: 2000, label: 'Paddle cleanup' }).catch(() => {})
  }
}

// Pure, atomic append preparation. A caller must record its audit event before
// publishing this state. Raw transcripts never include geometry-derived text.
export function preparePaddleAppend({ evidenceItems, text = '', rawOcrText = '', output, runId, proposedRows = [], structured = false }) {
  if (typeof text !== 'string' || typeof rawOcrText !== 'string' || typeof runId !== 'string' || !runId || runId.length > 80 || !Array.isArray(output?.items) || !output.items.length) throw new Error('Invalid alternative OCR append request.')
  if (new Set(output.items.map(item => item.id)).size !== output.items.length) throw new Error('Duplicate alternative OCR panels.')
  if (!Array.isArray(proposedRows) || proposedRows.length > 50) throw new Error('Too many layout proposals.')
  if (typeof structured !== 'boolean' || (structured && proposedRows.length)) throw new Error('Machine candidates must be computed from the actual source geometry, not supplied as answers.')
  const nextItems = [...evidenceItems]
  for (const item of output.items) {
    const index = nextItems.findIndex(panel => panel.id === item.id)
    if (index < 0 || nextItems[index].analysisUrl !== item.imageUrl || !samePaddleSource(item.sourceBinding, paddleSourceBinding(nextItems[index]))) throw new Error('The image changed since this OCR preview. Run OCR again.')
    if (typeof item.text !== 'string' || item.text.length > OCR_OUTPUT_LIMITS.textPerPass) throw new Error('Invalid Paddle transcript.')
    nextItems[index] = appendOcrHistory(nextItems[index], { text: [nextItems[index].ocrText, item.text].filter(Boolean).join('\n\n'), passes: item.ocrPasses.map(pass => ({ ...pass, id: `${pass.id}:${runId}` })), words: item.ocrWords })
  }
  const { rawAddition, workingAddition, reviewedRows, candidateRows, workingMappings, warnings = [] } = structured
    ? buildStructuredPaddleAddition(output.items, evidenceItems.map(item => item.id))
    : buildPaddleWorkingAddition(output.items, proposedRows, evidenceItems.map(item => item.id))
  if (text.length + workingAddition.length > 100000 || rawOcrText.length + rawAddition.length > 100000) throw new Error('Alternative OCR would exceed the evidence text limit.')
  validateOcrHistory(nextItems)
  return { text: text + workingAddition, rawOcrText: rawOcrText + rawAddition, evidenceItems: nextItems, words: nextItems.flatMap(panel => panel.ocrWords || []), reviewedRows, candidateRows, warnings, workingMappings }
}
