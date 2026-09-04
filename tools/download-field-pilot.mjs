#!/usr/bin/env node
// Explicitly opt-in collection only. No OCR, model calls, answer labels,
// credentials, file replacement, deletion, or production application writes.
import { mkdir, writeFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readPilotExclusions } from './field-pilot.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DOWNLOAD_LIMITS = Object.freeze({ photos: 30, pages: 5, productsPerPage: 100, attempts: 120, metadataAttemptsPerPage: 3, requestBytes: 15 * 1024 * 1024, metadataBytes: 8 * 1024 * 1024, totalBytes: 200 * 1024 * 1024, timeoutMs: 30000, pixels: 25_000_000 })
export const SOURCE_LINKS = Object.freeze({
  api: 'https://openfoodfacts.github.io/openfoodfacts-server/api/',
  images: 'https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/',
  mirror: 'https://openfoodfacts.github.io/openfoodfacts-server/api/aws-images-dataset/',
  license: 'https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/',
  imageLicense: 'https://creativecommons.org/licenses/by-sa/3.0/',
  databaseLicense: 'https://opendatacommons.org/licenses/odbl/1-0/',
})
const allowedHosts = new Set(['world.openfoodfacts.org', 'images.openfoodfacts.org', 'openfoodfacts-images.s3.eu-west-3.amazonaws.com'])
const userAgent = 'NiyamLens-Field-Pilot/0.4.4 (https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034)'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const codeOk = code => typeof code === 'string' && /^\d{8,14}$/.test(code)
const imageOk = id => typeof id === 'string' && /^[1-9]\d{0,6}$/.test(id)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw new Error(code) }
const check = (ok, code) => { if (!ok) fail(code) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const cleanText = (value, max = 300) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null
const safeError = error => /^(?:DOWNLOAD_[A-Z_]+|HTTP_[0-9]{3})$/.test(error?.message || '') ? error.message : 'DOWNLOAD_REQUEST_OR_DECODE_FAILED'

export function searchUrl(page) {
  check(Number.isSafeInteger(page) && page >= 1 && page <= DOWNLOAD_LIMITS.pages, 'DOWNLOAD_PAGE_INVALID')
  const url = new URL('https://world.openfoodfacts.org/api/v2/search')
  url.search = new URLSearchParams({ countries_tags_en: 'india', page_size: '100', page: String(page), sort_by: 'last_modified_t', fields: 'code,product_name,brands,countries_tags,images' }).toString()
  return url.href
}

export function validateSourceUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('DOWNLOAD_URL_INVALID') }
  check(url.protocol === 'https:' && allowedHosts.has(url.hostname) && !url.username && !url.password && !url.port && !url.hash, 'DOWNLOAD_HOST_NOT_ALLOWED')
  if (url.hostname === 'world.openfoodfacts.org') {
    check(url.pathname === '/api/v2/search' && [...url.searchParams.keys()].every(key => ['countries_tags_en', 'page_size', 'page', 'sort_by', 'fields'].includes(key)), 'DOWNLOAD_API_PATH_INVALID')
  } else {
    const prefix = url.hostname === 'images.openfoodfacts.org' ? '/images/products/' : '/data/'
    check(url.pathname.startsWith(prefix) && !url.search && /^\d+(?:\/\d+)*\/[1-9]\d{0,6}\.jpg$/.test(url.pathname.slice(prefix.length)), 'DOWNLOAD_IMAGE_PATH_INVALID')
  }
  return url.href
}

export function rawImageUrls(code, imageId) {
  check(codeOk(code) && imageOk(imageId), 'DOWNLOAD_IMAGE_ID_INVALID')
  const directory = code.length > 8 ? `${code.slice(0, 3)}/${code.slice(3, 6)}/${code.slice(6, 9)}/${code.slice(9)}` : code
  check(!directory.endsWith('/'), 'DOWNLOAD_BARCODE_LENGTH_UNSUPPORTED')
  return [`https://openfoodfacts-images.s3.eu-west-3.amazonaws.com/data/${directory}/${imageId}.jpg`, `https://images.openfoodfacts.org/images/products/${directory}/${imageId}.jpg`].map(validateSourceUrl)
}

