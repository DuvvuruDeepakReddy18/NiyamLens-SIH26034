#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchTestBrowser } from './browser-runtime.mjs'
import { prepareFieldReviewKit } from './prepare-field-review-kit.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function syntheticFixture(root) {
  const source = join(root, 'synthetic-source')
  const photos = join(source, 'photos')
  await mkdir(photos, { recursive: true })
  const intake = []
  const rows = []
  for (let index = 1; index <= 30; index += 1) {
    const suffix = String(index).padStart(3, '0')
    const id = `SYNTHETIC-${suffix}`
    const productKey = `synthetic-product-${suffix}`
    const sourcePath = `photos/synthetic-${suffix}.png`
    // A harmless trailing test marker gives every tiny fixture a distinct source hash.
    const bytes = Buffer.concat([onePixelPng, Buffer.from(`synthetic-${suffix}`)])
    await writeFile(join(source, sourcePath), bytes)
    intake.push({
      id,
      productKey,
      sourcePath,
      acquiredAt: '2026-09-05T00:00:00.000Z',
      capturedAt: null,
      captureRights: 'synthetic-test-only',
      collectorId: null,
      shape: null,
      scripts: [],
      conditions: [],
      previouslyUsedForDevelopment: null,
      rightsNote: 'Generated one-pixel browser-QA fixture; not a package photograph.',
      groundTruth: null,
      humanMetadataReviewRequired: true,
    })
    if (index <= 6) {
      rows.push({
        sampleId: id,
        productKey,
        sourcePath,
        sourceSha256: sha256(bytes),
        rawText: 'SYNTHETIC_OCR_MUST_NOT_REACH_KIT',
      })
    }
  }
  const exploratory = {
    schemaVersion: 1,
    kind: 'exploratory-field-ocr-smoke',
    isHoldout: false,
    groundTruthProvided: false,
    accuracy: null,
    rows,
  }
  const intakePath = join(source, 'human-review-intake.template.json')
  const exploratoryOcrPath = join(source, 'exploratory-ocr-raw-v1.json')
  await writeFile(intakePath, JSON.stringify(intake))
  await writeFile(exploratoryOcrPath, JSON.stringify(exploratory))
  return { intakePath, exploratoryOcrPath, photoRoot: source, output: join(root, 'kit') }
}

async function downloadedJson(page, button) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(button),
  ])
  const path = await download.path()
  assert.ok(path, 'Browser did not produce a local download path.')
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-review-kit-browser-'))
  let browser
  try {
    const fixture = await syntheticFixture(root)
    const result = await prepareFieldReviewKit({
      ...fixture,
      expectedCount: 24,
      now: () => '2026-09-05T00:00:00.000Z',
    })
    assert.equal(result.photoCount, 24)

    browser = await launchTestBrowser()
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    const networkRequests = []
    const pageErrors = []
    page.on('request', request => {
      if (/^https?:/i.test(request.url())) networkRequests.push(request.url())
    })
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(pathToFileURL(join(fixture.output, 'review.html')).href)

    try {
      await page.waitForFunction(() => Boolean(document.getElementById('counter')?.textContent), null, { timeout: 5000 })
    } catch (error) {
      throw new Error(`Reviewer UI did not initialize: ${pageErrors.join(' | ') || error.message}`)
    }
    assert.match(await page.textContent('#dataset'), /24 reserved photos/)
    assert.equal(await page.textContent('#counter'), 'Photo 1 of 24')
    assert.match(await page.getAttribute('#photo', 'src'), /^data:image\/png;base64,/)

    await page.selectOption('#reviewer-slot', 'A')
    await page.fill('#reviewer-id', 'synthetic-reviewer-a')
    await page.check('#no-ocr')
    await page.check('#independent')
    await page.click('#export')
    assert.equal(await page.textContent('#status'), '24 photo(s) remain incomplete.')

    for (let index = 0; index < 24; index += 1) {
      assert.equal(await page.textContent('#counter'), `Photo ${index + 1} of 24`)
      await page.selectOption('#photo-readability', 'no_critical_field_readable')
      for (const field of ['mrp', 'netQuantity', 'packDate']) {
        await page.selectOption(`[data-field="${field}"][data-part="status"]`, 'not_visible')
      }
      if (index < 23) await page.click('#next')
    }
    assert.equal(await page.textContent('#progress'), '24 / 24 photos complete')

    const completed = await downloadedJson(page, '#export')
    assert.equal(completed.status, 'reviewer-entered-complete')
    assert.equal(completed.reviewerId, 'synthetic-reviewer-a')
    assert.equal(completed.reviews.length, 24)
    for (const row of completed.reviews) {
      assert.equal(row.reviewerId, 'synthetic-reviewer-a')
      assert.equal(row.reviewedAt, completed.reviewedAt)
      assert.equal(row.ocrOutputsConsulted, false)
      assert.equal(row.independentPhotoReview, true)
      for (const field of Object.values(row.fields)) {
        assert.equal(field.status, 'not_visible')
        assert.equal(field.value, null)
        assert.equal(field.metricEligible, false)
      }
    }

    await page.fill('#photo-notes', 'Synthetic post-export edit')
    const draft = await downloadedJson(page, '#save-draft')
    assert.equal(draft.status, 'draft-reviewer-input')
    assert.equal(draft.reviewedAt, null)
    assert.ok(draft.reviews.every(row => !Object.hasOwn(row, 'reviewerId')))
    assert.deepEqual(networkRequests, [])

    await context.close()
    process.stdout.write('PASS: offline reviewer UI completed 24 synthetic rows, exported bound reviewer JSON, invalidated edited completion, and made no HTTP(S) request. Reserved photographs were not opened or decoded.\n')
  } finally {
    if (browser) await browser.close()
    await rm(root, { recursive: true, force: true })
  }
}

main().catch(error => {
  process.stderr.write(`Reviewer-kit browser QA failed: ${error.stack || error.message}\n`)
  process.exitCode = 1
})
