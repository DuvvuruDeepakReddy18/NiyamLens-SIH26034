// Resource limits are safety ceilings, not recognition-quality thresholds.
// Reject a too-large result atomically; never silently truncate raw evidence.
export const OCR_OUTPUT_LIMITS = Object.freeze({
  textPerPass: 100000, rawTextPerPanel: 250000, rawTextTotal: 500000,
  passesPerPanel: 32, wordsPerPanel: 12000, wordsTotal: 24000,
  wordLength: 512, lineLength: 4000, blockNodes: 30000,
})
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const textWithin = (value, limit, label) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} text exceeds the evidence limit or is malformed. Use a smaller crop; previous evidence was preserved.`)
}
export function validateOcrWords(words = [], maxWords = OCR_OUTPUT_LIMITS.wordsPerPanel) {
  if (!Array.isArray(words) || words.length > maxWords) throw new Error('OCR word count exceeds the evidence limit. Use a smaller crop.')
  for (const word of words) {
    if (!object(word) || !object(word.bbox)) throw new Error('OCR word geometry is malformed.')
    textWithin(word.text, OCR_OUTPUT_LIMITS.wordLength, 'OCR word')
    if (word.lineText !== undefined) textWithin(word.lineText, OCR_OUTPUT_LIMITS.lineLength, 'OCR word line')
    if (!['x0', 'y0', 'x1', 'y1'].every(key => typeof word.bbox[key] === 'number' && Number.isFinite(word.bbox[key]) && word.bbox[key] >= 0)
      || word.bbox.x1 < word.bbox.x0 || word.bbox.y1 < word.bbox.y0
      || !['pageWidth', 'pageHeight'].every(key => typeof word[key] === 'number' && Number.isFinite(word[key]) && word[key] > 0 && word[key] <= 10000)
      || word.bbox.x1 > word.pageWidth || word.bbox.y1 > word.pageHeight) throw new Error('OCR word coordinates are outside the image or nonfinite.')
  }
  return true
}

// Bound the hierarchy before flattening creates another large object graph.
export function validateOcrBlocks(blocks) {
  if (blocks == null) return true
  let nodes = 0; let wordCount = 0
  const visit = (array, key) => {
    if (!Array.isArray(array) || array.length > OCR_OUTPUT_LIMITS.blockNodes - nodes) throw new Error('OCR word/block output exceeds the evidence limit or is malformed.')
    nodes += array.length
    for (const entry of array) {
      if (!object(entry)) throw new Error('OCR word/block output is malformed.')
      if (key === 'words') {
        if (++wordCount > OCR_OUTPUT_LIMITS.wordsPerPanel) throw new Error('OCR word count exceeds the evidence limit.')
        textWithin(entry.text || '', OCR_OUTPUT_LIMITS.wordLength, 'OCR word')
      } else {
        const nextKey = key === 'blocks' ? 'paragraphs' : key === 'paragraphs' ? 'lines' : 'words'
        if (key === 'lines' && entry.text !== undefined) textWithin(entry.text, OCR_OUTPUT_LIMITS.lineLength, 'OCR word line')
        visit(entry[nextKey] || [], nextKey)
      }
    }
  }
  visit(blocks, 'blocks')
  return true
}

export function validateOcrHistory(evidenceItems = []) {
  if (!Array.isArray(evidenceItems) || evidenceItems.length > 4) throw new Error('OCR history requires at most four evidence panels.')
  let totalChars = 0; let totalWords = 0
  const panelIds = new Set()
  for (const panel of evidenceItems) {
    if (!object(panel) || typeof panel.id !== 'string' || !panel.id || panelIds.has(panel.id)) throw new Error('OCR panel IDs are missing or duplicated.')
    panelIds.add(panel.id)
    for (const key of ['ocrText', 'connectedOcrText']) if (panel[key] !== undefined) textWithin(panel[key], OCR_OUTPUT_LIMITS.textPerPass, `Panel ${key}`)
    const passes = panel.ocrPasses === undefined ? [] : panel.ocrPasses
    if (!Array.isArray(passes) || passes.length > OCR_OUTPUT_LIMITS.passesPerPanel) throw new Error('OCR pass count exceeds the panel history limit. Start a new inspection or export this evidence first.')
    const passIds = new Set(); let panelChars = 0
    for (const pass of passes) {
      if (!object(pass) || typeof pass.id !== 'string' || !pass.id || pass.id.length > 240) throw new Error('OCR pass identifier is malformed.')
      if (passIds.has(pass.id)) throw new Error('Duplicate OCR pass identifier. Each run must preserve distinct provenance.')
      passIds.add(pass.id)
      textWithin(pass.text, OCR_OUTPUT_LIMITS.textPerPass, 'Raw OCR pass')
      for (const key of ['provider', 'model', 'strategy']) if (pass[key] !== undefined) textWithin(pass[key], 80, `OCR pass ${key}`)
      if (pass.confidence !== undefined && pass.confidence !== null && (typeof pass.confidence !== 'number' || !Number.isFinite(pass.confidence) || pass.confidence < 0 || pass.confidence > 100)) throw new Error('OCR pass confidence must be finite or explicitly unavailable.')
      panelChars += pass.text.length
    }
    if (panelChars > OCR_OUTPUT_LIMITS.rawTextPerPanel) throw new Error('OCR raw text exceeds the panel history limit.')
    totalChars += panelChars
    const words = panel.ocrWords === undefined ? [] : panel.ocrWords
    validateOcrWords(words)
    totalWords += words.length
  }
  if (totalChars > OCR_OUTPUT_LIMITS.rawTextTotal) throw new Error('OCR raw text exceeds the inspection history limit.')
  if (totalWords > OCR_OUTPUT_LIMITS.wordsTotal) throw new Error('OCR word count exceeds the inspection history limit.')
  return true
}

export function appendOcrHistory(panel, { passes = [], words = [], text } = {}) {
  // Check existing history too, so malformed restored drafts cannot bypass caps.
  validateOcrHistory([panel])
  if (!Array.isArray(passes) || !Array.isArray(words)) throw new Error('OCR history additions must be arrays.')
  const next = { ...panel, ...(text === undefined ? {} : { ocrText: text }), ocrPasses: [...(panel.ocrPasses || []), ...passes], ocrWords: [...(panel.ocrWords || []), ...words] }
  validateOcrHistory([next])
  return next
}
