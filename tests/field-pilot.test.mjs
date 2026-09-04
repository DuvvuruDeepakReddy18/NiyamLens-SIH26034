import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, unlink, rmdir, symlink, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import { canonicalPilotJson, safePilotPath, validatePilotManifest, pilotSealPayload, checkPilotExclusions, resolvedPilotLabels, validatePilotRuns, scoreFieldPilot } from '../src/lib/fieldPilot.mjs'
import { createPilotDraft, pilotHash, importPilotPhotos, readPilotPhoto, readPilotExclusions, freezePilot, verifyPilotFiles, recordPilotObservation } from '../tools/field-pilot.mjs'

const clone = value => structuredClone(value)
const fields = () => ({ mrp: { status: 'readable', metricEligible: true, value: '22.00' }, netQuantity: { status: 'readable', metricEligible: true, value: '500 ml' }, packDate: { status: 'readable', metricEligible: true, value: '19/10/25' } })
const mode = id => ({ id, engine: 'test-engine-not-a-field-result', version: 'test-only-1', configuration: 'unchanged whole-photo fixture', manualRoi: false })
const truth = () => ({ reviews: ['reviewer-a', 'reviewer-b'].map(reviewerId => ({ reviewerId, reviewedAt: '2026-09-04T11:00:00Z', ocrOutputsConsulted: false, independentPhotoReview: true, fields: fields() })), adjudication: null })
const photo = i => ({ id: `FIELD-${String(i).padStart(3, '0')}`, productKey: `test-only-sku-${i}`, sourcePath: `photo-${i}.png`, sha256: pilotHash(`synthetic-test-only-image-${i}`), capturedAt: '2026-09-04T09:00:00Z', collectorId: 'collector', captureRights: 'team-owned-with-consent', rightsNote: 'Synthetic test fixture, never a real field photograph.', previouslyUsedForDevelopment: false, shape: 'flat', conditions: ['test-only'], scripts: ['English'], groundTruth: truth() })
const inventory = () => ({ files: [{ path: 'development.json', sha256: pilotHash('dev') }], hashes: [], products: [], sha256: pilotHash('test-only-exclusion-inventory') })
function draft(count = 20) {
  const value = createPilotDraft('test-pilot-v1', 'lead'); value.samples = Array.from({ length: count }, (_, i) => photo(i + 1)); value.modes = [mode('whole'), mode('second')]
  return value
}
function frozen(count = 20) {
  const value = { ...draft(count), state: 'frozen', exclusionInventory: { files: inventory().files, sha256: inventory().sha256 }, freeze: { at: '2026-09-04T12:00:00Z', by: 'lead', payloadSha256: '0'.repeat(64) } }
  value.freeze.payloadSha256 = pilotHash(pilotSealPayload(value)); return value
}
function row(source = photo(1), extra = {}) {
  const rawText = extra.rawText ?? 'MRP Rs. 22.00\nNET QTY 500 ml\nPKD 19/10/25'
  return { sampleId: source.id, sourcePath: source.sourcePath, sourceSha256: source.sha256, mode: 'whole', rawText, rawTextSha256: pilotHash(rawText), transcriptKind: 'raw-ocr-unedited', manuallyEdited: false, startedAt: '2026-09-04T13:00:00Z', finishedAt: '2026-09-04T13:00:02Z', ...extra }
}
const input = (manifest, rows = []) => ({ schemaVersion: 1, kind: 'field-pilot-ocr-runs', datasetId: manifest.datasetId, freezeSha256: manifest.freeze.payloadSha256, rows })
const reseal = manifest => { manifest.freeze.payloadSha256 = pilotHash(pilotSealPayload(manifest)); return manifest }

test('pilot template is intentionally empty, non-holdout and not scoreable', () => {
  const value = createPilotDraft('team-v1', 'lead')
  assert.equal(value.samples.length, 0); assert.equal(value.isHoldout, false)
  assert.throws(() => validatePilotRuns({}, value, pilotHash), /Freeze/)
  assert.throws(() => validatePilotManifest({ ...value, isHoldout: true }), /holdout/)
})

