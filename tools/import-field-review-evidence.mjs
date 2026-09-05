#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CRITICAL_FIELDS, validateCriticalFieldManifest } from '../src/lib/criticalFieldBenchmark.mjs'
import { assertPilotJson, safePilotPath, validatePilotManifest } from '../src/lib/fieldPilot.mjs'
import { BROWSER_PILOT_MODES, validateBrowserMode } from './run-browser-field-pilot.mjs'

const MAX_JSON_BYTES = 20_000_000
const REVIEW_STATUSES = new Set(['readable', 'not_visible', 'illegible', 'ambiguous_field'])
const PHOTO_READABILITY = new Set(['sufficient_for_some_labels', 'no_critical_field_readable', 'image_unreadable'])
const COLLECTOR_ROLES = new Set(['original-collector', 'metadata-reviewer-not-original-photographer'])
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const fail = message => { throw new Error(message) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const text = (value, name, max = 200, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${name} requires ${empty ? '' : 'nonempty '}text of at most ${max} characters.`)
  return value
}
const identifier = (value, name) => {
  text(value, name, 100)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) fail(`${name} must use letters, digits, dots, underscores or hyphens.`)
  return value
}
const digest = (value, name) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${name} requires a lowercase SHA-256 digest.`)
  return value
}
const timestamp = (value, name) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) fail(`${name} requires a real UTC ISO timestamp.`)
  return value
}

function assertSame(actual, expected, name) {
  if (actual !== expected) fail(`${name} does not match the selected source record.`)
}

function criticalAdapter(sample, fields) {
  const clean = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, {
    status: fields[field].status,
    value: fields[field].value,
    metricEligible: fields[field].metricEligible,
    notes: fields[field].notes,
  }]))
  return {
    schemaVersion: 1,
    datasetId: 'review-import-validation',
    corpusRole: 'previously-used-development-corpus',
    isHoldout: false,
    annotation: { status: 'provisional-human-review-required', humanReviewed: false },
    samples: [{
      id: sample.id,
      sourcePath: sample.sourcePath,
      sha256: sample.sha256,
      expectedStatus: null,
      fields: clean,
      expectedValues: Object.fromEntries(CRITICAL_FIELDS.filter(field => clean[field].status === 'readable').map(field => [field, clean[field].value])),
    }],
  }
}

function checkedFields(fields, sample, name) {
  if (!plain(fields) || Object.keys(fields).some(key => !CRITICAL_FIELDS.includes(key))) fail(`${name} must contain exactly the three supported critical fields.`)
  const copy = {}
  for (const field of CRITICAL_FIELDS) {
    const value = fields[field]
    if (!plain(value) || !REVIEW_STATUSES.has(value.status)) fail(`${name}.${field} requires a completed supported status.`)
    text(value.notes ?? '', `${name}.${field}.notes`, 2000, true)
    text(value.verbatim ?? '', `${name}.${field}.verbatim`, 2000, true)
    if (value.status === 'readable') {
      text(value.value, `${name}.${field}.value`, 2000)
      if (value.metricEligible !== true) fail(`${name}.${field} readable values must be metricEligible=true.`)
    } else if (value.value !== null || value.metricEligible !== false) fail(`${name}.${field} non-readable values must remain null and metricEligible=false.`)
    copy[field] = { status: value.status, value: value.value, metricEligible: value.metricEligible, verbatim: value.verbatim ?? '', notes: value.notes ?? '' }
  }
  validateCriticalFieldManifest(criticalAdapter(sample, copy))
  return copy
}

