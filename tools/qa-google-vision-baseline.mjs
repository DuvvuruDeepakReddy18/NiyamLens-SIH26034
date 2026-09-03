import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(await readFile(path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels.manifest.json'), 'utf8'))
const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
const containsExpected = (normalizedText, expected) => ` ${normalizedText} `.includes(` ${normalize(expected)} `)
const cases = manifest.products.flatMap((product) => product.images
  .filter((image) => image.benchmark)
  .map((image) => ({ ...image, code: product.code, productName: product.productName })))

const results = []
for (const testCase of cases) {
  const annotationPath = path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels', testCase.code, `${testCase.imageId}.google-vision.json.gz`)
  const annotation = JSON.parse(gunzipSync(await readFile(annotationPath)))
  const recognizedText = annotation.responses?.[0]?.fullTextAnnotation?.text || annotation.fullTextAnnotation?.text || ''
  const normalizedText = normalize(recognizedText)
  const matchedTokens = testCase.expectedTokens.filter((token) => containsExpected(normalizedText, token))
  results.push({
    id: `${testCase.code}-${testCase.imageId}`,
    productName: testCase.productName,
    expectedTokens: testCase.expectedTokens,
    matchedTokens,
    missingTokens: testCase.expectedTokens.filter((token) => !matchedTokens.includes(token)),
    tokenRecall: Number((matchedTokens.length / testCase.expectedTokens.length).toFixed(3)),
  })
}

const expected = results.reduce((sum, result) => sum + result.expectedTokens.length, 0)
const matched = results.reduce((sum, result) => sum + result.matchedTokens.length, 0)
const report = {
  generatedAt: new Date().toISOString(),
  dataset: manifest.name,
  datasetVersion: manifest.version,
  engine: 'Google Cloud Vision annotations distributed with the Open Food Facts AWS image dataset',
  cases: results.length,
  aggregateTokenRecall: Number((matched / expected).toFixed(3)),
  note: 'Reference baseline only. NiyamLens does not read these annotations during OCR and no Google API key is bundled in the app.',
  results,
}
await mkdir(path.join(root, 'reports'), { recursive: true })
await writeFile(path.join(root, 'reports', 'google-vision-real-label-baseline.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ cases: report.cases, aggregateTokenRecall: report.aggregateTokenRecall }, null, 2))
