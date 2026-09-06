import { createPaddleInput, createPaddleFocusInput } from './paddleOcr.mjs'

export const PADDLE_RETRY_MODES = Object.freeze({
  'dark-ink': Object.freeze({ photometric: 'max-rgb-v1', rotation: 0 }),
  'dark-ink-90': Object.freeze({ photometric: 'max-rgb-v1', rotation: 90 }),
  'dark-ink-180': Object.freeze({ photometric: 'max-rgb-v1', rotation: 180 }),
  'dark-ink-270': Object.freeze({ photometric: 'max-rgb-v1', rotation: 270 }),
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
  if (![width, height, analysisFrame?.width, analysisFrame?.height].every(n => Number.isFinite(n) && n > 0 && n <= 10000) || ![0, 90, 180, 270].includes(rotation)) throw new Error('Invalid retry coordinate frame.')
  const restored = words.map(word => {
    const b = word.bbox
    // Width and height belong to the unrotated input (including any crop
    // border), not to the retry canvas. Undo this one transform before the
    // existing crop mapper removes its border and restores the source frame.
    let box
    switch (rotation) {
      case 90: box = { x0: b.y0, y0: height - b.x1, x1: b.y1, y1: height - b.x0 }; break
      case 180: box = { x0: width - b.x1, y0: height - b.y1, x1: width - b.x0, y1: height - b.y0 }; break
      case 270: box = { x0: width - b.y1, y0: b.x0, x1: width - b.y0, y1: b.x1 }; break
      default: box = { ...b }
    }
    return { ...word, bbox: box, pageWidth: width, pageHeight: height }
  })
  if (previousMapper) return previousMapper(restored)
  const sx = analysisFrame.width / width, sy = analysisFrame.height / height
  return restored.map(word => ({ ...word, bbox: { x0: word.bbox.x0 * sx, y0: word.bbox.y0 * sy, x1: word.bbox.x1 * sx, y1: word.bbox.y1 * sy }, pageWidth: analysisFrame.width, pageHeight: analysisFrame.height }))
}

export async function createPaddleRetryInput(item, mode, rect = null) {
  if (typeof mode !== 'string' || !Object.hasOwn(PADDLE_RETRY_MODES, mode)) throw new Error('Unknown stamp recovery mode.')
  const retryMode = { ...PADDLE_RETRY_MODES[mode] }
  const base = rect ? await createPaddleFocusInput(item, rect) : await createPaddleInput(item)
  const canvas = document.createElement('canvas')
  const quarterTurn = retryMode.rotation === 90 || retryMode.rotation === 270
  canvas.width = quarterTurn ? base.height : base.width
  canvas.height = quarterTurn ? base.width : base.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable for stamp recovery.')
  switch (retryMode.rotation) {
    case 90: ctx.translate(base.height, 0); ctx.rotate(Math.PI / 2); break
    case 180: ctx.translate(base.width, base.height); ctx.rotate(Math.PI); break
    case 270: ctx.translate(0, base.width); ctx.rotate(3 * Math.PI / 2); break
  }
  ctx.drawImage(base.input, 0, 0)
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height)
  rgba.data.set(darkInkPixels(rgba.data)); ctx.putImageData(rgba, 0, 0)
  const previewUrl = canvas.toDataURL('image/png')
  if (!/^data:image\/png;base64,/.test(previewUrl)) throw new Error('Unable to preserve the exact stamp recovery input preview.')
  const analysisFrame = { width: item.analysisWidth || item.width || base.width, height: item.analysisHeight || item.height || base.height }
  return { ...base, input: canvas, width: canvas.width, height: canvas.height, previewUrl, retryMode,
    source: `${base.source} · dark ink${retryMode.rotation ? ` · ${retryMode.rotation}° clockwise` : ''}`,
    mapWords: words => mapRetryWords(words, { width: base.width, height: base.height, rotation: retryMode.rotation }, analysisFrame, base.mapWords),
  }
}