export function validateReviewSelection(selection) {
  assertPilotJson(selection)
  if (!plain(selection) || selection.schemaVersion !== 1 || selection.kind !== 'niyamlens-field-review-selection-v1') fail('Expected a NiyamLens field-review selection v1 file.')
  identifier(selection.datasetId, 'selection.datasetId')
  digest(selection.sourceSelectionSha256, 'selection.sourceSelectionSha256')
  timestamp(selection.generatedAt, 'selection.generatedAt')
  if (selection.isHoldout !== false || selection.groundTruthProvided !== false) fail('Selection must preserve its no-holdout and no-ground-truth claims.')
  if (!Array.isArray(selection.samples) || selection.samples.length < 20 || selection.samples.length > 30) fail('Selection requires 20–30 reserved samples.')
  const ids = new Set(); const paths = new Set(); const products = new Set(); const hashes = new Set()
  for (const sample of selection.samples) {
    if (!plain(sample)) fail('Each selection sample must be an object.')
    if (['groundTruth', 'expectedValues', 'dataUrl'].some(key => Object.hasOwn(sample, key))) fail('Selection samples must not contain labels, expected values or embedded image data.')
    identifier(sample.id, 'sample.id'); text(sample.productKey, 'sample.productKey'); safePilotPath(sample.sourcePath); digest(sample.sha256, 'sample.sha256')
    if (!Number.isInteger(sample.byteLength) || sample.byteLength <= 0 || sample.byteLength > 15 * 1024 * 1024) fail('sample.byteLength must be a positive integer no larger than 15 MiB.')
    if (sample.productKey !== sample.productKey.trim().toLowerCase()) fail('sample.productKey must be trimmed lowercase.')
    timestamp(sample.acquiredAt, 'sample.acquiredAt')
    if (sample.capturedAt !== null) {
      timestamp(sample.capturedAt, 'sample.capturedAt')
      if (Date.parse(sample.acquiredAt) < Date.parse(sample.capturedAt)) fail('Selection acquisition cannot precede known camera capture.')
    }
    if (!['team-owned-with-consent', 'licensed-for-evaluation'].includes(sample.captureRights)) fail('Selection captureRights is unsupported.')
    text(sample.rightsNote, 'sample.rightsNote', 2000)
    for (const [set, value, label] of [[ids, sample.id, 'ID'], [paths, sample.sourcePath.toLowerCase(), 'path'], [products, sample.productKey, 'product'], [hashes, sample.sha256, 'hash']]) {
      if (set.has(value)) fail(`Selection contains a duplicate ${label}.`)
      set.add(value)
    }
  }
  const expected = hash(Buffer.from(JSON.stringify(selection.samples.map(sample => [sample.id, sample.productKey, sample.sourcePath, sample.sha256]))))
  if (expected !== selection.sourceSelectionSha256) fail('Selection content does not match sourceSelectionSha256.')
  return structuredClone(selection)
}

function validateReviewerExport(input, selection, expectedSlot) {
  assertPilotJson(input)
  if (!plain(input) || input.schemaVersion !== 1 || input.kind !== 'niyamlens-independent-photo-review-v1' || input.status !== 'reviewer-entered-complete') fail(`Reviewer ${expectedSlot} must submit a completed reviewer export.`)
  assertSame(input.datasetId, selection.datasetId, `Reviewer ${expectedSlot} datasetId`)
  assertSame(input.sourceSelectionSha256, selection.sourceSelectionSha256, `Reviewer ${expectedSlot} selection hash`)
  if (input.reviewerSlot !== expectedSlot) fail(`Reviewer file ${expectedSlot} must declare reviewerSlot=${expectedSlot}.`)
  identifier(input.reviewerId, `Reviewer ${expectedSlot} reviewerId`); timestamp(input.reviewedAt, `Reviewer ${expectedSlot} reviewedAt`)
  if (input.timestampSource !== 'reviewer-device-clock-at-export') fail(`Reviewer ${expectedSlot} must retain the device-clock timestamp source.`)
  if (input.ocrOutputsConsulted !== false || input.independentPhotoReview !== true) fail(`Reviewer ${expectedSlot} must self-attest independent review without OCR output.`)
  if (!Array.isArray(input.reviews) || input.reviews.length !== selection.samples.length) fail(`Reviewer ${expectedSlot} must complete every selected photo exactly once.`)
  const rows = new Map()
  const samples = new Map(selection.samples.map(sample => [sample.id, sample]))
  for (const row of input.reviews) {
    if (!plain(row)) fail(`Reviewer ${expectedSlot} rows must be objects.`)
    const sample = samples.get(row.sampleId)
    if (!sample || rows.has(row.sampleId)) fail(`Reviewer ${expectedSlot} has an unknown or duplicate sample.`)
    assertSame(row.sourceSha256, sample.sha256, `Reviewer ${expectedSlot} ${sample.id} source hash`)
    assertSame(row.reviewerId, input.reviewerId, `Reviewer ${expectedSlot} ${sample.id} reviewerId`)
    assertSame(row.reviewedAt, input.reviewedAt, `Reviewer ${expectedSlot} ${sample.id} reviewedAt`)
    if (row.ocrOutputsConsulted !== false || row.independentPhotoReview !== true) fail(`Reviewer ${expectedSlot} per-photo attestations must match the completed export.`)
    if (Date.parse(input.reviewedAt) < Date.parse(sample.capturedAt ?? sample.acquiredAt)) fail(`Reviewer ${expectedSlot} review cannot precede ${sample.id} capture/acquisition.`)
    if (!PHOTO_READABILITY.has(row.photoReadability)) fail(`Reviewer ${expectedSlot} ${sample.id} needs a completed photo-readability status.`)
    text(row.notes ?? '', `Reviewer ${expectedSlot} ${sample.id} notes`, 2000, true)
    const fields = checkedFields(row.fields, sample, `Reviewer ${expectedSlot} ${sample.id}`)
    const readable = CRITICAL_FIELDS.filter(field => fields[field].status === 'readable').length
    if (row.photoReadability === 'sufficient_for_some_labels' && readable === 0) fail(`${sample.id} claims readable labels but has no readable critical field.`)
    if (row.photoReadability !== 'sufficient_for_some_labels' && readable > 0) fail(`${sample.id} photo readability conflicts with a readable field.`)
    rows.set(sample.id, { sampleId: sample.id, sourceSha256: sample.sha256, photoReadability: row.photoReadability, fields, notes: row.notes ?? '' })
  }
  return { reviewerSlot: expectedSlot, reviewerId: input.reviewerId, reviewedAt: input.reviewedAt, timestampSource: input.timestampSource, ocrOutputsConsulted: false, independentPhotoReview: true, rows }
}

