import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { adaptCriticalOcrInput, normalizeCriticalValue, scoreCriticalFields, validateCriticalFieldManifest } from '../src/lib/criticalFieldBenchmark.mjs'
import { verifyCriticalSourceImages } from '../tools/score-critical-fields.mjs'

const clone = value => structuredClone(value)
const label = value => ({ status: 'readable', value, metricEligible: true })
const sample = (id = 'ONE') => ({ id, sourcePath: `datasets/${id}.jpg`, sha256: 'a'.repeat(64), expectedStatus: null, expectedValues: { mrp: '22.00', netQuantity: '500 ml', packDate: '19/10/25' }, fields: { mrp: label('22.00'), netQuantity: label('500 ml'), packDate: label('19/10/25') } })
const manifest = (...samples) => ({ schemaVersion: 1, datasetId: 'test-critical-fields', corpusRole: 'previously-used-development-corpus', isHoldout: false, annotation: { status: 'provisional-human-review-required', humanReviewed: false }, samples: samples.length ? samples : [sample()] })
const row = (rawText = 'MRP Rs. 22.00\nNET QUANTITY: 500 mL\nPKD:19/10/25', extra = {}) => ({ sampleId: 'ONE', mode: 'test', rawText, ...extra })
const run = (rawText, extra = {}) => scoreCriticalFields(manifest(), [row(rawText, extra)]).runs[0]

test('critical scorer uses actual extraction on untouched text and returns valid exact matches', () => {
  const input = row()
  const original = clone(input)
  const result = scoreCriticalFields(manifest(), [input])
  assert.deepEqual(input, original)
  assert.equal(result.runs[0].exactMatchCorrect, 3)
  assert.equal(result.runs[0].exactMatchSamples, 3)
  assert.equal(result.runs[0].exactMatchRate, 1)
  assert.equal(result.runs[0].sampleResults[0].rawText, input.rawText)
  assert.equal(result.complianceVerdictMetric, null)
  assert.equal(result.isHoldout, false)
  assert.equal(result.humanReviewed, false)
})

test('numeric-presence and supplied extracted predictions cannot manufacture a match', () => {
  const result = scoreCriticalFields(manifest(), [row('22.00\n500 mL\nUse By 19/10/25', { extracted: { mrp: '22.00', netQuantity: '500 ml', packDate: '19/10/25' }, visibleChecks: { all: true } })]).runs[0]
  assert.equal(result.exactMatchCorrect, 0)
  assert.equal(result.sampleResults[0].fields.packDate.outcome, 'not_extracted')
})

test('valid but wrong quantity, price and calendar year remain explicit failures', () => {
  const result = run('MRP Rs. 220.00\nNET QTY 500 g\nPACKED ON 19/10/20')
  for (const field of ['mrp', 'netQuantity', 'packDate']) {
    const item = result.sampleResults[0].fields[field]
    assert.equal(item.outcome, 'wrong_value')
    assert.equal(item.valid, true)
    assert.equal(item.correct, false)
    assert.equal(item.wrongNumericCandidates.length, 1)
  }
})

test('conflicting candidates never pass by choosing the ground-truth candidate', () => {
  const result = run('MRP Rs. 22.00\nMRP Rs. 50.00\nNET QTY 500 ml\nNET QTY 1 l\nPKD 19/10/25\nPKD 20/10/25')
  assert.equal(result.exactMatchCorrect, 0)
  for (const field of Object.values(result.sampleResults[0].fields)) {
    assert.equal(field.outcome, 'conflict')
    assert.equal(field.candidates.length, 2)
    assert.equal(field.valid, false)
  }
})

test('invalid or OCR-confused candidates stay invalid without manual repair', () => {
  const result = run('MRP Rs. 22.00ABC\nNET QTY 5OO ml\nPKD 31/02/25')
  assert.equal(result.exactMatchCorrect, 0)
  assert.equal(result.sampleResults[0].fields.mrp.outcome, 'invalid_candidate')
  assert.equal(result.sampleResults[0].fields.netQuantity.outcome, 'invalid_candidate')
  assert.equal(result.sampleResults[0].fields.packDate.outcome, 'invalid_candidate')
})

test('normalization permits only case/whitespace and quantity spelling, not semantic repair', () => {
  assert.equal(normalizeCriticalValue('netQuantity', ' 1 Litre '), '1 l')
  assert.equal(normalizeCriticalValue('netQuantity', '1 ℓ'), '1 l')
  assert.notEqual(normalizeCriticalValue('netQuantity', '500 mr'), '500 ml')
  assert.notEqual(normalizeCriticalValue('packDate', '19/10/2025'), '19/10/25')
  assert.equal(run('MRP Rs. 22\nNET QTY 500 ml\nPKD 19/10/25').perField.mrp.exactMatchRate, 0)
})

