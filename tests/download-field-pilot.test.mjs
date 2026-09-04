import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, unlink, rmdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { DOWNLOAD_LIMITS, searchUrl, rawImageUrls, validateSourceUrl, selectProductCandidates, boundedSourceFetch, fetchMetadataPage, validateDownloadedJpeg, intakeTemplate, parseDownloadArgs, downloadPilot } from '../tools/download-field-pilot.mjs'

const product = (code = '8901764385155') => ({ code, product_name: 'Public package', brands: 'Test metadata', countries_tags: ['en:india'], images: { '1': { uploader: 'contributor-one', uploaded_t: '1650000000' }, '2': { uploader: 'contributor-two', uploaded_t: 1700000000 }, nutrition_en: { imgid: '2', rev: '10' }, front_en: { imgid: '1' } } })
const fixtureJpeg = () => sharp({ create: { width: 320, height: 300, channels: 3, background: '#765432' } }).jpeg().toBuffer()

test('download query is bounded India metadata only, without quantities or OCR answers', () => {
  const url = new URL(searchUrl(1))
  assert.equal(url.searchParams.get('countries_tags_en'), 'india')
  assert.equal(url.searchParams.get('page_size'), '100')
  assert.equal(url.searchParams.get('fields'), 'code,product_name,brands,countries_tags,images')
  assert.throws(() => searchUrl(6), /DOWNLOAD_PAGE_INVALID/)
})

test('candidate selection takes one numeric original per new SKU and preserves upload provenance', () => {
  const excluded = product('8900000000001')
  const result = selectProductCandidates([excluded, product(), product()], { excludedProducts: new Set([excluded.code]) })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].imageId, '2')
  assert.equal(result.candidates[0].uploader, 'contributor-two')
  assert.equal(result.candidates[0].uploaded_t, 1700000000)
  assert.equal(result.candidates[0].uploadTimeIsCaptureTime, false)
  assert.ok(result.candidates[0].urls.every(url => url.endsWith('/2.jpg')))
  assert.deepEqual(result.skips.map(item => item.reason), ['recorded-development-sku', 'already-considered-sku'])
})

test('path builder uses documented raw original paths and rejects unsupported source URLs', () => {
  assert.equal(rawImageUrls('8901764385155', '2')[0], 'https://openfoodfacts-images.s3.eu-west-3.amazonaws.com/data/890/176/438/5155/2.jpg')
  assert.equal(rawImageUrls('12345678', '1')[1], 'https://images.openfoodfacts.org/images/products/12345678/1.jpg')
  for (const value of ['http://images.openfoodfacts.org/images/products/12345678/1.jpg', 'https://user:pass@images.openfoodfacts.org/images/products/12345678/1.jpg', 'https://images.openfoodfacts.org.evil.test/1.jpg', 'https://127.0.0.1/1.jpg', 'https://images.openfoodfacts.org/images/products/12345678/1.json.gz', 'https://images.openfoodfacts.org/images/products/12345678/front_en.1.full.jpg', 'https://images.openfoodfacts.org/images/products/12345678/1.jpg?secret=yes']) assert.throws(() => validateSourceUrl(value), /DOWNLOAD_/)
  assert.throws(() => rawImageUrls('../outside', '1'), /DOWNLOAD_IMAGE_ID_INVALID/)
})

test('candidate metadata cannot invent country membership, images or selected original ids', () => {
  const noCountry = product('8900000000001'); noCountry.countries_tags = ['en:france']
  const noOriginal = product('8900000000002'); noOriginal.images = { ingredients_en: { imgid: '999' } }
  assert.equal(selectProductCandidates([noCountry, noOriginal]).candidates.length, 0)
})