function disagreements(reviewA, reviewB, selection) {
  const output = []
  for (const sample of selection.samples) {
    const first = reviewA.rows.get(sample.id).fields
    const second = reviewB.rows.get(sample.id).fields
    const fields = CRITICAL_FIELDS.filter(field => first[field].status !== second[field].status || first[field].value !== second[field].value)
    if (fields.length) output.push({ sampleId: sample.id, sourceSha256: sample.sha256, disputedFields: fields })
  }
  return output
}

export function buildLeadWorkingCopy(inputLead, inputSelection) {
  const selection = validateReviewSelection(inputSelection)
  assertPilotJson(inputLead)
  if (!plain(inputLead) || inputLead.schemaVersion !== 1 || inputLead.kind !== 'niyamlens-field-pilot-lead-metadata-worksheet-v1' || inputLead.status !== 'unfilled-not-import-or-freeze-ready' || inputLead.completedBy !== null || inputLead.completedAt !== null) fail('Expected the original unfilled lead-metadata worksheet.')
  assertSame(inputLead.datasetId, selection.datasetId, 'Lead template datasetId'); assertSame(inputLead.sourceSelectionSha256, selection.sourceSelectionSha256, 'Lead template selection hash')
  if (!Array.isArray(inputLead.samples) || inputLead.samples.length !== selection.samples.length) fail('Lead template must cover every selected sample exactly once.')
  const selected = new Map(selection.samples.map(sample => [sample.id, sample])); const seen = new Set()
  const samples = inputLead.samples.map(row => {
    const sample = selected.get(row?.id)
    if (!sample || seen.has(row.id)) fail('Lead template contains an unknown or duplicate sample.'); seen.add(row.id)
    for (const key of ['productKey', 'sourcePath', 'acquiredAt', 'captureRights', 'rightsNote']) assertSame(row[key], sample[key], `Lead template ${sample.id}.${key}`)
    assertSame(row.sourceSha256, sample.sha256, `Lead template ${sample.id}.sourceSha256`)
    if (row.capturedAt !== null || row.collectorId !== null || row.previouslyUsedForDevelopment !== null || row.shape !== null || !Array.isArray(row.scripts) || row.scripts.length || !Array.isArray(row.conditions) || row.conditions.length) fail('Lead template already contains observations; use a fresh blank original or complete this copy manually.')
    return { ...structuredClone(row), captureTimeEvidence: null, collectorRole: null, priorUseBasis: null }
  })
  return {
    ...structuredClone(inputLead),
    samples,
    completionInstructions: ['Do not change immutable source identity, hash, acquisition or rights fields.', 'Enter completedBy/completedAt and change status to lead-entered-complete only after every row is truthfully completed.', 'For each row complete collectorId, collectorRole, prior-use value and basis, shape, scripts, conditions, and capture-time evidence. Unknown or ineligible metadata must remain unresolved and will block merge.'],
  }
}

