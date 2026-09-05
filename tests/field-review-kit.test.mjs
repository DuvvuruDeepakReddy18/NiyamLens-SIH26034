import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildLeadWorksheet, buildReviewerTemplate, prepareFieldReviewKit, selectReservedSamples } from '../tools/prepare-field-review-kit.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const jpeg = index => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`opaque-test-photo-${index}`), Buffer.from([0xff, 0xd9])])

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-review-kit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); const photos = join(source, 'photos')
  await mkdir(photos, { recursive: true })
  const intake = []; const rows = []
  for (let index = 1; index <= 30; index++) {
    const id = `PUBLIC-${String(index).padStart(3, '0')}`
    const productKey = `product-${String(index).padStart(3, '0')}`
    const sourcePath = `photos/photo-${String(index).padStart(3, '0')}.jpg`
    const bytes = jpeg(index)
    await writeFile(join(source, sourcePath), bytes)
    intake.push({ id, productKey, sourcePath, acquiredAt: '2026-09-04T15:28:54.831Z', capturedAt: null, captureRights: 'licensed-for-evaluation', collectorId: null, shape: null, scripts: [], conditions: [], previouslyUsedForDevelopment: null, rightsNote: index === 7 ? 'Licensed source </script><img src=x onerror=alert(1)>' : `Licensed source ${index}`, groundTruth: null, humanMetadataReviewRequired: true })
    if (index <= 6) rows.push({ sampleId: id, productKey, sourcePath, sourceSha256: hash(bytes), rawText: 'OCR_SECRET_SHOULD_NOT_APPEAR', extractedSuggestions: { mrp: 'EXPECTED_VALUE_SHOULD_NOT_APPEAR' } })
  }
  const exploratory = { schemaVersion: 1, kind: 'exploratory-field-ocr-smoke', isHoldout: false, groundTruthProvided: false, accuracy: null, rows }
  const intakePath = join(source, 'human-review-intake.template.json'); const exploratoryOcrPath = join(source, 'exploratory-ocr-raw-v1.json')
  await writeFile(intakePath, JSON.stringify(intake)); await writeFile(exploratoryOcrPath, JSON.stringify(exploratory))
  return { root, source, intakePath, exploratoryOcrPath, output: join(root, 'kit') }
}

test('review kit excludes all exploratory IDs/products without carrying OCR or fake labels', async t => {
  const value = await fixture(t)
  const result = await prepareFieldReviewKit({ ...value, photoRoot: value.source, expectedCount: 24, now: () => '2026-09-05T04:30:00.000Z' })
  assert.equal(result.photoCount, 24); assert.equal(result.excludedCount, 6)
  assert.deepEqual(result.claims, { groundTruthProvided: false, isHoldout: false, ocrExecutedByGenerator: false, reviewerIdentityVerified: false })

  const selectionText = await readFile(join(value.output, 'selection-manifest.json'), 'utf8')
  const selection = JSON.parse(selectionText)
  assert.equal(selection.samples.length, 24); assert.equal(selection.excluded.length, 6)
  assert.deepEqual(selection.samples.map(sample => sample.id), Array.from({ length: 24 }, (_, index) => `PUBLIC-${String(index + 7).padStart(3, '0')}`))
  assert.equal(selection.groundTruthProvided, false); assert.equal(selection.isHoldout, false)
  assert.ok(!selectionText.includes('OCR_SECRET_SHOULD_NOT_APPEAR'))
  assert.ok(!selectionText.includes('EXPECTED_VALUE_SHOULD_NOT_APPEAR'))
  assert.ok(!selectionText.includes('rawText'))
  assert.ok(!selection.samples.some(sample => Object.hasOwn(sample, 'dataUrl') || Object.hasOwn(sample, 'groundTruth') || Object.hasOwn(sample, 'expectedValues')))

  for (const name of ['reviewer-a.template.json', 'reviewer-b.template.json']) {
    const reviewer = JSON.parse(await readFile(join(value.output, name), 'utf8'))
    assert.equal(reviewer.reviewerId, null); assert.equal(reviewer.reviewedAt, null)
    assert.equal(reviewer.ocrOutputsConsulted, null); assert.equal(reviewer.independentPhotoReview, null)
    assert.equal(reviewer.status, 'blank-reviewer-input')
    for (const review of reviewer.reviews) for (const field of Object.values(review.fields)) assert.deepEqual(field, { status: 'pending', value: null, metricEligible: false, verbatim: '', notes: '' })
  }

  const lead = JSON.parse(await readFile(join(value.output, 'lead-metadata-worksheet.json'), 'utf8'))
  assert.equal(lead.status, 'unfilled-not-import-or-freeze-ready')
  assert.equal(lead.completedBy, null); assert.equal(lead.completedAt, null)
  for (const sample of lead.samples) {
    assert.equal(sample.collectorId, null); assert.equal(sample.capturedAt, null)
    assert.equal(sample.previouslyUsedForDevelopment, null); assert.equal(sample.shape, null)
    assert.deepEqual(sample.scripts, []); assert.deepEqual(sample.conditions, [])
  }
})