test('freeze contract requires 20–30 unique SKUs and pre-registered modes', () => {
  assert.doesNotThrow(() => validatePilotManifest(frozen()))
  assert.throws(() => validatePilotManifest(frozen(19)), /20–30/)
  assert.throws(() => validatePilotManifest(frozen(31)), /30/)
  const noMode = frozen(); noMode.modes = []; assert.throws(() => validatePilotManifest(noMode), /at least one/)
  for (const property of ['id', 'sha256', 'sourcePath', 'productKey']) {
    const duplicate = draft(); duplicate.samples[1][property] = duplicate.samples[0][property]
    assert.throws(() => validatePilotManifest(duplicate), /Duplicate/)
  }
})

test('draft permits missing ground truth but freeze refuses invented or missing reviewers', () => {
  const value = draft(); value.samples[0].groundTruth = null; assert.doesNotThrow(() => validatePilotManifest(value))
  const seal = frozen(); seal.samples[0].groundTruth = null; assert.throws(() => validatePilotManifest(seal), /two independent/)
  const same = photo(1); same.groundTruth.reviews[1].reviewerId = 'reviewer-a'; assert.throws(() => resolvedPilotLabels(same), /different people/)
  const exposed = photo(1); exposed.groundTruth.reviews[0].ocrOutputsConsulted = true; assert.throws(() => resolvedPilotLabels(exposed), /without consulting OCR/)
})

test('label disagreements retain both initial readings and require a third adjudicator', () => {
  const sample = photo(1); sample.groundTruth.reviews[1].fields.mrp.value = '23.00'
  assert.throws(() => resolvedPilotLabels(sample), /third human/)
  sample.groundTruth.adjudication = { reviewerId: 'reviewer-c', reviewedAt: '2026-09-04T11:30:00Z', ocrOutputsConsulted: false, independentPhotoReview: true, reason: 'Fixture adjudication from photo; no OCR consulted.', fields: fields() }
  assert.equal(resolvedPilotLabels(sample).mrp.value, '22.00'); assert.equal(sample.groundTruth.reviews[1].fields.mrp.value, '23.00')
  sample.groundTruth.adjudication.reviewerId = 'reviewer-a'; assert.throws(() => resolvedPilotLabels(sample), /third reviewer/)
})

test('label semantics and UTC chronology reject invalid dates, pre-capture review and post-freeze review', () => {
  const sample = photo(1); sample.groundTruth.reviews[0].fields.packDate.value = '31/02/25'
  assert.throws(() => resolvedPilotLabels(sample), /valid complete/)
  const early = photo(1); early.groundTruth.reviews[0].reviewedAt = '2026-09-03T11:00:00Z'; assert.throws(() => resolvedPilotLabels(early), /precede photo capture/)
  const late = frozen(); late.samples[0].groundTruth.reviews[0].reviewedAt = '2026-09-04T14:00:00Z'; assert.throws(() => validatePilotManifest(late), /before the freeze/)
  const invalid = draft(); invalid.samples[0].capturedAt = '2026-02-30T00:00:00Z'; assert.throws(() => validatePilotManifest(invalid), /real UTC/)
})

test('licensed photos keep unknown capture date separate from actual acquisition time', () => {
  const value = draft(); const source = value.samples[0]
  source.captureRights = 'licensed-for-evaluation'; source.capturedAt = null; source.acquiredAt = '2026-09-04T10:00:00Z'
  assert.doesNotThrow(() => validatePilotManifest(value))
  source.acquiredAt = '2026-09-04T11:30:00Z'; assert.throws(() => validatePilotManifest(value), /precede photo capture\/acquisition/)
  delete source.acquiredAt; assert.throws(() => validatePilotManifest(value), /acquiredAt/)
})

test('known development SKU and exact renamed image hash are excluded independently', () => {
  const value = draft()
  assert.throws(() => checkPilotExclusions(value, { hashes: [], products: [value.samples[0].productKey] }), /development SKU/)
  assert.throws(() => checkPilotExclusions(value, { hashes: [value.samples[1].sha256], products: [] }), /development image hash/)
  value.samples[0].previouslyUsedForDevelopment = true; assert.throws(() => validatePilotManifest(value), /Previously used/)
})