export function selectProductCandidates(products, { excludedProducts = new Set(), seenProducts = new Set() } = {}) {
  check(Array.isArray(products) && products.length <= 100, 'DOWNLOAD_PRODUCT_PAGE_INVALID')
  const candidates = []; const skips = []
  for (const product of products) {
    if (!plain(product) || !codeOk(product.code)) { skips.push({ reason: 'invalid-product-code' }); continue }
    const code = product.code
    if (excludedProducts.has(code) || seenProducts.has(code)) { skips.push({ code, reason: excludedProducts.has(code) ? 'recorded-development-sku' : 'already-considered-sku' }); continue }
    seenProducts.add(code)
    if (!Array.isArray(product.countries_tags) || !product.countries_tags.includes('en:india')) { skips.push({ code, reason: 'india-tag-unconfirmed' }); continue }
    if (!plain(product.images)) { skips.push({ code, reason: 'no-image-metadata' }); continue }
    const numeric = Object.keys(product.images).filter(imageOk).sort((a, b) => Number(a) - Number(b))
    const preferred = Object.keys(product.images).filter(key => /^(?:ingredients|nutrition)(?:_[a-z]{2})?$/.test(key)).sort().map(key => ({ id: String(product.images[key]?.imgid ?? ''), selectedRole: key }))
    const frontIds = new Set(Object.keys(product.images).filter(key => /^front(?:_[a-z]{2})?$/.test(key)).map(key => String(product.images[key]?.imgid ?? '')))
    const nonFront = numeric.filter(id => !frontIds.has(id))
    const choice = preferred.find(item => imageOk(item.id) && numeric.includes(item.id)) ?? (numeric.length >= 2 && nonFront.length ? { id: nonFront.at(-1), selectedRole: null } : null)
    if (!choice) { skips.push({ code, reason: 'no-label-source-or-multiple-nonfront-originals' }); continue }
    const image = product.images[choice.id]
    let urls
    try { urls = rawImageUrls(code, choice.id) } catch { skips.push({ code, reason: 'unsupported-barcode-path' }); continue }
    const stamp = image?.uploaded_t
    const uploadedEpoch = (typeof stamp === 'number' || (typeof stamp === 'string' && /^\d+$/.test(stamp))) && Number.isSafeInteger(Number(stamp)) && Number(stamp) > 0 && Number(stamp) < 100000000000 ? Number(stamp) : null
    candidates.push({ code, productName: cleanText(product.product_name), brand: cleanText(product.brands), imageId: choice.id, preferredRole: choice.selectedRole, panelSelectionBasis: choice.selectedRole ? 'original-source-of-selected-ingredients-or-nutrition-photo' : 'latest-numeric-original-not-selected-as-front-among-multiple-photos-role-unverified', labelPanelVisuallyVerified: false, uploader: cleanText(image?.uploader, 100), uploaded_t: uploadedEpoch, uploadTimeIsCaptureTime: false, productUrl: `https://world.openfoodfacts.org/product/${code}`, urls })
  }
  return { candidates, skips }
}

export async function boundedSourceFetch(value, { limit, budget, fetchImpl = fetch } = {}) {
  const url = validateSourceUrl(value)
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= DOWNLOAD_LIMITS.requestBytes && budget && Number.isSafeInteger(budget.bytes), 'DOWNLOAD_FETCH_OPTIONS_INVALID')
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), DOWNLOAD_LIMITS.timeoutMs)
  let reader; let response
  try {
    response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: url.includes('/api/') ? 'application/json' : 'image/jpeg' }, redirect: 'manual', credentials: 'omit', signal: controller.signal })
    if (response.status >= 300 && response.status < 400) fail('DOWNLOAD_REDIRECT_REFUSED')
    if (!response.ok) fail(`HTTP_${response.status}`)
    check(!response.url || validateSourceUrl(response.url) === url, 'DOWNLOAD_UNEXPECTED_RESPONSE_URL')
    const length = response.headers.get('content-length')
    if (length !== null) check(/^\d+$/.test(length) && Number(length) <= limit && budget.bytes + Number(length) <= DOWNLOAD_LIMITS.totalBytes, 'DOWNLOAD_DECLARED_SIZE_LIMIT')
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    check(url.includes('/api/') ? contentType === 'application/json' : ['image/jpeg', 'image/jpg', 'application/octet-stream'].includes(contentType), 'DOWNLOAD_CONTENT_TYPE_INVALID')
    check(response.body, 'DOWNLOAD_BODY_MISSING')
    reader = response.body.getReader(); const chunks = []; let total = 0
    while (true) {
      const { done, value: chunk } = await reader.read(); if (done) break
      total += chunk.byteLength; budget.bytes += chunk.byteLength
      check(total <= limit && budget.bytes <= DOWNLOAD_LIMITS.totalBytes, 'DOWNLOAD_STREAM_SIZE_LIMIT')
      chunks.push(Buffer.from(chunk))
    }
    check(total > 0, 'DOWNLOAD_BODY_EMPTY')
    return Buffer.concat(chunks, total)
  } finally { clearTimeout(timer); if (reader) await reader.cancel().catch(() => {}); else await response?.body?.cancel().catch(() => {}) }
}