test('self-contained reviewer HTML escapes attribution, blocks network and binds exports to hashes', async t => {
  const value = await fixture(t)
  await prepareFieldReviewKit({ ...value, photoRoot: value.source, expectedCount: 24 })
  const html = await readFile(join(value.output, 'review.html'), 'utf8')
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /data:image\/jpeg;base64,/)
  assert.match(html, /sourceSelectionSha256/)
  assert.match(html, /original SHA-256/i)
  assert.match(html, /textContent/)
  assert.ok(!html.includes('innerHTML'))
  assert.ok(!html.includes('OCR_SECRET_SHOULD_NOT_APPEAR'))
  assert.ok(!html.includes('EXPECTED_VALUE_SHOULD_NOT_APPEAR'))
  assert.ok(!html.includes('</script><img src=x onerror=alert(1)>'))
  assert.match(html, /\\u003c\/script\\u003e\\u003cimg/)
  assert.match(html, /reviewer-entered-complete/)
  assert.match(html, /reviewer-device-clock-at-export/)
})

test('selection and worksheets preserve uncertainty and reject count drift or overwrite', async t => {
  const value = await fixture(t)
  const sample = index => ({ id: `P-${index}`, productKey: `sku-${index}`, sourcePath: `p-${index}.jpg`, sha256: String(index).padStart(64, '0') })
  const selected = selectReservedSamples([sample(1), sample(2)], [{ sampleId: 'P-1', productKey: 'sku-1', sourcePath: 'p-1.jpg', sourceSha256: sample(1).sha256 }], 1)
  assert.deepEqual(selected.reserved.map(item => item.id), ['P-2'])
  assert.throws(() => selectReservedSamples([sample(1), sample(2)], [], 1), /Expected exactly 1 reserved/)

  const selection = { datasetId: 'kit-test', sourceSelectionSha256: 'a'.repeat(64), samples: [{ ...sample(2), acquiredAt: '2026-09-04T00:00:00Z', capturedAt: null, captureRights: 'licensed-for-evaluation', rightsNote: 'test' }] }
  const reviewer = buildReviewerTemplate(selection, 'A'); const lead = buildLeadWorksheet(selection)
  assert.equal(reviewer.reviewerId, null); assert.equal(reviewer.reviews[0].fields.mrp.value, null)
  assert.equal(lead.samples[0].previouslyUsedForDevelopment, null); assert.equal(lead.samples[0].collectorId, null)

  await prepareFieldReviewKit({ ...value, photoRoot: value.source, expectedCount: 24 })
  await assert.rejects(prepareFieldReviewKit({ ...value, photoRoot: value.source, expectedCount: 24 }), /already exists/)
})