test('nonreadable labels are exclusions and never become correct negatives', () => {
  const source = sample()
  source.fields.mrp = { status: 'ambiguous_field', value: null, metricEligible: false, notes: 'Retailer price is not labelled MRP.' }
  delete source.expectedValues.mrp
  const result = scoreCriticalFields(manifest(source), [row()]).runs[0]
  assert.equal(result.exactMatchSamples, 2)
  assert.equal(result.perField.mrp.exactMatchRate, null)
  assert.equal(result.perField.mrp.excludedFields, 1)
  assert.equal(result.perField.mrp.excludedWithCandidates, 1)
  assert.equal(result.sampleResults[0].fields.mrp.correct, null)
  assert.equal(result.sampleResults[0].fields.mrp.outcome, 'excluded_label')
})

test('partial mode coverage preserves full denominators and null complete-corpus accuracy', () => {
  const result = scoreCriticalFields(manifest(sample(), sample('TWO')), [row()]).runs[0]
  assert.equal(result.attemptedPhotos, 1)
  assert.equal(result.missingPhotos, 1)
  assert.equal(result.exactMatchSamples, 6)
  assert.equal(result.attemptedExactMatchSamples, 3)
  assert.equal(result.exactMatchRate, null)
  assert.equal(result.attemptedExactMatchRate, 1)
  assert.equal(result.perField.mrp.missingRunFields, 1)
  assert.equal(result.sampleResults[1].fields.mrp.outcome, 'missing_run')
})

test('OCR errors and empty completed transcripts count as attempted failures', () => {
  const result = scoreCriticalFields(manifest(sample(), sample('TWO')), [row('', { error: 'Worker failed' }), row('', { sampleId: 'TWO' })]).runs[0]
  assert.equal(result.exactMatchSamples, 6)
  assert.equal(result.attemptedExactMatchSamples, 6)
  assert.equal(result.exactMatchRate, 0)
  assert.equal(result.failedPhotos, 1)
  assert.equal(result.perField.mrp.errorFields, 1)
  assert.equal(result.sampleResults[1].fields.mrp.outcome, 'not_extracted')
})

test('modes are scored independently and not merged to cherry-pick passing fields', () => {
  const result = scoreCriticalFields(manifest(), [row('MRP Rs.22.00', { mode: 'first' }), row('NET QTY 500 ml\nPKD 19/10/25', { mode: 'second' })])
  assert.equal(result.runs.length, 2)
  assert.deepEqual(result.runs.map(item => item.exactMatchCorrect), [1, 2])
  assert.equal(Object.hasOwn(result, 'bestOfAllModesAccuracy'), false)
})

test('malformed manifests, unreviewed holdout claims and inconsistent labels are rejected', () => {
  for (const value of [null, [], {}, { ...manifest(), samples: [] }, { ...manifest(), isHoldout: true }]) assert.throws(() => validateCriticalFieldManifest(value))
  const source = sample(); source.fields.mrp.metricEligible = false
  assert.throws(() => validateCriticalFieldManifest(manifest(source)), /Readable/)
  const invalid = sample(); invalid.expectedValues.packDate = invalid.fields.packDate.value = '31/02/25'
  assert.throws(() => validateCriticalFieldManifest(manifest(invalid)), /valid complete/)
  const unsafe = sample(); unsafe.sourcePath = '../outside.jpg'
  assert.throws(() => validateCriticalFieldManifest(manifest(unsafe)), /relative/)
})

test('oversized, duplicate, wrong-photo and manually repaired OCR rows are rejected', () => {
  assert.throws(() => scoreCriticalFields(manifest(), [row(), row()]), /Duplicate/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('', { sampleId: 'UNKNOWN' })]), /unknown/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('x'.repeat(100001))]), /100000/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('', { manuallyEdited: true })]), /unedited/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('', { transcriptKind: 'manual-transcript' })]), /unedited/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('', { sourcePath: 'datasets/TWO.jpg' })]), /path/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('', { sourceSha256: 'b'.repeat(64) })]), /hash/)
})

