import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BROWSER_PILOT_MODES } from '../tools/run-browser-field-pilot.mjs'
import { buildAdjudicationRequest, buildLeadWorkingCopy, main, mergeFieldReviewEvidence } from '../tools/import-field-review-evidence.mjs'
import { validatePilotManifest } from '../src/lib/fieldPilot.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
const clone = value => structuredClone(value)
const fields = () => ({
  mrp: { status: 'readable', value: '22.00', metricEligible: true, verbatim: 'MRP 22.00', notes: '' },
  netQuantity: { status: 'readable', value: '500 ml', metricEligible: true, verbatim: '500 ml', notes: '' },
  packDate: { status: 'readable', value: '19/10/25', metricEligible: true, verbatim: 'PKD 19/10/25', notes: '' },
})

function evidence(count = 24) {
  const samples = Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, '0')
    return { id: `SYN-${number}`, productKey: `synthetic-sku-${number}`, sourcePath: `photos/synthetic-${number}.png`, sha256: sha(`synthetic-image-${number}`), byteLength: 1000 + index, acquiredAt: '2026-09-05T00:00:00Z', capturedAt: null, captureRights: 'licensed-for-evaluation', rightsNote: 'Synthetic test-only source; no real package photograph.' }
  })
  const sourceSelectionSha256 = sha(Buffer.from(JSON.stringify(samples.map(sample => [sample.id, sample.productKey, sample.sourcePath, sample.sha256]))))
  const selection = { schemaVersion: 1, kind: 'niyamlens-field-review-selection-v1', datasetId: 'synthetic-review-import-v1', generatedAt: '2026-09-05T00:05:00Z', isHoldout: false, groundTruthProvided: false, sourceSelectionSha256, sourceArtifacts: { intakeSha256: sha('intake'), exploratoryOcrArtifactSha256: sha('exploratory') }, samples, excluded: [], limitations: ['Synthetic test only.'] }
  const review = (slot, reviewerId, reviewedAt) => ({
    schemaVersion: 1,
    kind: 'niyamlens-independent-photo-review-v1',
    datasetId: selection.datasetId,
    sourceSelectionSha256,
    status: 'reviewer-entered-complete',
    reviewerSlot: slot,
    reviewerId,
    reviewedAt,
    timestampSource: 'reviewer-device-clock-at-export',
    ocrOutputsConsulted: false,
    independentPhotoReview: true,
    reviews: samples.map(sample => ({ sampleId: sample.id, sourceSha256: sample.sha256, reviewerId, reviewedAt, ocrOutputsConsulted: false, independentPhotoReview: true, photoReadability: 'sufficient_for_some_labels', fields: fields(), notes: '' })),
    limitations: [],
  })
  const lead = {
    schemaVersion: 1,
    kind: 'niyamlens-field-pilot-lead-metadata-worksheet-v1',
    datasetId: selection.datasetId,
    sourceSelectionSha256,
    status: 'lead-entered-complete',
    completedBy: 'synthetic-coordinator',
    completedAt: '2026-09-05T02:30:00Z',
    samples: samples.map(sample => ({ id: sample.id, productKey: sample.productKey, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, acquiredAt: sample.acquiredAt, capturedAt: null, captureTimeEvidence: null, captureRights: sample.captureRights, rightsNote: sample.rightsNote, collectorId: 'synthetic-metadata-reviewer', collectorRole: 'metadata-reviewer-not-original-photographer', previouslyUsedForDevelopment: false, priorUseBasis: 'Synthetic fixture inventory checked for this test only.', shape: 'flat-test-fixture', scripts: ['synthetic-latin'], conditions: ['synthetic-controlled'], notes: '' })),
  }
  return { selection, reviewA: review('A', 'synthetic-reviewer-a', '2026-09-05T01:00:00Z'), reviewB: review('B', 'synthetic-reviewer-b', '2026-09-05T01:30:00Z'), lead }
}

const fileHashes = () => ({ selection: sha('selection-file'), reviewA: sha('review-a-file'), reviewB: sha('review-b-file'), lead: sha('lead-file') })

function blankLead(value) {
  return { ...clone(value.lead), status: 'unfilled-not-import-or-freeze-ready', completedBy: null, completedAt: null, samples: value.lead.samples.map(row => { const { captureTimeEvidence, collectorRole, priorUseBasis, ...source } = row; return { ...source, capturedAt: null, collectorId: null, previouslyUsedForDevelopment: null, shape: null, scripts: [], conditions: [], notes: null } }) }
}

test('prepares a lead working copy without completing or inventing pending metadata', () => {
  const value = evidence(); const prepared = buildLeadWorkingCopy(blankLead(value), value.selection)
  assert.equal(prepared.status, 'unfilled-not-import-or-freeze-ready')
  assert.equal(prepared.completedBy, null)
  assert.ok(prepared.samples.every(row => row.previouslyUsedForDevelopment === null && row.collectorRole === null && row.priorUseBasis === null && row.captureTimeEvidence === null))
})