export async function validateDownloadedJpeg(bytes) {
  check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= DOWNLOAD_LIMITS.requestBytes, 'DOWNLOAD_IMAGE_SIZE_LIMIT')
  try {
    const decoder = sharp(bytes, { failOn: 'error', limitInputPixels: DOWNLOAD_LIMITS.pixels })
    const meta = await decoder.metadata()
    check(meta.format === 'jpeg' && (meta.pages || 1) === 1 && meta.width >= 300 && meta.height >= 300, 'DOWNLOAD_IMAGE_FORMAT_OR_DIMENSIONS')
    await decoder.stats()
    return { sha256: digest(bytes), bytes: bytes.length, width: meta.width, height: meta.height }
  } catch (error) { if (error?.message?.startsWith('DOWNLOAD_')) throw error; fail('DOWNLOAD_IMAGE_DECODE_FAILED') }
}

export async function fetchMetadataPage(page, { budget, attempts, fetchImpl = fetch, wait = sleep, clock = () => new Date().toISOString() }) {
  const url = searchUrl(page)
  for (let attempt = 1; attempt <= DOWNLOAD_LIMITS.metadataAttemptsPerPage; attempt++) {
    check(attempts.length < DOWNLOAD_LIMITS.attempts && budget.bytes < DOWNLOAD_LIMITS.totalBytes, 'DOWNLOAD_REQUEST_OR_BYTE_BUDGET_REACHED')
    if (attempt > 1) await wait(7000)
    try {
      const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedSourceFetch(url, { limit: DOWNLOAD_LIMITS.metadataBytes, budget, fetchImpl })))
      check(Array.isArray(data.products) && data.products.length <= DOWNLOAD_LIMITS.productsPerPage, 'DOWNLOAD_PRODUCT_PAGE_INVALID')
      attempts.push({ kind: 'metadata', page, attempt, url, outcome: 'fetched', products: data.products.length, at: clock() })
      return data
    } catch (error) {
      const reason = safeError(error)
      attempts.push({ kind: 'metadata', page, attempt, url, outcome: 'failed', reason, at: clock() })
      if (!['HTTP_429', 'HTTP_502', 'HTTP_503', 'HTTP_504'].includes(reason) || attempt === DOWNLOAD_LIMITS.metadataAttemptsPerPage) throw error
    }
  }
}

export function intakeTemplate(images) {
  return images.map((image, index) => ({ id: `PUBLIC-${String(index + 1).padStart(3, '0')}`, productKey: image.code, sourcePath: image.localPath, capturedAt: null, acquiredAt: image.fetchedAt, collectorId: null, previouslyUsedForDevelopment: null, captureRights: 'licensed-for-evaluation', rightsNote: `Open Food Facts contributors${image.uploader ? `; contributor ${image.uploader}` : ''}. CC BY-SA 3.0. ${image.productUrl}; source image ${image.sourceUrl}; ${SOURCE_LINKS.imageLicense}. Bytes unchanged by NiyamLens. Acquisition time is NOT capture time.`, conditions: [], scripts: [], shape: null, groundTruth: null, humanMetadataReviewRequired: true }))
}

export function parseDownloadArgs(args) {
  const options = { count: 30, download: false }
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    if (option === '--download') { check(!options.download, 'DOWNLOAD_DUPLICATE_OPTION'); options.download = true }
    else if (['--output', '--count'].includes(option)) {
      check(args[index + 1] && !args[index + 1].startsWith('--'), 'DOWNLOAD_OPTION_VALUE_MISSING')
      const name = option.slice(2); check(!Object.hasOwn(options, `seen_${name}`), 'DOWNLOAD_DUPLICATE_OPTION'); options[`seen_${name}`] = true
      options[name] = name === 'count' ? Number(args[++index]) : args[++index]
    } else fail('DOWNLOAD_OPTION_UNKNOWN')
  }
  check(options.download && typeof options.output === 'string' && isAbsolute(options.output) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(basename(options.output)) && Number.isSafeInteger(options.count) && options.count >= 20 && options.count <= 30, 'DOWNLOAD_EXPLICIT_OPT_IN_AND_NEW_ABSOLUTE_FOLDER_REQUIRED')
  return { output: resolve(options.output), count: options.count }
}