test('redacted field-smoke markers become automatic exclusions and canonical JSON ignores CRLF', async () => {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-field-markers-test-'))
  const directories = [join(root, 'datasets'), join(root, 'datasets', 'openfoodfacts-india')]
  const files = [join(directories[0], 'critical-fields.v1.json'), join(directories[0], 'critical-fields.checkset.v1.json'), join(directories[1], 'real-labels.manifest.json'), join(directories[0], 'field-smoke-2026-09-04.json')]
  try {
    for (const directory of directories) await mkdir(directory)
    for (const path of files.slice(0, 3)) await writeFile(path, '{"samples":[]}\n')
    const marker = { schemaVersion: 1, samples: [{ productKey: photo(1).productKey, sha256: photo(2).sha256 }] }
    await writeFile(files[3], JSON.stringify(marker, null, 2))
    const first = await readPilotExclusions(root)
    assert.equal(first.files.length, 4); assert.ok(first.products.includes(photo(1).productKey)); assert.ok(first.hashes.includes(photo(2).sha256))
    assert.throws(() => checkPilotExclusions(draft(), first), /development SKU/)
    const renamed = draft(); renamed.samples[0].productKey = 'different-unrecorded-sku'; renamed.samples[0].sha256 = photo(2).sha256
    assert.throws(() => checkPilotExclusions(renamed, first), /development image hash/)
    await writeFile(files[3], JSON.stringify(marker, null, 4).replace(/\n/g, '\r\n'))
    assert.equal((await readPilotExclusions(root)).sha256, first.sha256)
  } finally {
    for (const path of files) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })
    for (const directory of [...directories].reverse()) await rmdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rmdir(root)
  }
})

test('freeze and raw OCR digests catch tampering before any score is calculated', () => {
  const manifest = frozen(); const rows = input(manifest, [row()])
  const reformatted = JSON.parse(JSON.stringify(manifest, null, 2).replace(/\n/g, '\r\n'))
  assert.doesNotThrow(() => validatePilotRuns(rows, reformatted, pilotHash))
  manifest.samplingPlan += ' edited after freeze'; assert.throws(() => validatePilotRuns(rows, manifest, pilotHash), /Frozen manifest SHA256 mismatch/)
  const clean = frozen(); const tampered = input(clean, [row()]); tampered.rows[0].rawText = 'MRP Rs. 23.00'
  assert.throws(() => validatePilotRuns(tampered, clean, pilotHash), /Raw OCR text SHA256 mismatch/)
  const wrongDataset = input(clean); wrongDataset.freezeSha256 = 'f'.repeat(64); assert.throws(() => validatePilotRuns(wrongDataset, clean, pilotHash), /exact dataset/)
})

test('unedited provenance, exact source and registered mode are mandatory', () => {
  const manifest = frozen()
  for (const update of [{ manuallyEdited: true }, { manuallyEdited: undefined }, { transcriptKind: undefined }, { sourceSha256: undefined }, { mode: 'tuned-after-results' }]) assert.throws(() => validatePilotRuns(input(manifest, [row(photo(1), update)]), manifest, pilotHash))
  assert.throws(() => validatePilotRuns(input(manifest, [row(), row()]), manifest, pilotHash), /Duplicate/)
  assert.throws(() => validatePilotRuns(input(manifest, [row(photo(1), { startedAt: '2026-09-04T11:00:00Z' })]), manifest, pilotHash), /after freeze/)
  assert.throws(() => validatePilotRuns(input(manifest, [row(photo(1), { error: 'failed' })]), manifest, pilotHash), /empty rawText/)
})

test('raw full-corpus scoring reuses critical extractor and leaves missing mode explicit', () => {
  const manifest = frozen(); const rows = manifest.samples.map(source => row(source))
  const report = scoreFieldPilot(manifest, input(manifest, rows), pilotHash)
  assert.equal(report.runs[0].rawOcr.exactMatchCorrect, 60); assert.equal(report.runs[0].rawOcr.exactMatchRate, 1)
  assert.equal(report.runs[0].rawOcr.perField.mrp.exactMatchSamples, 20)
  assert.equal(report.runs[1].rawOcr.attemptedPhotos, 0); assert.equal(report.runs[1].rawOcr.exactMatchSamples, 60); assert.equal(report.runs[1].rawOcr.exactMatchRate, null)
  assert.equal(report.isHoldout, false); assert.equal(report.runs[0].reviewBurden.missingReviewObservations, 20)
})