test('merges complete hash-bound independent evidence into a validated draft without freezing or claiming identity verification', () => {
  const value = evidence()
  const manifest = mergeFieldReviewEvidence({ ...value, ownerId: 'synthetic-team-lead', modes: [BROWSER_PILOT_MODES['browser-standard']], fileHashes: fileHashes(), importedAt: '2026-09-05T12:00:00Z' })
  assert.doesNotThrow(() => validatePilotManifest(manifest))
  assert.equal(manifest.state, 'draft')
  assert.equal(manifest.isHoldout, false)
  assert.equal(manifest.freeze, undefined)
  assert.equal(manifest.samples.length, 24)
  assert.equal(manifest.modes[0].id, 'browser-standard')
  assert.equal(manifest.evidenceImport.identityVerifiedBySoftware, false)
  assert.equal(manifest.evidenceImport.independenceVerifiedBySoftware, false)
  assert.equal(manifest.samples[0].groundTruth.reviews[0].sourceReviewFileSha256, fileHashes().reviewA)
  assert.equal(manifest.samples[0].groundTruth.adjudication, null)
})

test('creates a value-blind disagreement request and requires a distinct later adjudicator bound to both files', () => {
  const value = evidence()
  value.reviewB.reviews[0].fields.mrp.value = '23.00'
  value.reviewB.reviews[0].fields.mrp.verbatim = 'MRP 23.00'
  const hashes = fileHashes()
  const request = buildAdjudicationRequest({ ...value, reviewAFileSha256: hashes.reviewA, reviewBFileSha256: hashes.reviewB })
  assert.equal(request.adjudications.length, 1)
  assert.deepEqual(request.adjudications[0].disputedFields, ['mrp'])
  assert.ok(!JSON.stringify(request).includes('22.00'))
  assert.ok(!JSON.stringify(request).includes('23.00'))
  assert.throws(() => mergeFieldReviewEvidence({ ...value, ownerId: 'lead', modes: [], fileHashes: hashes, importedAt: '2026-09-05T12:00:00Z' }), /third-person adjudication/)

  request.status = 'adjudicator-entered-complete'
  request.reviewerId = 'synthetic-reviewer-c'
  request.reviewedAt = '2026-09-05T02:00:00Z'
  request.timestampSource = 'adjudicator-device-clock-at-completion'
  request.ocrOutputsConsulted = false
  request.independentPhotoReview = true
  request.adjudications[0].reason = 'Independent synthetic fixture adjudication; no OCR or A/B values consulted.'
  request.adjudications[0].fields = fields()
  const manifest = mergeFieldReviewEvidence({ ...value, adjudication: request, ownerId: 'lead', modes: [], fileHashes: { ...hashes, adjudication: sha('adjudication-file') }, importedAt: '2026-09-05T12:00:00Z' })
  assert.equal(manifest.samples[0].groundTruth.adjudication.reviewerId, 'synthetic-reviewer-c')
  assert.deepEqual(manifest.evidenceImport.disagreementSamples, [{ sampleId: 'SYN-001', disputedFields: ['mrp'] }])
})

test('fails closed on fabricated, incomplete, conflicted or unbound human inputs', () => {
  const base = evidence(); const args = value => ({ ...value, ownerId: 'lead', modes: [], fileHashes: fileHashes(), importedAt: '2026-09-05T12:00:00Z' })
  for (const mutate of [
    value => { value.reviewB.reviewerId = value.reviewA.reviewerId; value.reviewB.reviews.forEach(row => { row.reviewerId = value.reviewA.reviewerId }) },
    value => { value.reviewA.reviews[0].sourceSha256 = 'f'.repeat(64) },
    value => { value.reviewA.reviews[0].fields.mrp.status = 'pending' },
    value => { value.reviewA.ocrOutputsConsulted = true },
    value => { value.reviewB.reviewedAt = '2026-09-04T23:00:00Z'; value.reviewB.reviews.forEach(row => { row.reviewedAt = value.reviewB.reviewedAt }) },
    value => { value.lead.samples[0].previouslyUsedForDevelopment = null },
    value => { value.lead.samples[0].previouslyUsedForDevelopment = true },
    value => { value.lead.samples[0].priorUseBasis = '' },
    value => { value.lead.samples[0].collectorRole = 'original-collector' },
    value => { value.lead.samples[0].scripts = [] },
  ]) {
    const value = clone(base); mutate(value)
    assert.throws(() => mergeFieldReviewEvidence(args(value)))
  }
})

test('CLI writes create-only coordinator artifacts from JSON without photo access', async t => {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-review-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const value = evidence(); const files = {}
  for (const [name, data] of Object.entries({ selection: value.selection, 'review-a': value.reviewA, 'review-b': value.reviewB, lead: value.lead, 'lead-blank': blankLead(value) })) {
    files[name] = join(root, `${name}.json`)
    await writeFile(files[name], JSON.stringify(data))
  }
  const leadWorking = join(root, 'lead-working.json')
  await main(['lead-template', '--selection', files.selection, '--lead', files['lead-blank'], '--output', leadWorking])
  assert.equal(JSON.parse(await readFile(leadWorking, 'utf8')).samples[0].priorUseBasis, null)
  const output = join(root, 'merged.json')
  const command = ['merge', '--selection', files.selection, '--review-a', files['review-a'], '--review-b', files['review-b'], '--lead', files.lead, '--owner', 'synthetic-lead', '--mode', 'browser-standard', '--output', output]
  await main(command)
  const manifest = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(manifest.samples.length, 24)
  assert.equal(manifest.modes[0].id, 'browser-standard')
  await assert.rejects(main(command), error => error?.code === 'EEXIST')
})