export function buildAdjudicationRequest({ selection: inputSelection, reviewA: inputA, reviewB: inputB, reviewAFileSha256, reviewBFileSha256 }) {
  const selection = validateReviewSelection(inputSelection)
  const reviewA = validateReviewerExport(inputA, selection, 'A')
  const reviewB = validateReviewerExport(inputB, selection, 'B')
  if (reviewA.reviewerId.toLowerCase() === reviewB.reviewerId.toLowerCase()) fail('Reviewer A and Reviewer B must be different people with different reviewer codes.')
  const disputed = disagreements(reviewA, reviewB, selection)
  digest(reviewAFileSha256, 'reviewAFileSha256'); digest(reviewBFileSha256, 'reviewBFileSha256')
  return {
    schemaVersion: 1,
    kind: 'niyamlens-independent-photo-adjudication-v1',
    datasetId: selection.datasetId,
    sourceSelectionSha256: selection.sourceSelectionSha256,
    status: disputed.length ? 'blank-disagreements-only' : 'no-adjudication-required',
    reviewerId: null,
    reviewedAt: null,
    timestampSource: null,
    ocrOutputsConsulted: null,
    independentPhotoReview: null,
    comparedReviewFiles: [
      { reviewerSlot: 'A', fileSha256: reviewAFileSha256 },
      { reviewerSlot: 'B', fileSha256: reviewBFileSha256 },
    ],
    adjudications: disputed.map(item => ({ ...item, reason: null, fields: Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { status: 'pending', value: null, metricEligible: false, verbatim: '', notes: '' }])) })),
    instructions: 'A different third person reviews the exact photograph without OCR or either reviewer output. Complete all three fields for each listed photo, enter a reason, then set the top-level identity, timestamp, attestations and status=adjudicator-entered-complete. Field names reveal where A/B differed; their values are intentionally absent.',
  }
}

