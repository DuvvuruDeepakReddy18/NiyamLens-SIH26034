import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AI_REFERENCE_PHOTO_COUNT, AI_REFERENCE_SCHEMA, validateAiReferenceDocument, validateAiReferenceFiles, verifyAiReferenceSourceBytes } from '../tools/validate-ai-reference.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const clone = value => structuredClone(value)

function field(status, value, evidence) { return { status, value, evidence } }

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-ai-reference-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const photos = join(root, 'photos')
  await mkdir(photos)
  const samples = []
  for (let index = 1; index <= AI_REFERENCE_PHOTO_COUNT; index++) {
    const id = `PUBLIC-${String(index).padStart(3, '0')}`
    const bytes = Buffer.from(`synthetic-source-bytes-${index}`)
    const sourcePath = `photos/${id}.jpg`
    await writeFile(join(root, sourcePath), bytes)
    samples.push({
      id,
      productKey: `product-${String(index).padStart(3, '0')}`,
      sourcePath,
      sha256: hash(bytes),
      byteLength: bytes.length,
      acquiredAt: '2026-09-05T01:00:00Z',
      capturedAt: null,
      captureRights: 'licensed-for-evaluation',
      rightsNote: 'Synthetic test bytes licensed for this unit test.',
      mime: 'image/jpeg',
    })
  }
  const selection = {
    schemaVersion: 1,
    kind: 'niyamlens-field-review-selection-v1',
    datasetId: 'niyamlens-ai-reference-test',
    generatedAt: '2026-09-05T01:05:00Z',
    isHoldout: false,
    groundTruthProvided: false,
    sourceSelectionSha256: hash(Buffer.from(JSON.stringify(samples.map(sample => [sample.id, sample.productKey, sample.sourcePath, sample.sha256])))),
    sourceArtifacts: { intakeSha256: 'a'.repeat(64), exploratoryOcrArtifactSha256: 'b'.repeat(64) },
    samples,
    excluded: [],
    limitations: ['Synthetic fixture only.'],
  }
  const selectionBytes = Buffer.from(`${JSON.stringify(selection, null, 2)}\n`)
  const selectionSha256 = hash(selectionBytes)
  const reference = {
    schema: AI_REFERENCE_SCHEMA,
    datasetId: selection.datasetId,
    selectionSha256,
    authorType: 'ai',
    reviewType: 'single-ai-visual-review',
    independentHumanReview: false,
    approvedForHumanBlindPilot: false,
    exposureRecordedAt: '2026-09-05T02:00:00Z',
    rows: samples.map(sample => ({
      itemId: sample.id,
      sha256: sample.sha256,
      fields: {
        mrp: field('readable', 'MRP Rs 10.00', 'The photograph visibly shows the literal line “MRP Rs 10.00”.'),
        netQuantity: field('not-visible', null, 'No net-quantity declaration is visible in this single photograph.'),
        date: field('illegible', null, 'A date-like print area is present, but its characters cannot be read reliably.'),
      },
      notes: '',
    })),
  }
  const selectionPath = join(root, 'selection-manifest.json')
  const labelsPath = join(root, 'labels.json')
  await writeFile(selectionPath, selectionBytes)
  await writeFile(labelsPath, `${JSON.stringify(reference, null, 2)}\n`)
  return { root, selection, selectionBytes, selectionSha256, selectionPath, labelsPath, reference }
}

test('validates the exact 24-row AI-only reference and hashes every canonical source file', async t => {
  const value = await fixture(t)
  const direct = validateAiReferenceDocument(value.reference, value.selection, value.selectionSha256)
  assert.deepEqual(direct, {
    schema: AI_REFERENCE_SCHEMA,
    datasetId: value.selection.datasetId,
    selectionSha256: value.selectionSha256,
    photoCount: 24,
    authorType: 'ai',
    reviewType: 'single-ai-visual-review',
    independentHumanReview: false,
    approvedForHumanBlindPilot: false,
    exposureRecordedAt: '2026-09-05T02:00:00Z',
  })
  assert.deepEqual(await verifyAiReferenceSourceBytes(value.selection, value.root), { sourceBytesVerified: true, verifiedPhotoCount: 24 })
  const files = await validateAiReferenceFiles({ labelsPath: value.labelsPath, selectionPath: value.selectionPath, photoRoot: value.root })
  assert.equal(files.valid, true)
  assert.equal(files.sourceBytesVerified, true)
  assert.equal(files.approvedForHumanBlindPilot, false)
  assert.match(files.claimBoundary, /not independent human ground truth/i)
})

test('rejects human attribution or attestation and does not accept human-review schema fields', async t => {
  const value = await fixture(t)
  for (const mutate of [
    input => { input.independentHumanReview = true },
    input => { input.approvedForHumanBlindPilot = true },
    input => { input.authorType = 'human' },
    input => { input.reviewerId = 'Arif' },
    input => { input.rows[0].notes = 'Attributed to Tharun' },
  ]) {
    const input = clone(value.reference); mutate(input)
    assert.throws(() => validateAiReferenceDocument(input, value.selection, value.selectionSha256), /AI_REFERENCE_(?:HUMAN|PROVENANCE|FORMAT)/)
  }
})