export async function downloadPilot({ output, count }, { inventory, fetchImpl = fetch, wait = sleep, clock = () => new Date().toISOString() } = {}) {
  check(isAbsolute(output) && Number.isSafeInteger(count) && count >= 20 && count <= 30, 'DOWNLOAD_OPTIONS_INVALID')
  inventory ??= await readPilotExclusions(repoRoot)
  // Resolve parent before creating one new leaf. An existing output folder,
  // even an empty one, fails; nothing in it is touched or recursively deleted.
  const parent = await realpath(dirname(output)); const target = join(parent, basename(output))
  await mkdir(target, { recursive: false })
  const imageDir = join(target, 'photos'); await mkdir(imageDir, { recursive: false })
  const createdAt = clock(); const budget = { bytes: 0 }; const attempts = []; const skips = []; const images = []
  const seenProducts = new Set(); const excludedProducts = new Set(inventory.products); const seenHashes = new Set(inventory.hashes)
  let stopReason = null; let lastSearchAt = 0
  try {
    for (let page = 1; page <= DOWNLOAD_LIMITS.pages && images.length < count; page++) {
      if (page > 1) await wait(7000) // At most 10 search requests/minute, no search-as-you-type.
      lastSearchAt = page
      let data
      try { data = await fetchMetadataPage(page, { budget, attempts, fetchImpl, wait, clock }) }
      catch (error) { stopReason = safeError(error) === 'DOWNLOAD_REQUEST_OR_BYTE_BUDGET_REACHED' ? 'bounded-attempt-or-byte-limit' : 'metadata-unavailable-after-bounded-attempts'; break }
      const selected = selectProductCandidates(data.products, { excludedProducts, seenProducts }); skips.push(...selected.skips)
      for (const candidate of selected.candidates) {
        if (images.length >= count) break
        if (attempts.length >= DOWNLOAD_LIMITS.attempts || budget.bytes >= DOWNLOAD_LIMITS.totalBytes) { stopReason = 'bounded-attempt-or-byte-limit'; break }
        let saved = false
        for (const url of candidate.urls) {
          if (attempts.length >= DOWNLOAD_LIMITS.attempts) { stopReason = 'bounded-attempt-or-byte-limit'; break }
          await wait(new URL(url).hostname === 'images.openfoodfacts.org' ? 2000 : 1000)
          try {
            const bytes = await boundedSourceFetch(url, { limit: DOWNLOAD_LIMITS.requestBytes, budget, fetchImpl })
            const meta = await validateDownloadedJpeg(bytes)
            if (seenHashes.has(meta.sha256)) { attempts.push({ kind: 'image', code: candidate.code, imageId: candidate.imageId, url, outcome: 'skipped', reason: 'exact-image-hash-already-recorded', at: clock() }); break }
            const localPath = `photos/${candidate.code}-${candidate.imageId}.jpg`
            await writeFile(join(target, localPath), bytes, { flag: 'wx' })
            const { urls, ...source } = candidate
            images.push({ ...source, ...meta, sourceUrl: url, localPath, fetchedAt: clock(), originalCaptureTime: null, bytesReencoded: false, captureDateIndependentlyVerified: false })
            seenHashes.add(meta.sha256); attempts.push({ kind: 'image', code: candidate.code, imageId: candidate.imageId, url, outcome: 'saved', sha256: meta.sha256, at: clock() }); saved = true; break
          } catch (error) { attempts.push({ kind: 'image', code: candidate.code, imageId: candidate.imageId, url, outcome: 'failed', reason: safeError(error), at: clock() }); if (budget.bytes >= DOWNLOAD_LIMITS.totalBytes) break }
        }
        if (!saved) skips.push({ code: candidate.code, imageId: candidate.imageId, reason: 'chosen-original-not-collected-see-attempts' })
      }
      if (stopReason || data.products.length < 100) break
    }
  } catch (error) { stopReason = safeError(error) }
  const manifest = { schemaVersion: 1, kind: 'public-label-photo-download', createdAt, completedAt: clock(), requestedCount: count, downloadedCount: images.length, requestedCountMet: images.length === count, stopReason, pagesRequested: lastSearchAt, networkBodyBytesRead: budget.bytes, totalImageBytesSaved: images.reduce((sum, image) => sum + image.bytes, 0), originalPhotosOnly: true, ocrExecuted: false, ocrAnnotationsFetched: false, groundTruthCreated: false, isHoldout: false, priorModelTrainingExposureKnown: false, exclusionInventorySha256: inventory.sha256, excludedProductCount: inventory.products.length, excludedImageHashCount: inventory.hashes.length, licenses: { images: 'CC BY-SA 3.0', database: 'ODbL 1.0', attribution: 'Open Food Facts contributors; individual uploader retained where supplied', links: SOURCE_LINKS }, selection: 'First eligible SKU-disjoint India-tagged products in API last_modified_t order, one numeric-key original per SKU; prefer ingredients/nutrition selected source imgid, otherwise latest numeric original not selected as front among at least two originals. Single-photo products without an ingredients/nutrition selection are skipped. A non-front label role is only inferred, never visually asserted. No OCR/catalog quantity answers are queried. Download/decode failures and exact duplicates are logged, not scored as successes.', limitations: ['Purposeful public-image acquisition is not a representative field sample or a model-training-disjoint holdout.', 'India country tag is contributor-supplied and does not prove manufacture location, current market status or statutory compliance.', 'Preferred ingredients/nutrition source may lack MRP/date. Human screening must retain an honest selection log.', 'Contributor upload time is not photo capture time. Shape, languages, conditions and labels are not fabricated.', 'Original OFF JPEG may already reflect OFF processing; no claim of camera-original EXIF authenticity is made.', 'S3 mirror is updated periodically and can miss recent images; the official image server is a bounded fallback.'], images, attempts, skips }
  await writeFile(join(target, 'download-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  await writeFile(join(target, 'human-review-intake.template.json'), `${JSON.stringify(intakeTemplate(images), null, 2)}\n`, { flag: 'wx' })
  const readme = `# NiyamLens public-label photo collection\n\nDownloaded ${images.length} of ${count} requested distinct-SKU photographs. This is acquisition only: no OCR, ground truth, accuracy result or legal verdict. Read download-manifest.json for every attempt/skip and the exact SHA-256 hashes.\n\n## Rights\n\nImages: Open Food Facts contributors, CC BY-SA 3.0 (${SOURCE_LINKS.imageLicense}). Per-image uploader/source/product links are in the manifest. Database metadata: ODbL 1.0 (${SOURCE_LINKS.databaseLicense}). Keep this attribution with shared images and mark any later modifications; derived image materials retain the applicable ShareAlike obligations. OFF's source license guide: ${SOURCE_LINKS.license}. Packaging can contain third-party graphics/trademarks; this does not imply endorsement.\n\n## Human review required\n\nThe intake template deliberately leaves collector identity, prior-development attestation, shape, scripts, conditions and labels unfilled. acquiredAt is our actual download time; capturedAt remains null because the source does not establish it. Do not replace it with upload/download time. Inspect each photograph without OCR outputs, record real observations, and use the repository's field-pilot workflow with --photo-root pointing to this directory. Use two independent human labelers and a third adjudicator when needed. The template is not import/freeze ready until required metadata is genuinely reviewed. No field values should be copied from the product catalogue or Google OCR sidecars.\n\n## Scope and limitations\n\nNew relative to the recorded development SKU/hash inventory only; unknown pretrained model exposure. One source view per product; MRP/date visibility and language coverage are unconfirmed. Keep excluded/failed attempts when reporting selection bias. The original download files are create-only and unchanged; use new versioned files for later annotations. No backup or cloud case was created.\n`
  await writeFile(join(target, 'README.md'), readme, { flag: 'wx' })
  return { output: target, requestedCount: count, downloadedCount: images.length, requestedCountMet: images.length === count, metadataReadyForFreeze: false, totalImageBytes: manifest.totalImageBytesSaved, manifestSha256: digest(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)), stopReason }
}

export async function main(args = process.argv.slice(2)) { return downloadPilot(parseDownloadArgs(args)) }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.requestedCountMet) process.exitCode = 2 }).catch(error => { console.error(JSON.stringify({ passed: false, error: safeError(error) })); process.exitCode = 1 })
}