test('front-only products are skipped and fallback role is explicitly unverified', () => {
  const frontOnly = product('8900000000001'); frontOnly.images = { '1': {}, front_en: { imgid: '1' } }
  const fallback = product('8900000000002'); delete fallback.images.nutrition_en
  const result = selectProductCandidates([frontOnly, fallback])
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].code, fallback.code)
  assert.equal(result.candidates[0].imageId, '2'); assert.equal(result.candidates[0].preferredRole, null)
  assert.equal(result.candidates[0].labelPanelVisuallyVerified, false)
  assert.match(result.candidates[0].panelSelectionBasis, /role-unverified/)
  assert.equal(DOWNLOAD_LIMITS.pixels, 25_000_000)
})

test('bounded download refuses redirects and oversized bodies and omits credentials', async () => {
  const url = rawImageUrls('8901764385155', '2')[0]
  await assert.rejects(boundedSourceFetch(url, { limit: 100, budget: { bytes: 0 }, fetchImpl: async (_, options) => { assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit'); return new Response(null, { status: 302, headers: { location: 'https://example.com' } }) } }), /DOWNLOAD_REDIRECT_REFUSED/)
  await assert.rejects(boundedSourceFetch(url, { limit: 100, budget: { bytes: 0 }, fetchImpl: async () => new Response(Buffer.alloc(101), { headers: { 'content-type': 'image/jpeg' } }) }), /DOWNLOAD_STREAM_SIZE_LIMIT/)
  await assert.rejects(boundedSourceFetch(url, { limit: 100, budget: { bytes: DOWNLOAD_LIMITS.totalBytes }, fetchImpl: async () => new Response(Buffer.alloc(1), { headers: { 'content-type': 'image/jpeg', 'content-length': '1' } }) }), /DOWNLOAD_DECLARED_SIZE_LIMIT/)
})

test('transient metadata errors retry at seven-second intervals and preserve every attempt', async () => {
  const attempts = []; const waits = []; const statuses = [503, 429, 200]
  const data = await fetchMetadataPage(1, { budget: { bytes: 0 }, attempts, wait: async ms => waits.push(ms), fetchImpl: async () => { const status = statuses.shift(); return new Response(status === 200 ? JSON.stringify({ products: [] }) : null, { status, headers: { 'content-type': 'application/json' } }) } })
  assert.deepEqual(data.products, [])
  assert.deepEqual(waits, [7000, 7000])
  assert.deepEqual(attempts.map(item => item.outcome), ['failed', 'failed', 'fetched'])
  assert.deepEqual(attempts.map(item => item.attempt), [1, 2, 3])
  assert.deepEqual(attempts.slice(0, 2).map(item => item.reason), ['HTTP_503', 'HTTP_429'])
})

test('metadata retries stop after three requests or immediately for non-transient errors', async () => {
  for (const [status, expected] of [[502, 3], [503, 3], [504, 3], [401, 1]]) {
    const attempts = []; let calls = 0
    await assert.rejects(fetchMetadataPage(1, { budget: { bytes: 0 }, attempts, wait: async () => {}, fetchImpl: async () => { calls++; return new Response(null, { status }) } }), new RegExp(`HTTP_${status}`))
    assert.equal(calls, expected); assert.equal(attempts.length, expected)
  }
})

test('metadata retries share the total request budget with image downloads', async () => {
  const attempts = Array.from({ length: DOWNLOAD_LIMITS.attempts - 1 }, () => ({ kind: 'image' }))
  let calls = 0
  await assert.rejects(fetchMetadataPage(1, { budget: { bytes: 0 }, attempts, wait: async () => {}, fetchImpl: async () => { calls++; return new Response(null, { status: 503 }) } }), /DOWNLOAD_REQUEST_OR_BYTE_BUDGET_REACHED/)
  assert.equal(calls, 1); assert.equal(attempts.length, DOWNLOAD_LIMITS.attempts)
})

test('image acceptance checks actual decode, static JPEG type and minimum dimensions', async () => {
  const jpeg = await fixtureJpeg()
  const meta = await validateDownloadedJpeg(jpeg)
  assert.equal(meta.width, 320); assert.equal(meta.height, 300); assert.match(meta.sha256, /^[a-f0-9]{64}$/)
  await assert.rejects(validateDownloadedJpeg(Buffer.from('not JPEG')), /DOWNLOAD_IMAGE_DECODE_FAILED/)
  await assert.rejects(validateDownloadedJpeg(await sharp(jpeg).resize(299, 299).jpeg().toBuffer()), /DOWNLOAD_IMAGE_FORMAT_OR_DIMENSIONS/)
  await assert.rejects(validateDownloadedJpeg(await sharp(jpeg).png().toBuffer()), /DOWNLOAD_IMAGE_FORMAT_OR_DIMENSIONS/)
})

test('intake records acquisition separately and refuses to invent human labels or capture metadata', () => {
  const [intake] = intakeTemplate([{ code: '8901764385155', localPath: 'photos/8901764385155-2.jpg', fetchedAt: '2026-09-04T18:00:00.000Z', uploader: 'contributor-two', productUrl: 'https://world.openfoodfacts.org/product/8901764385155', sourceUrl: rawImageUrls('8901764385155', '2')[0] }])
  assert.equal(intake.capturedAt, null); assert.equal(intake.acquiredAt, '2026-09-04T18:00:00.000Z')
  assert.equal(intake.collectorId, null); assert.equal(intake.previouslyUsedForDevelopment, null)
  assert.equal(intake.groundTruth, null); assert.equal(intake.shape, null)
  assert.deepEqual(intake.scripts, []); assert.deepEqual(intake.conditions, [])
  assert.equal(Object.hasOwn(intake, 'sha256'), false)
})

test('CLI requires explicit download, absolute new-folder path and count between 20 and 30', () => {
  const output = join(tmpdir(), 'niyamlens-public-pilot-test')
  assert.deepEqual(parseDownloadArgs(['--output', output, '--count', '30', '--download']), { output, count: 30 })
  for (const args of [['--output', output], ['--output', 'relative', '--download'], ['--output', output, '--count', '31', '--download'], ['--output', output, '--download', '--download']]) assert.throws(() => parseDownloadArgs(args), /DOWNLOAD_/)
})

test('mock acquisition is create-only, logs partial count and refuses exact duplicate hashes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'niyamlens-download-test-')); const output = join(parent, 'new-collection')
  const jpeg = await fixtureJpeg(); let requests = 0
  const fetchImpl = async url => { requests++; return url.includes('/api/') ? new Response(JSON.stringify({ products: [product('8900000000001'), product('8900000000002')] }), { headers: { 'content-type': 'application/json' } }) : new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }) }
  const inventory = { products: [], hashes: [], sha256: 'a'.repeat(64) }
  try {
    const result = await downloadPilot({ output, count: 20 }, { inventory, fetchImpl, wait: async () => {}, clock: () => '2026-09-04T18:00:00.000Z' })
    assert.equal(result.downloadedCount, 1); assert.equal(result.requestedCountMet, false)
    const manifest = JSON.parse(await readFile(join(output, 'download-manifest.json'), 'utf8'))
    assert.equal(manifest.ocrExecuted, false); assert.equal(manifest.groundTruthCreated, false)
    assert.equal(manifest.images[0].localPath, 'photos/8900000000001-2.jpg')
    assert.ok(manifest.attempts.some(item => item.reason === 'exact-image-hash-already-recorded'))
    assert.equal((await stat(join(output, manifest.images[0].localPath))).size, jpeg.length)
    const before = requests
    await assert.rejects(downloadPilot({ output, count: 20 }, { inventory, fetchImpl, wait: async () => {} }), { code: 'EEXIST' })
    assert.equal(requests, before)
  } finally {
    // Remove only explicitly owned fixture files; never recurse into a supplied
    // output path or delete a user download directory.
    for (const filename of await readdir(join(output, 'photos'))) await unlink(join(output, 'photos', filename))
    await rmdir(join(output, 'photos'))
    for (const filename of ['download-manifest.json', 'human-review-intake.template.json', 'README.md']) await unlink(join(output, filename))
    await rmdir(output); await rmdir(parent)
  }
})