function validateLeadMetadata(lead, selection) {
  assertPilotJson(lead)
  if (!plain(lead) || lead.schemaVersion !== 1 || lead.kind !== 'niyamlens-field-pilot-lead-metadata-worksheet-v1' || lead.status !== 'lead-entered-complete') fail('Lead worksheet is still pending; a real coordinator must complete it and set status=lead-entered-complete.')
  assertSame(lead.datasetId, selection.datasetId, 'Lead datasetId'); assertSame(lead.sourceSelectionSha256, selection.sourceSelectionSha256, 'Lead selection hash')
  identifier(lead.completedBy, 'lead.completedBy'); timestamp(lead.completedAt, 'lead.completedAt')
  if (!Array.isArray(lead.samples) || lead.samples.length !== selection.samples.length) fail('Lead worksheet must cover every selected sample exactly once.')
  const rows = new Map(); const selected = new Map(selection.samples.map(sample => [sample.id, sample]))
  for (const row of lead.samples) {
    if (!plain(row)) fail('Lead sample metadata must be an object.')
    const sample = selected.get(row.id)
    if (!sample || rows.has(row.id)) fail('Lead worksheet contains an unknown or duplicate sample.')
    for (const key of ['productKey', 'sourcePath', 'acquiredAt', 'captureRights', 'rightsNote']) assertSame(row[key], sample[key], `Lead ${sample.id}.${key}`)
    assertSame(row.sourceSha256, sample.sha256, `Lead ${sample.id}.sourceSha256`)
    if (sample.capturedAt !== null) assertSame(row.capturedAt, sample.capturedAt, `Lead ${sample.id}.capturedAt`)
    if (row.capturedAt === null) {
      if (sample.captureRights !== 'licensed-for-evaluation') fail(`${sample.id} needs a truthful capturedAt timestamp.`)
      if (row.captureTimeEvidence !== null && row.captureTimeEvidence !== undefined && row.captureTimeEvidence !== '') fail(`${sample.id} cannot claim capture-time evidence while capturedAt is unknown.`)
    } else {
      timestamp(row.capturedAt, `${sample.id}.capturedAt`)
      text(row.captureTimeEvidence, `${sample.id}.captureTimeEvidence`, 2000)
      if (Date.parse(row.acquiredAt) < Date.parse(row.capturedAt)) fail(`${sample.id} acquisition cannot precede camera capture.`)
    }
    identifier(row.collectorId, `${sample.id}.collectorId`)
    if (!COLLECTOR_ROLES.has(row.collectorRole)) fail(`${sample.id}.collectorRole must distinguish the original collector from a metadata reviewer.`)
    if (sample.captureRights === 'licensed-for-evaluation' && row.collectorRole !== 'metadata-reviewer-not-original-photographer') fail(`${sample.id} licensed public-source metadata must not present the team reviewer as the original photographer.`)
    if (row.previouslyUsedForDevelopment !== false) fail(row.previouslyUsedForDevelopment === true ? `${sample.id} is ineligible because it was previously used for development.` : `${sample.id} prior-use status is unresolved; do not assume false.`)
    text(row.priorUseBasis, `${sample.id}.priorUseBasis`, 2000)
    text(row.shape, `${sample.id}.shape`, 100)
    for (const key of ['scripts', 'conditions']) {
      if (!Array.isArray(row[key]) || !row[key].length || row[key].length > 12 || new Set(row[key]).size !== row[key].length) fail(`${sample.id}.${key} requires one to twelve unique truthful tags.`)
      row[key].forEach(value => text(value, `${sample.id}.${key}`, 100))
    }
    text(row.notes ?? '', `${sample.id}.notes`, 2000, true)
    if (Date.parse(lead.completedAt) < Date.parse(row.capturedAt ?? row.acquiredAt)) fail('Lead metadata completion cannot precede photo capture/acquisition.')
    rows.set(sample.id, structuredClone(row))
  }
  return { completedBy: lead.completedBy, completedAt: lead.completedAt, rows }
}

function validateAdjudication(input, disputed, selection, reviewA, reviewB, reviewHashes) {
  if (!disputed.length) {
    if (input != null) fail('No A/B label disagreement exists; do not add unnecessary adjudication.')
    return new Map()
  }
  if (!plain(input) || input.schemaVersion !== 1 || input.kind !== 'niyamlens-independent-photo-adjudication-v1' || input.status !== 'adjudicator-entered-complete') fail(`A completed third-person adjudication is required for: ${disputed.map(item => item.sampleId).join(', ')}.`)
  assertPilotJson(input); assertSame(input.datasetId, selection.datasetId, 'Adjudication datasetId'); assertSame(input.sourceSelectionSha256, selection.sourceSelectionSha256, 'Adjudication selection hash')
  identifier(input.reviewerId, 'adjudicator reviewerId'); timestamp(input.reviewedAt, 'adjudication.reviewedAt')
  if ([reviewA.reviewerId, reviewB.reviewerId].some(id => id.toLowerCase() === input.reviewerId.toLowerCase())) fail('Adjudication requires a third person, not Reviewer A or B.')
  if (Date.parse(input.reviewedAt) <= Math.max(Date.parse(reviewA.reviewedAt), Date.parse(reviewB.reviewedAt))) fail('Adjudication must follow both initial reviews.')
  if (input.timestampSource !== 'adjudicator-device-clock-at-completion' || input.ocrOutputsConsulted !== false || input.independentPhotoReview !== true) fail('Adjudicator must retain its device-clock source and attest independent photo review without OCR.')
  const expectedFiles = [{ reviewerSlot: 'A', fileSha256: reviewHashes.A }, { reviewerSlot: 'B', fileSha256: reviewHashes.B }]
  if (JSON.stringify(input.comparedReviewFiles) !== JSON.stringify(expectedFiles)) fail('Adjudication is not bound to the exact Reviewer A and B files.')
  if (!Array.isArray(input.adjudications) || input.adjudications.length !== disputed.length) fail('Adjudication must cover every disagreement exactly once and no agreement rows.')
  const expected = new Map(disputed.map(item => [item.sampleId, item])); const rows = new Map(); const samples = new Map(selection.samples.map(sample => [sample.id, sample]))
  for (const row of input.adjudications) {
    const dispute = expected.get(row?.sampleId); const sample = samples.get(row?.sampleId)
    if (!dispute || rows.has(row.sampleId)) fail('Adjudication has an unknown, duplicate or non-disagreement sample.')
    assertSame(row.sourceSha256, sample.sha256, `Adjudication ${sample.id} source hash`)
    if (JSON.stringify(row.disputedFields) !== JSON.stringify(dispute.disputedFields)) fail(`${sample.id} disputed-field list was changed.`)
    text(row.reason, `${sample.id}.adjudication reason`, 2000)
    const fields = checkedFields(row.fields, sample, `Adjudication ${sample.id}`)
    rows.set(sample.id, { reviewerId: input.reviewerId, reviewedAt: input.reviewedAt, timestampSource: input.timestampSource, ocrOutputsConsulted: false, independentPhotoReview: true, reason: row.reason, disputedFields: [...row.disputedFields], fields })
  }
  return rows
}

