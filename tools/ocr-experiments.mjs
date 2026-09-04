/**
 * Local, fresh OCR experiments. No image leaves this machine and no correction
 * is injected into recognition. The manually selected ROIs simulate an officer
 * drawing a crop; they are not an automatic product-specific production policy.
 *
 * node tools/ocr-experiments.mjs --case amul
 * node tools/ocr-experiments.mjs --case amul --variant roi-red
 * node tools/ocr-experiments.mjs --case amul --lang-path reports/recognition-2026-09-04/tessdata-best --uncompressed
 *
 * Results are printed as JSON lines, including the complete unmodified OCR text.
 * The 'visibleChecks' are literal checks against visually inspected source
 * photographs, not an accuracy benchmark or compliance ground truth.
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const args = process.argv.slice(2)
const criticalBaseline = args.includes('--critical-baseline')
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const datasetRoot = 'datasets/openfoodfacts-india/real-labels'
const cases = [
  {
    id: 'amul', image: '8901262260121/6.jpg', roi: { x: .54, y: .045, width: .435, height: .28 },
    visibleChecks: { net500ml: /\b500\s*m[l1i]\b/i, mrp22: /(?:22[.,]00)\b/i },
    note: 'Blue ink on white reflective pouch. Crop spans Net Content / 500 mL / MRP 22.00; glare obscures some ink. No use-by date expected in this ROI.',
  },
  {
    id: 'jaggery', image: '8906014888868/5.jpg', roi: { x: .015, y: .07, width: .92, height: .3 },
    visibleChecks: { packedDate: /02\s*\/\s*08\s*\/\s*2026/, useBy: /01\s*\/\s*08\s*\/\s*2027/, mrp90: /\b90[.,]00\b/, usp018: /\b0[.,]18\s*\/\s*g\b/i },
    note: 'Labels and values occupy separate columns. Crop includes both, including packed/use-by dates, MRP 90.00 and USP Rs 0.18/g.',
  },
  {
    id: 'britannia', image: '8901063017252/20.jpg', roi: { x: .015, y: .68, width: .975, height: .29 },
    visibleChecks: { email: /feedback@britindia\.com/i, phone1: /1[\s-]*800[\s-]*4254449/, phone2: /1[\s-]*800[\s-]*30004530/ },
    note: 'Slightly soft focus and curved wrapper. Crop isolates the consumer-care paragraph. No MRP or net-quantity target on this image.',
  },
  {
    id: 'kinley', image: '8901764082405/6.jpg', roi: { x: .005, y: .50, width: .67, height: .28 },
    visibleChecks: { email: /indiahelpline@coca-cola\.com/i, phone: /1800[\s-]*208[\s-]*2653/ },
    note: 'Curved blue bottle label. Crop isolates consumer-care text. MRP/batch details direct reader to cap/neck/bottom and are not scored on this photo.',
  },
]
const variants = [
  { id: 'original', psm: '11' },
  { id: 'standard', psm: '11' },
  { id: 'full-gray', psm: '6' },
  { id: 'roi-color', psm: '6' },
  { id: 'roi-gray', psm: '6' },
  { id: 'roi-red', psm: '6' },
  { id: 'roi-clahe', psm: '6' },
  { id: 'roi-sauvola', psm: '6', thresholding: '2' },
  { id: 'roi-compact', psm: '6', targetWidth: 900 },
  { id: 'roi-adaptive-otsu', psm: '6', thresholding: '1' },
]
const criticalManifest = criticalBaseline ? JSON.parse(await readFile('datasets/critical-fields.v1.json', 'utf8')) : null
const casePool = criticalBaseline ? criticalManifest.samples.map(({ id, sourcePath, sha256 }) => ({ id, sourcePath, sha256, image: path.relative(datasetRoot, sourcePath).replaceAll('\\', '/'), visibleChecks: {}, note: 'All-image frozen-manifest baseline. No annotation values, hand-selected crops, or manual orientation corrections are supplied to recognition.' })) : cases
const variantPool = criticalBaseline ? [{ id: 'standard', psm: '11' }, { id: 'full-gray', psm: '6' }, { id: 'reverse-sparse', psm: '11' }] : args.includes('--base-only') ? variants.slice(0, 6) : variants
const selectedCases = casePool.filter(entry => !option('--case') || entry.id === option('--case'))
const selectedVariants = variantPool.filter(entry => !option('--variant') || entry.id === option('--variant'))
if (!selectedCases.length || !selectedVariants.length) throw new Error('Unknown case or variant')
const langPath = path.resolve(option('--lang-path', 'public/ocr/lang'))
const initStart = performance.now()
const worker = await createWorker('eng', 1, {
  langPath, gzip: !args.includes('--uncompressed'), cacheMethod: 'none',
  ...(args.includes('--portable') ? { workerPath: path.resolve('reports/recognition-2026-09-04/portable-ocr-worker.cjs') } : {}),
}, args.includes('--generic') ? { dotproduct: 'generic' } : {})
console.log(JSON.stringify({ type: 'session', version: 1, mode: criticalBaseline ? 'frozen-critical-whole-image-baseline' : 'exploratory-roi', manifest: criticalBaseline ? 'datasets/critical-fields.v1.json' : null, modelPath: langPath, core: args.includes('--portable') ? 'portable-lstm' : 'auto', initializationMs: Math.round(performance.now() - initStart), offlineRecognition: true, notes: criticalBaseline ? 'Sharp approximation to default browser upload rendering and three standard OCR variants, with user_defined_dpi300. Canvas color conversion/resampling/JPEG encoding are not claimed byte-identical. No handselected crops, manual orientation, or annotation values used.' : 'No transcript edits, dictionaries, whitelists, per-product corrections, or provider recognition calls. ROI coordinates were visually chosen and must not be misrepresented as automatic localization.' }))
try {
  for (const entry of selectedCases) {
    const file = path.resolve(datasetRoot, entry.image)
    const metadata = await sharp(file).metadata()
    let preparedSource = file
    let analysisSize = [metadata.width, metadata.height]
    let imageSha256 = null
    if (criticalBaseline) {
      imageSha256 = createHash('sha256').update(await readFile(file)).digest('hex')
      if (imageSha256 !== entry.sha256) throw new Error(`Frozen source hash mismatch: ${entry.id}`)
      const captureScale = Math.min(1, 2200 / Math.max(metadata.width, metadata.height))
      analysisSize = [Math.max(1, Math.round(metadata.width * captureScale)), Math.max(1, Math.round(metadata.height * captureScale))]
      preparedSource = await sharp(file).rotate().resize({ width: analysisSize[0], height: analysisSize[1] }).linear(1.12, -15.3).jpeg({ quality: 90 }).toBuffer()
    }
    for (const variant of selectedVariants) {
      const start = performance.now()
      let pipeline = sharp(preparedSource).rotate()
      let crop = null
      if (variant.id.startsWith('roi-')) {
        crop = {
          left: Math.floor(metadata.width * entry.roi.x), top: Math.floor(metadata.height * entry.roi.y),
          width: Math.floor(metadata.width * entry.roi.width), height: Math.floor(metadata.height * entry.roi.height),
        }
        pipeline = pipeline.extract(crop).resize({ width: variant.targetWidth || Math.min(3000, Math.max(crop.width, 1800)) })
        if (variant.id === 'roi-gray') pipeline = pipeline.grayscale().normalise().sharpen({ sigma: .5 })
        if (variant.id === 'roi-red') pipeline = pipeline.extractChannel(0).normalise().sharpen({ sigma: .5 })
        if (variant.id === 'roi-clahe') pipeline = pipeline.grayscale().clahe({ width: 64, height: 64, maxSlope: 3 })
      } else if (['standard', 'full-gray', 'reverse-sparse'].includes(variant.id)) {
        const scale = Math.max(1, Math.min(2.4, 2400 / Math.max(...analysisSize)))
        pipeline = pipeline.resize({ width: Math.round(analysisSize[0] * scale) })
        pipeline = variant.id === 'full-gray' ? pipeline.grayscale().linear(1.32, -40.8) : variant.id === 'reverse-sparse' ? pipeline.grayscale().negate().linear(1.45, -57.375) : pipeline.linear(1.12, -15.3)
      }
      const input = await pipeline.png().toBuffer()
      await worker.setParameters({ tessedit_pageseg_mode: variant.psm, preserve_interword_spaces: '1', thresholding_method: variant.thresholding || '0', ...(criticalBaseline ? { user_defined_dpi: '300' } : {}) })
      const { data } = await worker.recognize(input)
      const extraction = extractDeclarations(data.text)
      const result = {
        type: 'result', case: entry.id, image: entry.image, variant: variant.id, psm: variant.psm,
        ...(criticalBaseline ? { sampleId: entry.id, sourcePath: entry.sourcePath, imageSha256, analysisSize, provenance: { mode: 'whole-image-three-pass', engine: 'tesseract.js', model: 'bundled-fast-eng', preprocessing: 'sharp-browser-approximation', sourceHashVerified: true, textEdited: false, manualCrop: false, manualRotation: false } } : {}),
        sourceSize: [metadata.width, metadata.height], crop, elapsedMs: Math.round(performance.now() - start),
        engineConfidence: data.confidence, visibleChecks: Object.fromEntries(Object.entries(entry.visibleChecks).map(([key, regex]) => [key, regex.test(data.text)])),
        extracted: Object.fromEntries(extraction.fields.filter(field => ['mrp', 'netQuantity', 'packDate', 'unitSalePrice', 'email', 'phone'].includes(field.id)).map(field => [field.id, { value: field.value, validation: field.validation }])),
        rawText: data.text, note: entry.note,
      }
      console.log(JSON.stringify(result))
    }
  }
} finally { await worker.terminate() }