test('partial attempts, failure rows and excluded unreadable labels preserve denominators', () => {
  const manifest = frozen(); const report = scoreFieldPilot(manifest, input(manifest, [row(photo(1), { rawText: '', rawTextSha256: pilotHash(''), error: 'OCR failed' })]), pilotHash)
  assert.equal(report.runs[0].rawOcr.exactMatchRate, null); assert.equal(report.runs[0].rawOcr.exactMatchSamples, 60)
  assert.equal(report.runs[0].rawOcr.failedPhotos, 1); assert.equal(report.runs[0].rawOcr.attemptedExactMatchRate, 0)
  for (const sample of manifest.samples) for (const review of sample.groundTruth.reviews) review.fields.mrp = { status: 'not_visible', value: null, metricEligible: false }
  reseal(manifest)
  const excluded = scoreFieldPilot(manifest, input(manifest, manifest.samples.map(source => row(source))), pilotHash)
  assert.equal(excluded.runs[0].rawOcr.perField.mrp.excludedFields, 20); assert.equal(excluded.runs[0].rawOcr.perField.mrp.exactMatchRate, null)
  assert.equal(excluded.runs[0].rawOcr.exactMatchSamples, 40)
})

test('officer correction never repairs raw accuracy and burden derives from both transcripts', () => {
  const manifest = frozen(); const incorrect = 'MRP Rs. 220.00\nNET QTY 500 ml\nPKD 19/10/25'
  const review = { officerId: 'officer', reviewedAt: '2026-09-04T13:02:00Z', reviewSeconds: 42, requiredReview: true, photoCompared: true, reason: 'Test fixture: compare price on image.', workingText: 'MRP Rs. 22.00\nNET QTY 500 ml\nPKD 19/10/25' }
  const rows = manifest.samples.map(source => row(source, { rawText: incorrect, rawTextSha256: pilotHash(incorrect), review }))
  const original = clone(rows); const report = scoreFieldPilot(manifest, input(manifest, rows), pilotHash).runs[0]
  assert.deepEqual(rows, original)
  assert.equal(report.rawOcr.exactMatchCorrect, 40); assert.equal(report.officerWorkingTranscript.exactMatchCorrect, 60)
  assert.deepEqual(report.reviewBurden.changedCriticalFields, { mrp: 20, netQuantity: 0, packDate: 0 })
  assert.equal(report.reviewBurden.changedTranscriptPhotos, 20); assert.equal(report.reviewBurden.medianReviewSeconds, 42)
  assert.equal(report.reviewBurden.observedRequiredReviewRate, 1)
})

test('review must be honest separate bounded observations, never assumed for missing reviews', () => {
  const manifest = frozen(); const baseReview = { officerId: 'officer', reviewedAt: '2026-09-04T13:02:00Z', reviewSeconds: 0, requiredReview: false, photoCompared: true, reason: 'No text edits needed.', workingText: row().rawText }
  for (const update of [{ reviewSeconds: -1 }, { reviewSeconds: Infinity }, { photoCompared: false }, { requiredReview: 'no' }, { reviewedAt: '2026-09-04T12:00:00Z' }]) assert.throws(() => validatePilotRuns(input(manifest, [row(photo(1), { review: { ...baseReview, ...update } })]), manifest, pilotHash))
  const report = scoreFieldPilot(manifest, input(manifest, [row(photo(1), { review: baseReview }), row(photo(2))]), pilotHash).runs[0]
  assert.equal(report.reviewBurden.reviewedPhotos, 1); assert.equal(report.reviewBurden.missingReviewObservations, 1)
  assert.equal(report.officerWorkingTranscript.exactMatchRate, null)
})

test('canonical JSON and safe photo paths reject prototype/accessor/circular/path tricks', () => {
  assert.equal(canonicalPilotJson({ b: 2, a: 1 }), canonicalPilotJson({ a: 1, b: 2 }))
  for (const path of ['../photo.jpg', '/outside.jpg', 'C:\\photo.jpg', 'https://x/x.jpg', 'x//y.jpg', 'x/./y.jpg', 'x:y.jpg']) assert.throws(() => safePilotPath(path))
  const circular = draft(); circular.loop = circular; assert.throws(() => validatePilotManifest(circular), /circular/)
  const accessor = draft(); Object.defineProperty(accessor, 'secret', { enumerable: true, get() { throw new Error('must not execute') } }); assert.throws(() => validatePilotManifest(accessor), /unsafe/)
  assert.throws(() => canonicalPilotJson(JSON.parse('{"__proto__":{}}')), /unsafe/)
})

test('record helper binds unedited observation to freeze and never overwrites a sample/mode', () => {
  const manifest = frozen(); const observation = row(); delete observation.rawTextSha256; delete observation.sourcePath
  const result = recordPilotObservation(manifest, observation)
  assert.equal(result.rows[0].rawTextSha256, pilotHash(observation.rawText)); assert.equal(result.rows[0].sourcePath, photo(1).sourcePath)
  assert.throws(() => recordPilotObservation(manifest, observation, result), /Duplicate/)
  assert.equal(result.rows.length, 1)
})