function checkedModes(input) {
  const modes = input == null ? [] : Array.isArray(input) ? input : plain(input) && Array.isArray(input.modes) ? input.modes : fail('Modes file must be the JSON array printed by npm run field:browser -- --modes.')
  const ids = new Set()
  return modes.map(mode => {
    const validated = validateBrowserMode(mode)
    if (ids.has(validated.id)) fail('Modes file contains a duplicate mode.')
    ids.add(validated.id)
    return { ...validated }
  })
}

export function mergeFieldReviewEvidence({ selection: inputSelection, reviewA: inputA, reviewB: inputB, lead: inputLead, adjudication = null, ownerId, modes = [], fileHashes, importedAt = new Date().toISOString() }) {
  const selection = validateReviewSelection(inputSelection)
  const reviewA = validateReviewerExport(inputA, selection, 'A'); const reviewB = validateReviewerExport(inputB, selection, 'B')
  if (reviewA.reviewerId.toLowerCase() === reviewB.reviewerId.toLowerCase()) fail('Reviewer A and Reviewer B must have different reviewer codes.')
  identifier(ownerId, 'ownerId'); timestamp(importedAt, 'importedAt')
  const lead = validateLeadMetadata(inputLead, selection)
  const requiredHashes = ['selection', 'reviewA', 'reviewB', 'lead']
  if (!plain(fileHashes)) fail('Exact source file hashes are required for the evidence trail.')
  requiredHashes.forEach(key => digest(fileHashes[key], `${key} file hash`))
  if (fileHashes.adjudication != null) digest(fileHashes.adjudication, 'adjudication file hash')
  if (fileHashes.reviewA === fileHashes.reviewB) fail('Reviewer A and B must be distinct original export files.')
  const disputed = disagreements(reviewA, reviewB, selection)
  const adjudications = validateAdjudication(adjudication, disputed, selection, reviewA, reviewB, { A: fileHashes.reviewA, B: fileHashes.reviewB })
  if (disputed.length && fileHashes.adjudication == null) fail('A completed adjudication file hash is required when reviewer labels disagree.')
  if (!disputed.length && fileHashes.adjudication != null) fail('Do not attach an adjudication file when reviewer labels agree.')
  const evidenceTimes = [reviewA.reviewedAt, reviewB.reviewedAt, lead.completedAt, ...[...adjudications.values()].map(value => value.reviewedAt)]
  if (evidenceTimes.some(value => Date.parse(value) > Date.parse(importedAt))) fail('Evidence timestamps cannot be later than the coordinator import time.')
  const registeredModes = checkedModes(modes)
  const samples = selection.samples.map(selected => {
    const metadata = lead.rows.get(selected.id); const a = reviewA.rows.get(selected.id); const b = reviewB.rows.get(selected.id)
    const mapReview = (review, row, sourceFileSha256) => ({ reviewerId: review.reviewerId, reviewedAt: review.reviewedAt, timestampSource: review.timestampSource, ocrOutputsConsulted: false, independentPhotoReview: true, reviewerSlot: review.reviewerSlot, sourceReviewFileSha256: sourceFileSha256, photoReadability: row.photoReadability, photoNotes: row.notes, fields: row.fields })
    return {
      id: selected.id,
      productKey: selected.productKey,
      sourcePath: selected.sourcePath,
      sha256: selected.sha256,
      byteLength: selected.byteLength,
      ...(selected.mime ? { mime: selected.mime } : {}),
      capturedAt: metadata.capturedAt,
      acquiredAt: metadata.acquiredAt,
      collectorId: metadata.collectorId,
      collectorRole: metadata.collectorRole,
      captureTimeEvidence: metadata.captureTimeEvidence ?? null,
      captureRights: metadata.captureRights,
      rightsNote: metadata.rightsNote,
      previouslyUsedForDevelopment: metadata.previouslyUsedForDevelopment,
      priorUseBasis: metadata.priorUseBasis,
      shape: metadata.shape,
      scripts: metadata.scripts,
      conditions: metadata.conditions,
      metadataNotes: metadata.notes ?? '',
      groundTruth: {
        reviews: [mapReview(reviewA, a, fileHashes.reviewA), mapReview(reviewB, b, fileHashes.reviewB)],
        adjudication: adjudications.get(selected.id) ?? null,
      },
    }
  })
  const manifest = {
    schemaVersion: 1,
    kind: 'prospective-field-pilot',
    datasetId: selection.datasetId,
    ownerId,
    state: 'draft',
    isHoldout: false,
    freshnessClaim: 'team-attested-new-sku-not-independently-verified',
    samplingPlan: `Availability-selected public-source acquisition of ${selection.samples.length} unique products. Recorded exploratory OCR rows were excluded before human labelling by ID, product, path and hash. Remaining prior-use status is coordinator-attested with a written basis, not independently verified and not a claim of freedom from pretrained-model exposure. One photo per SKU; not a representative or statistically powered Indian-market sample.`,
    modes: registeredModes,
    samples,
    evidenceImport: {
      kind: 'self-attested-human-review-import-v1',
      importedAt,
      sourceSelectionSha256: selection.sourceSelectionSha256,
      leadCompletedBy: lead.completedBy,
      leadCompletedAt: lead.completedAt,
      disagreementSamples: disputed.map(item => ({ sampleId: item.sampleId, disputedFields: item.disputedFields })),
      sourceFileSha256: { ...fileHashes },
      identityVerifiedBySoftware: false,
      independenceVerifiedBySoftware: false,
      limitations: ['File hashes bind submitted bytes but do not prove reviewer identity, independence, observation accuracy, capture provenance or prior non-exposure.', 'This remains a draft until exact OCR modes are pre-registered, original photo bytes and the development exclusion inventory validate, and a human lead freezes it with the existing field-pilot tool.', 'No OCR, legal verdict, accuracy metric or governmental approval is created by this import.'],
    },
  }
  return validatePilotManifest(manifest)
}

