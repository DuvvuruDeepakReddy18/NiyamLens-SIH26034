import { createWorker } from 'tesseract.js'
import { boundedOcr, OCR_LIMITS, ocrController, throwIfAborted } from './ocrLifecycle.mjs'
import { calibrateOcrReliability, createOcrInputVariants, createOcrTileVariants, flattenOcrWords, mergeOcrPassTexts } from './vision.mjs'
import { OCR_OUTPUT_LIMITS, validateOcrBlocks, validateOcrHistory, validateOcrWords } from './ocrHistory.mjs'

export const transcriptForPanels = (items) => items.map((item, i) => `[PANEL ${i + 1}: ${item.name}]\n${item.ocrText || ''}`).join('\n\n')
export async function runLocalOcr({ evidenceItems, language = 'eng', mode = 'standard', signal, onProgress = () => {}, workerFactory = createWorker, variantFactory, model = 'fast', limits = OCR_LIMITS }) {
  if (!Array.isArray(evidenceItems) || evidenceItems.length < 1 || evidenceItems.length > 4) throw new Error('Capture one to four panels before OCR.')
  if (!['eng', 'eng+hin', 'eng+tel', 'eng+tam'].includes(language)) throw new Error('Choose a supported OCR language.')
  if (!['standard', 'deep', 'focused'].includes(mode) || (mode === 'focused' && !variantFactory)) throw new Error('Choose a supported OCR strategy.')
  if (evidenceItems.some(item => !item || typeof item.id !== 'string' || !item.id) || new Set(evidenceItems.map(item => item.id)).size !== evidenceItems.length) throw new Error('OCR evidence panel IDs must be present and unique.')
  const job = ocrController(signal, limits.totalMs)
  let worker
  let finishedPasses = 0
  let panelIndex = 0
  let totalPasses = evidenceItems.length * (mode === 'deep' ? 7 : 3)
  const update = (progress, label) => { if (!job.signal.aborted) onProgress({ running: true, progress: Math.min(99, Math.max(0, progress)), label, error: '' }) }
  try {
    throwIfAborted(job.signal)
    if (model !== 'fast') throw new Error('Only the verified bundled OCR model is available.')
    update(1, 'Loading local OCR engine — images stay on this device')
    worker = await boundedOcr(workerFactory(language, 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang',
      cachePath: 'niyamlens-fast-v1',
      logger: (message) => update(Math.round((finishedPasses + Math.max(0, Math.min(1, Number(message.progress) || 0))) / totalPasses * 100), `Panel ${panelIndex + 1}/${evidenceItems.length} · ${message.status || 'reading'}`),
    }), { signal: job.signal, timeoutMs: limits.initializeMs, label: 'OCR initialization', onLateResolve: (late) => late?.terminate() })
    const items = []
    for (panelIndex = 0; panelIndex < evidenceItems.length; panelIndex += 1) {
      throwIfAborted(job.signal)
      const item = evidenceItems[panelIndex]
      const variants = await boundedOcr(variantFactory ? variantFactory(item, mode) : (async () => [...await createOcrInputVariants(item.analysisUrl), ...(mode === 'deep' ? await createOcrTileVariants(item.analysisUrl) : [])])(), { signal: job.signal, timeoutMs: limits.passMs, label: 'OCR image preparation' })
      if (!Array.isArray(variants) || !variants.length || variants.length > 12) throw new Error('OCR variant count is invalid.')
      if (variantFactory) totalPasses = evidenceItems.length * variants.length
      const passes = []
      for (const variant of variants) {
        throwIfAborted(job.signal)
        await boundedOcr(worker.setParameters({ tessedit_pageseg_mode: variant.pageSegmentationMode, preserve_interword_spaces: '1', user_defined_dpi: '300' }), { signal: job.signal, timeoutMs: limits.passMs, label: 'OCR setup' })
        const { data } = await boundedOcr(worker.recognize(variant.dataUrl, {}, { text: true, blocks: true }), { signal: job.signal, timeoutMs: limits.passMs, label: 'OCR recognition' })
        throwIfAborted(job.signal)
        if (typeof data?.text !== 'string' || data.text.length > OCR_OUTPUT_LIMITS.textPerPass) throw new Error('Raw OCR text exceeds the evidence limit or is malformed. Use a smaller crop; previous evidence was preserved.')
        const text = data.text
        validateOcrBlocks(data.blocks)
        const rawWords = variant.spatial === false ? [] : flattenOcrWords(data.blocks, item.id, variant.width, variant.height)
        const words = variant.mapWords ? variant.mapWords(rawWords) : rawWords
        validateOcrWords(words)
        const confidence = typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? Math.max(0, Math.min(100, data.confidence)) : 0
        passes.push({ id: `${item.id}:${variant.id}`, text, confidence, words, spatial: variant.spatial !== false, provider: 'tesseract.js', model: 'bundled-fast', strategy: mode })
        validateOcrHistory([{ id: item.id, ocrPasses: passes, ocrWords: passes.flatMap(pass => pass.words) }])
        finishedPasses += 1
      }
      const reliability = calibrateOcrReliability(passes, item.quality?.score)
      const mergedText = mergeOcrPassTexts(passes.map((pass) => pass.text))
      const { connectedOcrText: _previousConnectedText, ...currentItem } = item
      items.push({ ...currentItem, ocrText: mergedText, ocrProvider: 'tesseract.js', ocrModel: 'bundled-fast', ocrStrategy: mode, ocrConfidence: reliability.engineConfidence, ocrReliability: reliability.score, ocrAgreement: reliability.agreement, ocrWords: passes.flatMap((pass) => pass.words), ocrPasses: passes.map(({ id, text, confidence, provider, model, strategy }) => ({ id, text, confidence, provider, model, strategy })) })
      validateOcrHistory(items)
    }
    throwIfAborted(job.signal)
    const text = transcriptForPanels(items)
    if (text.length > 100000) throw new Error('Recognized text exceeds the evidence limit. Use fewer, tighter declaration panels.')
    if (!items.some((item) => item.ocrText.trim())) throw new Error('No readable OCR text. Retake or select a tighter focus region.')
    const mean = (key) => Number((items.reduce((sum, item) => sum + item[key], 0) / items.length).toFixed(1))
    return { items, text, words: items.flatMap((item) => item.ocrWords), reliability: mean('ocrReliability'), engineConfidence: mean('ocrConfidence'), model: 'bundled-fast', strategy: mode }
  } finally {
    job.dispose()
    if (worker) await boundedOcr(Promise.resolve().then(() => worker.terminate()), { timeoutMs: 2000, label: 'OCR cleanup' }).catch(() => {})
  }
}