test('accessors, circular, sparse and non-finite metadata are rejected before extraction', () => {
  const cyclic = row(); cyclic.self = cyclic
  assert.throws(() => scoreCriticalFields(manifest(), [cyclic]), /circular/)
  const accessor = row(); Object.defineProperty(accessor, 'bad', { enumerable: true, get() { throw new Error('getter executed') } })
  assert.throws(() => scoreCriticalFields(manifest(), [accessor]), /unsafe/)
  assert.throws(() => scoreCriticalFields(manifest(), [row('', { metric: Infinity })]), /finite JSON/)
  assert.throws(() => scoreCriticalFields(manifest(), Array(1)), /sparse/)
})

test('experiment adapter keeps exact photo identity, raw text, ROI caveat and hash binding', () => {
  const source = sample(); source.sourcePath = 'datasets/openfoodfacts-india/real-labels/123/6.jpg'
  const fresh = { type: 'result', sampleId: 'ONE', image: '123/6.jpg', sourcePath: source.sourcePath, imageSha256: source.sha256, variant: 'roi-gray', psm: '6', crop: { left: 1, top: 2, width: 3, height: 4 }, rawText: 'MRP Rs. 220', visibleChecks: { mrp: true } }
  const result = adaptCriticalOcrInput([{ type: 'session' }, fresh, { ...fresh, sampleId: 'OTHER', image: '123/7.jpg', sourcePath: 'datasets/openfoodfacts-india/real-labels/123/7.jpg' }], manifest(source), { modePrefix: 'fresh' })
  assert.equal(result.rows.length, 1)
  assert.equal(result.unmatched.length, 1)
  assert.equal(result.sessionRows, 1)
  assert.equal(result.rows[0].rawText, fresh.rawText)
  assert.equal(result.rows[0].metadata.manuallySelectedRoi, true)
  assert.equal(result.rows[0].mode, 'fresh:roi-gray:psm6')
  assert.throws(() => adaptCriticalOcrInput([{ ...fresh, imageSha256: 'b'.repeat(64) }], manifest(source)), /hash/)
})

test('canonical adapter rejects a missing mode instead of inventing one', () => {
  const noMode = row(); delete noMode.mode
  assert.throws(() => adaptCriticalOcrInput([noMode], manifest()), /row.mode/)
})

test('frozen real manifest has eight photographs and exactly 3/5/2 readable references', async () => {
  const frozen = JSON.parse(await readFile(new URL('../datasets/critical-fields.v1.json', import.meta.url), 'utf8'))
  validateCriticalFieldManifest(frozen)
  assert.equal(frozen.samples.length, 8)
  assert.deepEqual(frozen.scoringPolicy.expectedReadableDenominators, { mrp: 3, netQuantity: 5, packDate: 2 })
  const empty = scoreCriticalFields(frozen, [])
  assert.deepEqual(empty.runs, [])
})

test('source verifier checks actual image bytes and detects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'niyamlens-critical-hash-'))
  try {
    const bytes = Buffer.from('test image bytes, not a real OCR sample')
    await writeFile(join(dir, 'one.jpg'), bytes)
    const source = sample(); source.sourcePath = 'one.jpg'; source.sha256 = createHash('sha256').update(bytes).digest('hex')
    const result = await verifyCriticalSourceImages(manifest(source), dir)
    assert.equal(result.count, 1)
    await writeFile(join(dir, 'one.jpg'), 'changed')
    await assert.rejects(verifyCriticalSourceImages(manifest(source), dir), /SHA256 mismatch/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CLI scores fixture raw rows, refuses overwrites and reports malformed JSON cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'niyamlens-critical-cli-'))
  try {
    const manifestPath = join(dir, 'labels.json'); const inputPath = join(dir, 'raw.json'); const output = join(dir, 'report.json')
    await writeFile(manifestPath, JSON.stringify(manifest()))
    await writeFile(inputPath, JSON.stringify([row()]))
    const script = resolve('tools/score-critical-fields.mjs')
    const args = [script, '--manifest', manifestPath, '--input', inputPath, '--output', output]
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.equal(first.status, 0, first.error?.message || first.stderr || 'CLI subprocess did not complete')
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.runs[0].exactMatchCorrect, 3)
    assert.equal(report.sourceVerification.verified, false)
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.equal(second.status, 1)
    assert.match(second.stderr, /EEXIST/)
    await writeFile(inputPath, '{bad json')
    const malformed = spawnSync(process.execPath, [script, '--manifest', manifestPath, '--input', inputPath], { encoding: 'utf8' })
    assert.equal(malformed.status, 1)
    assert.match(malformed.stderr, /Invalid JSON/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