async function readJson(path, name) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_JSON_BYTES) fail(`${name} must be a regular non-symlink JSON file no larger than ${MAX_JSON_BYTES} bytes.`)
  const bytes = await readFile(path)
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail(`${name} must be valid UTF-8 JSON.`) }
  assertPilotJson(value)
  return { value, bytes, sha256: hash(bytes) }
}

const usage = `Create-only coordinator tooling for the offline review kit. It reads JSON evidence only; it never opens photographs or runs OCR.

node tools/import-field-review-evidence.mjs lead-template --selection SELECTION.json --lead BLANK-LEAD.json --output NEW-LEAD-WORKING.json

node tools/import-field-review-evidence.mjs adjudication-request --selection SELECTION.json --review-a ARIF.json --review-b THARUN.json --output NEW-ADJUDICATION-REQUEST.json

node tools/import-field-review-evidence.mjs merge --selection SELECTION.json --review-a ARIF.json --review-b THARUN.json --lead COMPLETED-LEAD.json --owner TEAM-LEAD [--adjudication COMPLETED-ADJUDICATION.json] [--mode browser-standard] [--mode browser-deep] [--modes PREREGISTERED-MODES.json] --output NEW-LABELLED-DRAFT.json

Outputs are create-only. A merge refuses pending metadata, incomplete labels, reused reviewer IDs, bad chronology, hash drift, OCR consultation, missing disagreement adjudication, or a prior-use value other than an explicitly researched false. It creates a draft, never a freeze or accuracy claim.`

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage}\n`); return }
  const [command, ...rest] = args
  if (!['lead-template', 'adjudication-request', 'merge'].includes(command)) fail(`Unknown command.\n${usage}`)
  const allowed = new Set(['--selection', '--review-a', '--review-b', '--lead', '--owner', '--adjudication', '--mode', '--modes', '--output'])
  const options = { '--mode': [] }
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]; const value = rest[index + 1]
    if (!allowed.has(key) || !value || value.startsWith('--') || (key !== '--mode' && options[key] !== undefined)) fail(`Unsupported, duplicated or incomplete option ${key}.`)
    if (key === '--mode') options[key].push(value)
    else options[key] = value
  }
  const commandOptions = {
    'lead-template': new Set(['--selection', '--lead', '--output']),
    'adjudication-request': new Set(['--selection', '--review-a', '--review-b', '--output']),
    merge: new Set(['--selection', '--review-a', '--review-b', '--lead', '--owner', '--adjudication', '--mode', '--modes', '--output']),
  }[command]
  for (const [key, value] of Object.entries(options)) if ((key === '--mode' ? value.length > 0 : value !== undefined) && !commandOptions.has(key)) fail(`${key} is not valid for ${command}.`)
  for (const key of ['--selection', '--output']) if (!options[key]) fail(`${key} is required.`)
  if (command !== 'lead-template') for (const key of ['--review-a', '--review-b']) if (!options[key]) fail(`${key} is required.`)
  if (command === 'lead-template' && !options['--lead']) fail('--lead blank worksheet is required for lead-template.')
  if (command === 'merge') for (const key of ['--lead', '--owner']) if (!options[key]) fail(`${key} is required for merge.`)
  if (options['--modes'] && options['--mode'].length) fail('Use either repeatable --mode IDs or --modes JSON, not both.')
  const paths = Object.fromEntries(Object.entries(options).filter(([key]) => !['--owner', '--mode'].includes(key)).map(([key, value]) => [key, resolve(value)]))
  const output = paths['--output']
  if (Object.entries(paths).some(([key, path]) => key !== '--output' && path.toLowerCase() === output.toLowerCase())) fail('Output cannot overwrite an input file.')
  const selection = await readJson(paths['--selection'], 'selection')
  let result
  if (command === 'lead-template') {
    const lead = await readJson(paths['--lead'], 'blank lead metadata')
    result = buildLeadWorkingCopy(lead.value, selection.value)
  } else {
    const reviewA = await readJson(paths['--review-a'], 'review A'); const reviewB = await readJson(paths['--review-b'], 'review B')
    if (command === 'adjudication-request') {
    result = buildAdjudicationRequest({ selection: selection.value, reviewA: reviewA.value, reviewB: reviewB.value, reviewAFileSha256: reviewA.sha256, reviewBFileSha256: reviewB.sha256 })
    } else {
      const lead = await readJson(paths['--lead'], 'lead metadata')
      const adjudication = paths['--adjudication'] ? await readJson(paths['--adjudication'], 'adjudication') : null
      const modes = paths['--modes'] ? await readJson(paths['--modes'], 'modes') : null
      const selectedModes = modes?.value ?? options['--mode'].map(id => BROWSER_PILOT_MODES[id] ?? fail(`Unknown browser mode ${id}; run npm run field:browser -- --modes.`))
      result = mergeFieldReviewEvidence({ selection: selection.value, reviewA: reviewA.value, reviewB: reviewB.value, lead: lead.value, adjudication: adjudication?.value ?? null, ownerId: options['--owner'], modes: selectedModes, fileHashes: { selection: selection.sha256, reviewA: reviewA.sha256, reviewB: reviewB.sha256, lead: lead.sha256, ...(adjudication ? { adjudication: adjudication.sha256 } : {}) } })
    }
  }
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  const note = command === 'merge' ? `Draft created with ${result.samples.length} samples and ${result.modes.length} pre-registered mode(s). It is not frozen, independently identity-verified, or an accuracy result.` : command === 'adjudication-request' ? `${result.adjudications.length} disagreement sample(s); no A/B values were copied into the request.` : 'Blank lead working copy created. No pending value was completed or changed to false.'
  process.stdout.write(`Created ${output}\n${note}\n`)
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Review evidence import failed: ${error.message}\n`); process.exitCode = 1 })
