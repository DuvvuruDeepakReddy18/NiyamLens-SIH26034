// Development-only browser experiment. No catalogue, labels, expected answers,
// hosted requests, transcript edits, or automatic field confirmations.
import { PaddleOCR } from '@paddleocr/paddleocr-js'
import { createPaddleInput, parsePaddleOutput, PADDLE_PATH, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'
import { boundedOcr } from '../src/lib/ocrLifecycle.mjs'
import { createPaddleFocusInput } from '../src/lib/paddleOcr.mjs'
import { planPaddleFocus } from '../src/lib/ocrFocusGuidance.mjs'

export async function recognizeDevelopmentPixels(dataUrl, sampleId, profile) {
  if (!['det960', 'det1536', 'det2000', 'quad960', 'ink960', 'ink90', 'focus960'].includes(profile)) throw new Error('Unsupported development profile.')
  const evidence = { id: sampleId, originalUrl: dataUrl, analysisUrl: dataUrl, rotation: 0, perspective: null }
  const full = await createPaddleInput(evidence)
  const frames = []
  if (profile === 'quad960') {
    for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
      const x0 = Math.floor(full.width * (column ? 0.42 : 0)); const y0 = Math.floor(full.height * (row ? 0.42 : 0))
      const x1 = Math.ceil(full.width * (column ? 1 : 0.58)); const y1 = Math.ceil(full.height * (row ? 1 : 0.58))
      const canvas = document.createElement('canvas'); canvas.width = x1 - x0; canvas.height = y1 - y0
      canvas.getContext('2d').drawImage(full.input, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
      frames.push({ input: canvas, width: canvas.width, height: canvas.height, region: { x0, y0, x1, y1 }, sourceFrame: { width: full.width, height: full.height } })
    }
  } else if (profile.startsWith('ink')) {
    // Fixed photometric transform, identical for every image. A dark stamp
    // stays dark while saturated coloured print/background becomes lighter.
    // No segmentation, reconstructed characters or expected answers.
    const canvas = document.createElement('canvas'); const sideways = profile === 'ink90'
    canvas.width = sideways ? full.height : full.width; canvas.height = sideways ? full.width : full.height
    const ctx = canvas.getContext('2d')
    if (sideways) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2) }
    ctx.drawImage(full.input, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const level = Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = level
    }
    ctx.putImageData(pixels, 0, 0)
    frames.push({ input: canvas, width: canvas.width, height: canvas.height, region: null, rotation: sideways ? 90 : 0, photometric: 'max-rgb-dark-ink-v1' })
  } else frames.push({ ...full, region: null })
  let worker; let engine
  try {
    engine = await PaddleOCR.create({ initialize: false, worker: { enabled: true, createWorker: () => (worker = new Worker(`${PADDLE_PATH}worker.js`, { type: 'module' })) },
      textDetectionModelName: 'PP-OCRv6_small_det', textRecognitionModelName: 'PP-OCRv6_small_rec',
      textDetectionModelAsset: { url: `${PADDLE_PATH}models/PP-OCRv6_small_det_onnx_infer.tar` }, textRecognitionModelAsset: { url: `${PADDLE_PATH}models/PP-OCRv6_small_rec_onnx_infer.tar` },
      ortOptions: { backend: 'wasm', numThreads: 1, proxy: false, wasmPaths: `${PADDLE_PATH}runtime/` }, textDetLimitSideLen: profile === 'det1536' ? 1536 : profile === 'det2000' ? 2000 : 960, textDetLimitType: 'max', textDetMaxSideLimit: 2000,
    })
    await boundedOcr(engine.initialize(), { timeoutMs: 60000, label: 'Development model initialize' })
    const observations = []
    for (const frame of frames) {
      const before = performance.now()
      const outputs = await boundedOcr(engine.predict(frame.input), { timeoutMs: 90000, label: 'Development pixel recognition' })
      if (!Array.isArray(outputs) || outputs.length !== 1) throw new Error('Invalid recognition output count.')
      const output = outputs[0]; const parsed = parsePaddleOutput(output, sampleId, frame)
      observations.push({ region: frame.region, rotation: frame.rotation || 0, photometric: frame.photometric || 'original', sourceFrame: frame.sourceFrame || { width: full.width, height: full.height }, elapsedMs: Math.round(performance.now() - before), originalOutput: output, ...parsed })
      if (profile === 'focus960' && !frame.crop) {
        const guidance = planPaddleFocus({ id: sampleId, imageUrl: dataUrl, ...parsed, width: frame.width, height: frame.height })
        for (const suggestion of guidance.suggestions) {
          const focused = await createPaddleFocusInput(evidence, suggestion.rect)
          frames.push({ ...focused, region: suggestion.rect })
        }
      }
    }
    return { model: PADDLE_MODEL, profile, fullFrame: { width: full.width, height: full.height }, observations, rawText: observations.map(observation => observation.text).join('\n\n') }
  } finally {
    if (engine) await boundedOcr(engine.dispose(), { timeoutMs: 500, label: 'Development worker shutdown' }).catch(() => {})
    worker?.terminate()
  }
}