test('enforces readable and non-readable field evidence without inventing null values', async t => {
  const value = await fixture(t)
  const mutations = [
    input => { input.rows[0].fields.mrp.value = '' },
    input => { input.rows[0].fields.mrp.evidence = '   ' },
    input => { input.rows[0].fields.netQuantity.value = '500 g' },
    input => { input.rows[0].fields.date.evidence = '' },
    input => { input.rows[0].fields.date.status = 'not_visible' },
    input => { delete input.rows[0].fields.date },
    input => { input.rows[0].fields.packDate = input.rows[0].fields.date },
  ]
  for (const mutate of mutations) {
    const input = clone(value.reference); mutate(input)
    assert.throws(() => validateAiReferenceDocument(input, value.selection, value.selectionSha256), /AI_REFERENCE_(?:FIELD|TEXT)/)
  }
})

test('rejects missing, duplicate, unexpected or hash-mismatched rows and selection drift', async t => {
  const value = await fixture(t)
  const cases = [
    input => { input.rows.pop() },
    input => { input.rows[23] = clone(input.rows[0]) },
    input => { input.rows[0].itemId = 'UNEXPECTED-001' },
    input => { input.rows[0].sha256 = 'c'.repeat(64) },
    input => { input.selectionSha256 = 'd'.repeat(64) },
    input => { input.datasetId = 'different-dataset' },
  ]
  for (const mutate of cases) {
    const input = clone(value.reference); mutate(input)
    assert.throws(() => validateAiReferenceDocument(input, value.selection, value.selectionSha256), /AI_REFERENCE_(?:ROW|SELECTION)/)
  }
  const shortSelection = clone(value.selection); shortSelection.samples.pop()
  shortSelection.sourceSelectionSha256 = hash(Buffer.from(JSON.stringify(shortSelection.samples.map(sample => [sample.id, sample.productKey, sample.sourcePath, sample.sha256]))))
  assert.throws(() => validateAiReferenceDocument(value.reference, shortSelection, value.selectionSha256), /AI_REFERENCE_SELECTION_INVALID/)
})

test('fails closed when a selected source file changes after the manifest was created', async t => {
  const value = await fixture(t)
  await writeFile(join(value.root, value.selection.samples[0].sourcePath), 'changed-source-bytes')
  await assert.rejects(verifyAiReferenceSourceBytes(value.selection, value.root), /AI_REFERENCE_SOURCE_HASH_MISMATCH/)
  await assert.rejects(validateAiReferenceFiles({ labelsPath: value.labelsPath, selectionPath: value.selectionPath, photoRoot: value.root }), /AI_REFERENCE_SOURCE_HASH_MISMATCH/)
})

test('binds labels to the exact selection file bytes, not a reformatted equivalent', async t => {
  const value = await fixture(t)
  const reformatted = Buffer.from(JSON.stringify(value.selection))
  assert.notEqual(hash(reformatted), value.selectionSha256)
  await writeFile(value.selectionPath, reformatted)
  await assert.rejects(validateAiReferenceFiles({ labelsPath: value.labelsPath, selectionPath: value.selectionPath, photoRoot: value.root }), /AI_REFERENCE_SELECTION_MISMATCH/)
  assert.deepEqual(JSON.parse(await readFile(value.labelsPath, 'utf8')), value.reference)
})

test('optional freeze detects changed AI answers even when source hashes and schema still validate', async t => {
  const value = await fixture(t)
  const freezePath = join(value.root, 'freeze.json')
  const freeze = { kind: 'frozen-single-AI-visual-reference-NOT-HUMAN-GROUND-TRUTH', labelsSha256: hash(await readFile(value.labelsPath)), validation: { selectionSha256: value.selectionSha256 } }
  await writeFile(freezePath, JSON.stringify(freeze))
  const options = { labelsPath: value.labelsPath, selectionPath: value.selectionPath, photoRoot: value.root, freezePath }
  assert.equal((await validateAiReferenceFiles(options)).frozenDigestVerified, true)
  value.reference.rows[0].fields.mrp.value = '999.00'
  await writeFile(value.labelsPath, JSON.stringify(value.reference))
  await assert.rejects(validateAiReferenceFiles(options), /AI_REFERENCE_FREEZE_MISMATCH/)
  assert.equal((await validateAiReferenceFiles({ ...options, freezePath: undefined })).frozenDigestVerified, false)
})

test('freeze cannot substitute a different selection or claim human certification', async t => {
  const value = await fixture(t)
  const freezePath = join(value.root, 'freeze.json')
  for (const [kind, digest] of [['human-certified', value.selectionSha256], ['frozen-single-AI-visual-reference-NOT-HUMAN-GROUND-TRUTH', 'e'.repeat(64)]]) {
    await writeFile(freezePath, JSON.stringify({ kind, labelsSha256: hash(await readFile(value.labelsPath)), validation: { selectionSha256: digest } }))
    await assert.rejects(validateAiReferenceFiles({ labelsPath: value.labelsPath, selectionPath: value.selectionPath, photoRoot: value.root, freezePath }), /AI_REFERENCE_FREEZE_MISMATCH/)
  }
})
