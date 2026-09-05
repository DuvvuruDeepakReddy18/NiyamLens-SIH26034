export function focusPlan(rect, width, height) {
  if (!rect || ![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 10000)) throw new Error('Invalid image dimensions for focus OCR.')
  if (!['x0', 'y0', 'x1', 'y1'].every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]) && rect[key] >= 0 && rect[key] <= 1)) throw new Error('Select a focus rectangle inside the image.')
  const x = Math.floor(Math.min(rect.x0, rect.x1) * width)
  const y = Math.floor(Math.min(rect.y0, rect.y1) * height)
  // Round the two edges outward independently. Rounding only the span can
  // discard the last selected pixel when the first edge is fractional.
  const cropWidth = Math.min(width, Math.ceil(Math.max(rect.x0, rect.x1) * width)) - x
  const cropHeight = Math.min(height, Math.ceil(Math.max(rect.y0, rect.y1) * height)) - y
  if (cropWidth < 20 || cropHeight < 12) throw new Error('Focus region is too small. Include the complete declaration and its heading.')
  const scale = Math.min(4, 2200 / Math.max(cropWidth, cropHeight))
  const border = 24
  return { x, y, cropWidth, cropHeight, sourceWidth: width, sourceHeight: height, border, width: Math.round(cropWidth * scale) + 2 * border, height: Math.round(cropHeight * scale) + 2 * border }
}

export function mapFocusWords(words, plan, frame) {
  const sx = (plan.width - 2 * plan.border) / plan.cropWidth
  const sy = (plan.height - 2 * plan.border) / plan.cropHeight
  const x = (v) => Math.max(0, Math.min(frame.width, (plan.x + (v - plan.border) / sx) / plan.sourceWidth * frame.width))
  const y = (v) => Math.max(0, Math.min(frame.height, (plan.y + (v - plan.border) / sy) / plan.sourceHeight * frame.height))
  return words.map((word) => ({ ...word, bbox: { x0: x(word.bbox.x0), y0: y(word.bbox.y0), x1: x(word.bbox.x1), y1: y(word.bbox.y1) }, pageWidth: frame.width, pageHeight: frame.height })).filter((word) => word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0)
}

const imageFrom = (url) => new Promise((resolve, reject) => {
  const image = new Image()
  const timer = setTimeout(() => { image.src = ''; reject(new Error('Focus image decoding timed out.')) }, 20000)
  image.onload = () => { clearTimeout(timer); resolve(image) }
  image.onerror = () => { clearTimeout(timer); reject(new Error('Focus image could not be decoded.')) }
  image.src = url
})

// Selection is officer-assisted; recognition is real local OCR. A crop is an
// analysis derivative of the existing panel, never a replacement original.
export async function createFocusedVariants(evidence, rect) {
  const useOriginal = !evidence.perspective && !evidence.rotation && /^data:image\/(jpeg|png|webp);/.test(evidence.originalUrl || '')
  const source = await imageFrom(useOriginal ? evidence.originalUrl : evidence.analysisUrl)
  const frame = evidence.analysisWidth && evidence.analysisHeight ? { width: evidence.analysisWidth, height: evidence.analysisHeight } : await imageFrom(evidence.analysisUrl).then((image) => ({ width: image.naturalWidth, height: image.naturalHeight }))
  const plan = focusPlan(rect, source.naturalWidth, source.naturalHeight)
  const configurations = [{ id: 'focus-color-block', filter: 'none', mode: '6' }, { id: 'focus-gray-block', filter: 'grayscale(1) contrast(120%)', mode: '6' }, { id: 'focus-color-sparse', filter: 'none', mode: '11' }]
  return configurations.map((config) => {
    const canvas = document.createElement('canvas')
    canvas.width = plan.width; canvas.height = plan.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare an OCR canvas.')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.filter = config.filter
    context.drawImage(source, plan.x, plan.y, plan.cropWidth, plan.cropHeight, plan.border, plan.border, plan.width - plan.border * 2, plan.height - plan.border * 2)
    return { id: config.id, pageSegmentationMode: config.mode, dataUrl: canvas.toDataURL('image/png'), width: plan.width, height: plan.height, source: useOriginal ? 'original-resolution' : 'analysis-derivative', crop: rect, mapWords: (words) => mapFocusWords(words, plan, frame) }
  })
}

export function appendFocusedTranscript({ text = '', rawOcrText = '', focusedText = '', panelIndex = 0 } = {}) {
  if (typeof focusedText !== 'string' || !focusedText.trim()) throw new Error('The crop did not produce readable text.')
  const addition = `\n\n[FOCUSED OCR · PANEL ${panelIndex + 1}]\n${focusedText.trim()}`
  if (text.length + addition.length > 100000 || rawOcrText.length + addition.length > 100000) throw new Error('Focused text would exceed the evidence limit.')
  return { text: text + addition, rawOcrText: rawOcrText + addition }
}
