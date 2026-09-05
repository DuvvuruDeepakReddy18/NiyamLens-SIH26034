import { createPaddleInput, createPaddleFocusInput } from './paddleOcr.mjs'

export const PADDLE_RETRY_MODES = Object.freeze({
  'dark-ink': { photometric: 'max-rgb-v1', rotation: 0 },
  'dark-ink-90': { photometric: 'max-rgb-v1', rotation: 90 },
})

// Pixel-only acquisition derivative. This cannot reconstruct hidden ink. It
// suppresses some coloured backgrounds AND can lose coloured declarations.
export function darkInkPixels(data) {
  if (!(data instanceof Uint8ClampedArray) || data.length % 4 || data.length > 6000000 * 4) throw new Error('Dark-ink input requires bounded RGBA pixels.')
  const next = new Uint8ClampedArray(data)
  for (let i = 0; i < next.length; i += 4) {
    const value = Math.max(next[i], next[i + 1], next[i + 2])
    next[i] = next[i + 1] = next[i + 2] = value
  }
  return next
}

export function mapRetryWords(words, { width, height, rotation }, analysisFrame, previousMapper) {
  if (![width, height, analysisFrame?.width, analysisFrame?.height].every(n => Number.isFinite(n) && n > 0 && n <= 10000) || ![0, 90].includes(rotation)) throw new Error('Invalid retry coordinate frame.')
  const restored = words.map(word => {
    const b = word.bbox
    const box = rotation === 90 ? { x0: b.y0, y0: height - b.x1, x1: b.y1, y1: height - b.x0 } : { ...b }
    return { ...word, bbox: box, pageWidth: width, pageHeight: height }
  })
  if (previousMapper) return previousMapper(restored)
  const sx = analysisFrame.width / width, sy = analysisFrame.height / height
  return restored.map(word => ({ ...word, bbox: { x0: word.bbox.x0 * sx, y0: word.bbox.y0 * sy, x1: word.bbox.x1 * sx, y1: word.bbox.y1 * sy }, pageWidth: analysisFrame.width, pageHeight: analysisFrame.height }))
}

export async function createPaddleRetryInput(item, mode, rect = null) {
  if (!Object.hasOwn(PADDLE_RETRY_MODES, mode)) throw new Error('Unknown stamp recovery mode.')
  const retryMode = { ...PADDLE_RETRY_MODES[mode] }
  const base = rect ? await createPaddleFocusInput(item, rect) : await createPaddleInput(item)
  const canvas = document.createElement('canvas')
  canvas.width = retryMode.rotation ? base.height : base.width
  canvas.height = retryMode.rotation ? base.width : base.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable for stamp recovery.')
  if (retryMode.rotation) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2) }
  ctx.drawImage(base.input, 0, 0)
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height)
  rgba.data.set(darkInkPixels(rgba.data)); ctx.putImageData(rgba, 0, 0)
  const previewUrl = canvas.toDataURL('image/png')
  const analysisFrame = { width: item.analysisWidth || item.width || base.width, height: item.analysisHeight || item.height || base.height }
  return { ...base, input: canvas, width: canvas.width, height: canvas.height, previewUrl, retryMode,
    source: `${base.source} · dark ink${retryMode.rotation ? ' · 90° clockwise' : ''}`,
    mapWords: words => mapRetryWords(words, { width: base.width, height: base.height, rotation: retryMode.rotation }, analysisFrame, base.mapWords),
  }
}