test('external photo-root import, 20-photo freeze and tamper check use the unchanged repo inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-field-pilot-test-')); const paths = []
  try {
    const actualInventory = await readPilotExclusions(resolve('.'))
    const sourceOptions = { root: resolve('.'), photoRoot: root, inventory: actualInventory }
    const intake = []
    for (let i = 1; i <= 20; i += 1) {
      const source = photo(i); const path = join(root, source.sourcePath); paths.push(path)
      await writeFile(path, await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: i * 7, g: 35, b: 89 } } }).png().toBuffer())
      delete source.sha256; delete source.groundTruth; intake.push(source)
    }
    const empty = createPilotDraft('local-roundtrip', 'lead'); empty.modes = [mode('whole')]
    const imported = await importPilotPhotos(empty, intake, sourceOptions)
    assert.equal(imported.samples.length, 20); assert.equal(imported.samples[0].groundTruth, null); assert.equal(imported.samples[0].width, 300)
    await assert.rejects(freezePilot(imported, { ...sourceOptions, by: 'lead', at: '2026-09-04T12:00:00Z' }), /two independent/)
    imported.samples.forEach(sample => { sample.groundTruth = truth() })
    const sealed = await freezePilot(imported, { ...sourceOptions, by: 'lead', at: '2026-09-04T12:00:00Z' })
    assert.equal(sealed.exclusionInventory.sha256, actualInventory.sha256)
    assert.equal((await verifyPilotFiles(sealed, sourceOptions)).photoCount, 20)
    await assert.rejects(verifyPilotFiles(sealed, { ...sourceOptions, inventory: { ...actualInventory, sha256: pilotHash('changed inventory') } }), /inventory changed/)
    await writeFile(paths[0], await readFile(paths[1])); await assert.rejects(verifyPilotFiles(sealed, sourceOptions), /photograph hash mismatch/)
  } finally { for (const path of paths) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error }); await rmdir(root) }
})

test('image reader rejects renamed/non-image bytes and tiny inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-field-photo-test-')); const paths = [join(root, 'fake.jpg'), join(root, 'tiny.png')]
  try {
    await writeFile(paths[0], 'not a photograph')
    await writeFile(paths[1], await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer())
    await assert.rejects(readPilotPhoto(root, 'fake.jpg'))
    await assert.rejects(readPilotPhoto(root, 'tiny.png'), /300/)
  } finally { for (const path of paths) await unlink(path); await rmdir(root) }
})

test('external photo root cannot escape through a directory symlink or Windows junction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-field-root-test-'))
  const outside = await mkdtemp(join(tmpdir(), 'niyamlens-field-outside-test-'))
  const path = join(outside, 'photo.png'); const link = join(root, 'escape'); let linked = false
  try {
    await writeFile(path, await sharp({ create: { width: 300, height: 300, channels: 3, background: 'white' } }).png().toBuffer())
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); linked = true
    await assert.rejects(readPilotPhoto(root, 'escape/photo.png'), /outside the chosen photo root/)
  } finally {
    if (linked) { if (process.platform === 'win32') await rmdir(link); else await unlink(link) }
    await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error })
    await rmdir(outside); await rmdir(root)
  }
})

test('CLI init is create-only and malformed JSON errors are concise', async () => {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-field-cli-test-')); const path = join(root, 'draft.json')
  try {
    const args = [resolve('tools/field-pilot.mjs'), 'init', '--dataset-id', 'cli-test', '--owner', 'lead', '--output', path]
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(run.status, 0, run.error?.message || run.stderr)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).samples.length, 0)
    const repeat = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(repeat.status, 1); assert.match(repeat.stderr, /EEXIST/)
    await writeFile(path, '{invalid')
    const invalid = spawnSync(process.execPath, [args[0], 'validate', '--manifest', path], { encoding: 'utf8' }); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Invalid pilot JSON/)
    await writeFile(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))
    const invalidUtf8 = spawnSync(process.execPath, [args[0], 'validate', '--manifest', path], { encoding: 'utf8' }); assert.equal(invalidUtf8.status, 1); assert.match(invalidUtf8.stderr, /Invalid pilot JSON\/UTF-8/)
  } finally { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error }); await rmdir(root) }
})
