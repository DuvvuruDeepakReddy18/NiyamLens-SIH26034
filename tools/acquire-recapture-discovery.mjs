// Bounded, create-only OFF acquisition. No OCR or OCR sidecar is requested.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readPilotExclusions } from './field-pilot.mjs'
import { boundedSourceFetch, searchUrl, rawImageUrls, validateDownloadedJpeg, SOURCE_LINKS } from './download-field-pilot.mjs'

const repo = resolve(import.meta.dirname, '..')
const originalDirectory = resolve(repo, 'datasets/recapture-discovery-2026-09-06')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const phase = process.argv[2]
assert.ok(['metadata', 'metadata-retry', 'photos', 'photos-retry', 'photos-extra'].includes(phase) && process.argv.length === 3, 'Use metadata, metadata-retry, photos, photos-retry, or photos-extra; fixed OFF source and dated output only.')
const extra = phase === 'photos-extra'
const relativeDirectory = phase.endsWith('-retry') || extra ? 'datasets/recapture-discovery-2026-09-06-retry1' : 'datasets/recapture-discovery-2026-09-06'
const directory = resolve(repo, relativeDirectory)
const frozenPath = resolve(repo, '../NiyamLens_Field_Review_Kit_2026-09-05-v2/selection-manifest.json')
const frozenBytes = await readFile(frozenPath)
const frozen = JSON.parse(frozenBytes)
const inventory = await readPilotExclusions(repo)
const excludedProducts = new Set([...inventory.products, ...frozen.samples.map(sample => sample.productKey)])
const excludedHashes = new Set([...inventory.hashes, ...frozen.samples.map(sample => sample.sha256)])
const excluded = { inventorySha256: inventory.sha256, frozenSelectionSha256: sha(frozenBytes), products: [...excludedProducts].sort(), hashes: [...excludedHashes].sort(), frozenImagesRead: false }
const budget = { bytes: 0 }
const writeJson = (name, value) => writeFile(resolve(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
const now = () => new Date().toISOString()
if (phase === 'metadata' || phase === 'metadata-retry') {
  let retryOf = null
  if (phase === 'metadata-retry') {
    const prior = JSON.parse(await readFile(resolve(originalDirectory, 'metadata-acquisition.json')))
    assert.equal(prior.error, 'HTTP_503', 'The one retry is only for the recorded availability failure.')
    assert.ok(Date.now() - Date.parse(prior.finishedAt) > 30_000, 'Wait more than thirty seconds before the one authorized retry.')
    retryOf = { path: 'datasets/recapture-discovery-2026-09-06/metadata-acquisition.json', finishedAt: prior.finishedAt, error: prior.error }
  }
  await mkdir(directory, { recursive: false })
  const report = { kind: 'public-off-candidate-metadata-no-ocr', startedAt: now(), retryOf, requestedPages: 1, maximumProducts: 100, ocrExecuted: false, ocrSidecarsFetched: false, sourceLinks: SOURCE_LINKS, excluded, request: searchUrl(1), error: null }
  try {
    const bytes = await boundedSourceFetch(report.request, { limit: 8 * 1024 * 1024, budget })
    const data = JSON.parse(bytes)
    assert.ok(Array.isArray(data.products) && data.products.length <= 100)
    await writeFile(resolve(directory, 'metadata-response.json'), bytes, { flag: 'wx' })
    report.bodySha256 = sha(bytes)
    report.products = data.products.length
    report.candidates = data.products.filter(product => !excludedProducts.has(String(product.code)) && product.countries_tags?.includes('en:india')).map(product => ({ code: product.code, productName: product.product_name, brand: product.brands, originals: Object.keys(product.images || {}).filter(id => /^[1-9]\d*$/.test(id)), selectedRoles: Object.entries(product.images || {}).filter(([key]) => /^(?:front|ingredients|nutrition|packaging)_/.test(key)).map(([key, value]) => ({ role: key, imageId: String(value.imgid) })) }))
  } catch (error) { report.error = String(error.message).slice(0, 1000); process.exitCode = 1 }
  report.finishedAt = now(); report.networkBytesRead = budget.bytes
  await writeJson('metadata-acquisition.json', report)
  console.log(JSON.stringify(report, null, 2))
} else {
  const metadata = JSON.parse(await readFile(resolve(directory, 'metadata-response.json')))
  const planName = extra ? 'candidate-plan-extra.json' : 'candidate-plan.json'
  const plan = JSON.parse(await readFile(resolve(directory, planName)))
  const prior = extra ? JSON.parse(await readFile(resolve(directory, 'photo-acquisition.json'))) : null
  if (extra) {
    budget.bytes = prior.networkBytesRead + JSON.parse(await readFile(resolve(directory, 'metadata-acquisition.json'))).networkBytesRead
    for (const photo of prior.images) excludedHashes.add(photo.sha256)
    const priorProducts = new Set(prior.images.map(photo => photo.code))
    assert.ok(plan.candidates.every(candidate => priorProducts.has(candidate.code)), 'Extra images must come from the same eight already acquired SKUs.')
    assert.ok(plan.candidates.every(candidate => !prior.images.some(photo => photo.code === candidate.code && photo.imageId === candidate.imageId)), 'Extra images cannot redownload earlier selections.')
  }
  assert.ok(Array.isArray(plan.candidates) && plan.candidates.length > 0 && plan.candidates.length <= (extra ? 8 : 16))
  assert.ok(new Set(plan.candidates.map(row => row.code)).size <= 8)
  assert.equal(new Set(plan.candidates.map(row => `${row.code}:${row.imageId}`)).size, plan.candidates.length)
  for (const candidate of plan.candidates) {
    assert.ok(/^\d{13}$/.test(candidate.code) && /^[1-9]\d{0,6}$/.test(candidate.imageId))
    assert.ok(!excludedProducts.has(candidate.code), `Excluded SKU ${candidate.code}`)
    const product = metadata.products.find(product => product.code === candidate.code)
    assert.ok(product?.images?.[candidate.imageId], 'Only image IDs observed in the new metadata are allowed.')
  }
  const photoDirectory = extra ? 'photos-extra' : 'photos'
  await mkdir(resolve(directory, photoDirectory), { recursive: false })
  const report = { kind: 'public-off-candidate-photos-no-ocr', startedAt: now(), priorBudgetBytes: budget.bytes, excluded, planSha256: sha(await readFile(resolve(directory, planName))), sourceLinks: SOURCE_LINKS, ocrExecuted: false, ocrSidecarsFetched: false, isHoldout: false, humanReviewed: false, attempts: [], images: [], error: null }
  try {
    for (const candidate of plan.candidates) {
      const product = metadata.products.find(product => product.code === candidate.code)
      const observed = product.images[candidate.imageId]
      const urls = rawImageUrls(candidate.code, candidate.imageId)
      for (const url of urls) {
        assert.ok(budget.bytes < 80 * 1024 * 1024, 'Fixed 80MiB candidate acquisition budget reached.')
        try {
          const bytes = await boundedSourceFetch(url, { limit: Math.min(8 * 1024 * 1024, 80 * 1024 * 1024 - budget.bytes), budget })
          const image = await validateDownloadedJpeg(bytes)
          assert.ok(!excludedHashes.has(image.sha256), 'Image hash is already in the exclusion inventory.')
          const sourcePath = `${relativeDirectory}/${photoDirectory}/${candidate.code}-${candidate.imageId}.jpg`
          await writeFile(resolve(repo, sourcePath), bytes, { flag: 'wx' })
          report.images.push({ ...candidate, ...image, sourcePath, sourceUrl: url, productUrl: `https://world.openfoodfacts.org/product/${candidate.code}`, uploader: typeof observed.uploader === 'string' ? observed.uploader.slice(0, 100) : null, uploadEpoch: observed.uploaded_t ?? null, acquiredAt: now(), capturedAt: null, bytesReencoded: false, imageLicense: 'CC BY-SA 3.0', databaseLicense: 'ODbL 1.0' })
          excludedHashes.add(image.sha256)
          report.attempts.push({ ...candidate, url, status: 'downloaded', sha256: image.sha256, at: now() })
          break
        } catch (error) {
          report.attempts.push({ ...candidate, url, status: 'failed', reason: String(error.message).slice(0, 1000), at: now() })
          if (error.message !== 'HTTP_404') throw error
        }
      }
      await new Promise(done => setTimeout(done, 1200))
    }
  } catch (error) { report.error = String(error.message).slice(0, 1000); process.exitCode = 1 }
  report.finishedAt = now(); report.networkBytesRead = budget.bytes
  await writeJson(extra ? 'photo-acquisition-extra.json' : 'photo-acquisition.json', report)
  console.log(JSON.stringify({ directory, images: report.images, attempts: report.attempts, error: report.error, networkBytesRead: budget.bytes }, null, 2))
}
