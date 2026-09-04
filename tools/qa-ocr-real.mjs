import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { launchTestBrowser } from './browser-runtime.mjs'

const root = process.cwd()
const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:5173/'
const scanMode = String(process.env.NIYAMLENS_OCR_MODE || 'standard').toLowerCase() === 'deep' ? 'deep' : 'standard'
const manifest = JSON.parse(await readFile(path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels.manifest.json'), 'utf8'))
const caseFilter = String(process.env.NIYAMLENS_CASE || '').trim()
const allCases = manifest.products.flatMap((product) => product.images
  .filter((image) => image.benchmark)
  .map((image) => ({ ...image, code: product.code, productName: product.productName, brand: product.brand, form: product.form })))
const cases = caseFilter ? allCases.filter((testCase) => `${testCase.code}-${testCase.imageId}` === caseFilter) : allCases
if (!cases.length) throw new Error(`No real-label benchmark case matched "${caseFilter}".`)

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
const containsExpected = (normalizedText, expected) => ` ${normalizedText} `.includes(` ${normalize(expected)} `)
const browser = await launchTestBrowser()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
const ocrDiagnostics = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const value = message.text()
  if (/^(?:Detected \d+ diacritics|Error in boxClipToRectangle|Error in pixScanForForeground|Image too small to scale|Line cannot be recognized)/i.test(value)) ocrDiagnostics.push(value)
  else errors.push(value)
})

const results = []
for (const testCase of cases) {
  const imagePath = path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels', testCase.code, `${testCase.imageId}.jpg`)
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('input[type="file"]').setInputFiles(imagePath)
  await page.getByText(/panel ready for OCR/i).waitFor({ timeout: 30_000 })
  if (testCase.rotation) {
    const clockwiseButton = page.getByRole('button', { name: /^rotate$/i })
    const turns = ((testCase.rotation % 360) + 360) % 360 / 90
    for (let turn = 0; turn < turns; turn += 1) await clockwiseButton.click()
  }
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) await caution.click()
  await page.getByRole('button', { name: scanMode === 'deep' ? /Deep scan small text/i : /Run browser OCR/i }).click()
  await page.getByText(scanMode === 'deep' ? /Deep scan complete across/i : /OCR complete across/i).waitFor({ timeout: 240_000 })
  const recognizedText = await page.locator('.evidence-editor').inputValue()
  const normalizedText = normalize(recognizedText)
  const matchedTokens = testCase.expectedTokens.filter((token) => containsExpected(normalizedText, token))
  const missingTokens = testCase.expectedTokens.filter((token) => !matchedTokens.includes(token))
  const confidenceText = await page.locator('.confidence-chip').innerText()
  const confidenceValues = [...confidenceText.matchAll(/[\d.]+/g)].map((match) => Number(match[0]))
  const reliability = confidenceValues[0] || 0
  const engineConfidence = confidenceValues[1] || 0
  const parsedSignals = await page.locator('.extraction-grid .detected').count()
  results.push({
    id: `${testCase.code}-${testCase.imageId}`,
    productName: testCase.productName,
    form: testCase.form,
    role: testCase.role,
    imagePath: path.relative(root, imagePath).replaceAll('\\', '/'),
    expectedTokens: testCase.expectedTokens,
    matchedTokens,
    missingTokens,
    tokenRecall: Number((matchedTokens.length / testCase.expectedTokens.length).toFixed(3)),
    reliability,
    engineConfidence,
    parsedSignals,
    recognizedText,
    manualCorrectionsApplied: false
  })
  console.log(`${results.at(-1).id}: ${(results.at(-1).tokenRecall * 100).toFixed(0)}% token recall, reliability ${reliability}%, engine ${engineConfidence}%`)
}

await browser.close()
const totalExpected = results.reduce((sum, result) => sum + result.expectedTokens.length, 0)
const totalMatched = results.reduce((sum, result) => sum + result.matchedTokens.length, 0)
const summary = {
  generatedAt: new Date().toISOString(),
  appUrl: baseUrl,
  dataset: manifest.name,
  datasetVersion: manifest.version,
  scanMode,
  cases: results.length,
  products: new Set(results.map((result) => result.productName)).size,
  aggregateTokenRecall: Number((totalMatched / totalExpected).toFixed(3)),
  averageReliability: Number((results.reduce((sum, result) => sum + result.reliability, 0) / results.length).toFixed(1)),
  averageEngineConfidence: Number((results.reduce((sum, result) => sum + result.engineConfidence, 0) / results.length).toFixed(1)),
  totalParsedSignals: results.reduce((sum, result) => sum + result.parsedSignals, 0),
  manualCorrectionsApplied: false,
  note: 'Expected tokens were human-annotated before the run. Recognized text is the unedited browser OCR output. This pilot measures OCR token recovery only; it does not establish field accuracy or legal compliance accuracy.',
  ocrDiagnosticCount: ocrDiagnostics.length,
  errors,
  results
}
await mkdir(path.join(root, 'reports'), { recursive: true })
const reportName = scanMode === 'deep' ? 'ocr-real-label-benchmark-deep.json' : 'ocr-real-label-benchmark.json'
await writeFile(path.join(root, 'reports', reportName), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify({
  cases: summary.cases,
  products: summary.products,
  aggregateTokenRecall: summary.aggregateTokenRecall,
  averageReliability: summary.averageReliability,
  averageEngineConfidence: summary.averageEngineConfidence,
  totalParsedSignals: summary.totalParsedSignals,
  manualCorrectionsApplied: false,
  errors: errors.length,
}, null, 2))
if (errors.length) process.exitCode = 1
