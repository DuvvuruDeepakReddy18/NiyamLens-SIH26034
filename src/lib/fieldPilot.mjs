import { CRITICAL_FIELDS, CRITICAL_BENCHMARK_LIMITS, validateCriticalFieldManifest, validateCriticalOcrRows, scoreCriticalFields } from './criticalFieldBenchmark.mjs'
import { extractDeclarations } from './extraction.mjs'

export const FIELD_PILOT_LIMITS = Object.freeze({ minPhotos: 20, maxPhotos: 30, modes: 8, bytes: 20_000_000 })
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const fail = message => { throw new Error(message) }
const text = (value, name, max = 200, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${name} requires ${empty ? '' : 'nonempty '}text of at most ${max} characters.`)
  return value
}
const identifier = (value, name) => { text(value, name, 100); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) fail(`${name} must use letters, digits, dots, underscores or hyphens.`); return value }
const digest = (value, name) => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(`${name} requires a lowercase SHA256 digest.`); return value }
const date = (value, name) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) fail(`${name} requires a real UTC ISO timestamp.`)
  return value
}
const ratio = (a, b) => b ? a / b : null

export function assertPilotJson(value) {
  let nodes = 0; let characters = 0
  const active = new Set()
  const visit = (item, depth = 0) => {
    if (++nodes > 200_000 || depth > 20) fail('Field pilot JSON is too complex.')
    if (typeof item === 'string') { characters += item.length; if (characters > FIELD_PILOT_LIMITS.bytes) fail('Field pilot JSON exceeds the text budget.'); return }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return
    if (!plain(item) && !Array.isArray(item)) fail('Field pilot requires finite plain JSON values.')
    if (active.has(item)) fail('Field pilot JSON contains a circular reference.')
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail('Field pilot arrays must not be sparse.')
    active.add(item)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(descriptor, 'value')) fail('Field pilot JSON contains an unsafe property.')
      visit(descriptor.value, depth + 1)
    }
    active.delete(item)
  }
  visit(value)
  return value
}

export function canonicalPilotJson(value) {
  assertPilotJson(value)
  const ordered = item => Array.isArray(item) ? item.map(ordered) : plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item
  return JSON.stringify(ordered(value))
}

export function safePilotPath(value) {
  text(value, 'sourcePath', 1000)
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path) || /[\u0000-\u001f:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) fail('Photo sourcePath must be a safe root-relative path.')
  return path
}

// Reuse the existing exact-value validator/extractor without changing its honest
// development-only public contract. These objects are internal adapters only;
// their development annotation metadata is never returned as a pilot claim.
function criticalAdapter(samples) {
  return { schemaVersion: 1, datasetId: 'internal-field-pilot-adapter', corpusRole: 'previously-used-development-corpus', isHoldout: false, annotation: { status: 'provisional-human-review-required', humanReviewed: false }, samples }
}
function criticalSample(sample, fields) {
  return { id: sample.id, sourcePath: sample.sourcePath, sha256: sample.sha256, expectedStatus: null, fields, expectedValues: Object.fromEntries(CRITICAL_FIELDS.filter(field => fields[field]?.status === 'readable').map(field => [field, fields[field].value])) }
}
function checkedLabels(sample, fields) {
  if (!plain(fields)) fail(`${sample.id} requires all three critical field labels.`)
  validateCriticalFieldManifest(criticalAdapter([criticalSample(sample, fields)]))
  for (const field of CRITICAL_FIELDS) text(fields[field].notes ?? '', `${sample.id}.${field}.notes`, 2000, true)
  return fields
}
const labelIdentity = fields => JSON.stringify(CRITICAL_FIELDS.map(field => [field, fields[field].status, fields[field].value]))

export function resolvedPilotLabels(sample, frozenAt = null) {
  const truth = sample.groundTruth
  if (!plain(truth) || !Array.isArray(truth.reviews) || truth.reviews.length !== 2) fail(`${sample.id} requires exactly two independent human reviews.`)
  const reviewers = new Set()
  for (const review of truth.reviews) {
    if (!plain(review)) fail('Human review must be an object.')
    identifier(review.reviewerId, 'reviewerId')
    if (reviewers.has(review.reviewerId)) fail('The two initial reviewers must be different people.'); reviewers.add(review.reviewerId)
    date(review.reviewedAt, 'reviewedAt')
    if (Date.parse(review.reviewedAt) < Date.parse(sample.capturedAt ?? sample.acquiredAt)) fail('Ground truth review cannot precede photo capture/acquisition.')
    if (review.ocrOutputsConsulted !== false || review.independentPhotoReview !== true) fail('Reviewers must attest independent photo review without consulting OCR outputs.')
    if (frozenAt && Date.parse(review.reviewedAt) > Date.parse(frozenAt)) fail('Ground truth must be reviewed before the freeze.')
    checkedLabels(sample, review.fields)
  }
  const [first, second] = truth.reviews
  if (labelIdentity(first.fields) === labelIdentity(second.fields) && truth.adjudication == null) return first.fields
  const adjudication = truth.adjudication
  if (!plain(adjudication)) fail(`${sample.id} has disagreement: a third human adjudicator is required.`)
  identifier(adjudication.reviewerId, 'adjudicator reviewerId')
  if (reviewers.has(adjudication.reviewerId)) fail('Adjudication needs a third reviewer, not either initial labeler.')
  date(adjudication.reviewedAt, 'adjudication.reviewedAt')
  if (Date.parse(adjudication.reviewedAt) < Math.max(...truth.reviews.map(review => Date.parse(review.reviewedAt))) || (frozenAt && Date.parse(adjudication.reviewedAt) > Date.parse(frozenAt))) fail('Adjudication must follow both initial reviews and precede the freeze.')
  text(adjudication.reason, 'adjudication.reason', 2000)
  if (adjudication.ocrOutputsConsulted !== false || adjudication.independentPhotoReview !== true) fail('Adjudication must be independent of OCR predictions.')
  return checkedLabels(sample, adjudication.fields)
}

export function validatePilotManifest(manifest, { requireFrozen = false } = {}) {
  assertPilotJson(manifest)
  if (!plain(manifest) || manifest.schemaVersion !== 1 || manifest.kind !== 'prospective-field-pilot' || !['draft', 'frozen'].includes(manifest.state)) fail('Expected a schemaVersion 1 prospective-field-pilot manifest.')
  identifier(manifest.datasetId, 'datasetId'); identifier(manifest.ownerId, 'ownerId')
  if (manifest.isHoldout !== false || manifest.freshnessClaim !== 'team-attested-new-sku-not-independently-verified') fail('A field pilot cannot claim an independently verified holdout.')
  text(manifest.samplingPlan, 'samplingPlan', 4000)
  if (!Array.isArray(manifest.samples) || manifest.samples.length > FIELD_PILOT_LIMITS.maxPhotos) fail('Pilot supports up to 30 distinct product photographs.')
  if (!Array.isArray(manifest.modes) || manifest.modes.length > FIELD_PILOT_LIMITS.modes) fail('Register at most eight OCR modes before freeze.')
  const modes = new Set()
  for (const mode of manifest.modes) {
    if (!plain(mode)) fail('Each OCR mode must be an object.')
    identifier(mode.id, 'mode.id'); text(mode.engine, 'mode.engine'); text(mode.version, 'mode.version'); text(mode.configuration, 'mode.configuration', 2000)
    if (modes.has(mode.id)) fail('Duplicate registered OCR mode.'); modes.add(mode.id)
    if (typeof mode.manualRoi !== 'boolean') fail('Each mode must state whether it uses manual ROI selection.')
  }
  const ids = new Set(); const paths = new Set(); const hashes = new Set(); const products = new Set()
  for (const sample of manifest.samples) {
    if (!plain(sample)) fail('Each pilot sample must be an object.')
    identifier(sample.id, 'sample.id'); text(sample.productKey, 'sample.productKey', 200)
    if (sample.productKey !== sample.productKey.trim().toLowerCase()) fail('productKey must be trimmed lowercase (use exact barcode digits when available).')
    const path = safePilotPath(sample.sourcePath); digest(sample.sha256, 'sample.sha256')
    for (const [set, value, name] of [[ids, sample.id, 'ID'], [paths, path.toLowerCase(), 'path'], [hashes, sample.sha256, 'image hash'], [products, sample.productKey, 'SKU/productKey']]) {
      if (set.has(value)) fail(`Duplicate pilot ${name}; alternate views of the same SKU are not independent samples.`); set.add(value)
    }
    if (sample.capturedAt === null && sample.captureRights === 'licensed-for-evaluation') date(sample.acquiredAt, 'acquiredAt (actual camera capture time unknown)')
    else date(sample.capturedAt, 'capturedAt')
    if (sample.acquiredAt !== undefined) { date(sample.acquiredAt, 'acquiredAt'); if (sample.capturedAt !== null && Date.parse(sample.acquiredAt) < Date.parse(sample.capturedAt)) fail('Acquisition cannot precede a known camera capture date.') }
    identifier(sample.collectorId, 'collectorId')
    if (sample.previouslyUsedForDevelopment !== false) fail('Previously used development images/products cannot enter this prospective pilot.')
    if (!['team-owned-with-consent', 'licensed-for-evaluation'].includes(sample.captureRights)) fail('Photo captureRights must state permission to use the image.')
    text(sample.rightsNote, 'rightsNote', 2000)
    for (const key of ['conditions', 'scripts']) {
      if (!Array.isArray(sample[key]) || !sample[key].length || sample[key].length > 12 || new Set(sample[key]).size !== sample[key].length) fail(`sample.${key} requires one to twelve unique tags.`)
      sample[key].forEach(value => text(value, `sample.${key}`, 100))
    }
    text(sample.shape, 'sample.shape', 100)
    if (sample.groundTruth != null) resolvedPilotLabels(sample, manifest.freeze?.at)
  }
  if (requireFrozen && manifest.state !== 'frozen') fail('Freeze this pilot before scoring OCR.')
  if (manifest.state === 'frozen') {
    if (manifest.samples.length < FIELD_PILOT_LIMITS.minPhotos) fail('Freezing requires 20–30 unique product photographs.')
    if (!manifest.modes.length) fail('Register at least one OCR mode before freeze.')
    if (!plain(manifest.freeze)) fail('Frozen manifest requires freeze metadata.')
    date(manifest.freeze.at, 'freeze.at'); identifier(manifest.freeze.by, 'freeze.by'); digest(manifest.freeze.payloadSha256, 'freeze.payloadSha256')
    if (!plain(manifest.exclusionInventory) || !Array.isArray(manifest.exclusionInventory.files) || !manifest.exclusionInventory.files.length) fail('Freeze requires a checked development-exclusion inventory.')
    digest(manifest.exclusionInventory.sha256, 'exclusionInventory.sha256')
    for (const file of manifest.exclusionInventory.files) {
      safePilotPath(file.path); digest(file.sha256, 'exclusion inventory file digest')
      if (file.hashKind !== undefined && !['canonical-json-sha256', 'original-image-bytes-sha256'].includes(file.hashKind)) fail('Unknown exclusion inventory hash type.')
    }
    for (const sample of manifest.samples) {
      if (Date.parse(sample.capturedAt ?? sample.acquiredAt) > Date.parse(manifest.freeze.at)) fail('Capture/acquisition cannot occur after freeze.')
      resolvedPilotLabels(sample, manifest.freeze.at)
    }
  } else if (manifest.freeze != null) fail('Drafts must not carry a stale freeze seal.')
  return manifest
}

export function pilotSealPayload(manifest) {
  const copy = structuredClone(manifest)
  if (copy.freeze) delete copy.freeze.payloadSha256
  return canonicalPilotJson(copy)
}

export function checkPilotExclusions(manifest, inventory) {
  const hashes = new Set(inventory.hashes); const products = new Set(inventory.products)
  for (const sample of manifest.samples) {
    if (hashes.has(sample.sha256)) fail(`${sample.id} matches an already-used development image hash.`)
    if (products.has(sample.productKey)) fail(`${sample.id} matches an already-used development SKU/productKey.`)
  }
}

export function validatePilotRuns(input, manifest, hashText) {
  validatePilotManifest(manifest, { requireFrozen: true }); assertPilotJson(input)
  if (hashText(pilotSealPayload(manifest)) !== manifest.freeze.payloadSha256) fail('Frozen manifest SHA256 mismatch; do not edit a frozen pilot in place.')
  if (!plain(input) || input.schemaVersion !== 1 || input.kind !== 'field-pilot-ocr-runs' || input.datasetId !== manifest.datasetId || input.freezeSha256 !== manifest.freeze.payloadSha256 || !Array.isArray(input.rows)) fail('OCR runs must bind to this exact dataset and frozen manifest SHA256.')
  if (input.rows.length > manifest.samples.length * manifest.modes.length) fail('Too many OCR rows for the registered sample/mode matrix.')
  for (const row of input.rows) if (!plain(row) || row.manuallyEdited !== false || row.transcriptKind !== 'raw-ocr-unedited') fail('Raw OCR needs explicit manuallyEdited=false and raw-ocr-unedited provenance.')
  const modes = new Set(manifest.modes.map(mode => mode.id)); const samples = new Map(manifest.samples.map(sample => [sample.id, sample]))
  const rows = validateCriticalOcrRows(input.rows, criticalAdapter(manifest.samples))
  for (const row of rows) {
    const sample = samples.get(row.sampleId)
    if (!modes.has(row.mode)) fail('OCR mode was not registered before freeze; do not tune/cherry-pick a new mode on the held-out pilot.')
    if (row.manuallyEdited !== false || row.transcriptKind !== 'raw-ocr-unedited') fail('Raw OCR needs explicit manuallyEdited=false and raw-ocr-unedited provenance.')
    if (row.sourceSha256 !== sample.sha256 || row.sourcePath !== sample.sourcePath) fail('Each OCR row requires the exact image path and SHA256.')
    digest(row.rawTextSha256, 'rawTextSha256')
    if (row.rawTextSha256 !== hashText(row.rawText)) fail('Raw OCR text SHA256 mismatch; do not overwrite OCR with a corrected transcript.')
    date(row.startedAt, 'startedAt'); date(row.finishedAt, 'finishedAt')
    if (Date.parse(row.startedAt) < Date.parse(manifest.freeze.at) || Date.parse(row.finishedAt) < Date.parse(row.startedAt)) fail('OCR must start after freeze and finish after its start.')
    if (row.error && row.rawText !== '') fail('A failed OCR run must use empty rawText, not a leftover successful transcript.')
    if (row.review != null) {
      const review = row.review
      if (!plain(review)) fail('Officer review must be a separate object.')
      identifier(review.officerId, 'review.officerId'); date(review.reviewedAt, 'review.reviewedAt')
      if (Date.parse(review.reviewedAt) < Date.parse(row.finishedAt)) fail('Officer review must follow OCR completion.')
      if (typeof review.requiredReview !== 'boolean' || typeof review.reviewSeconds !== 'number' || !Number.isFinite(review.reviewSeconds) || review.reviewSeconds < 0 || review.reviewSeconds > 86400) fail('Officer review needs a boolean requiredReview and bounded measured seconds.')
      text(review.workingText, 'review.workingText', CRITICAL_BENCHMARK_LIMITS.text, true)
      text(review.reason, 'review.reason', 2000)
      if (review.photoCompared !== true) fail('Officer corrections require a photo-comparison acknowledgement.')
    }
  }
  return rows
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
function extractionIdentity(textValue, field) {
  const value = extractDeclarations(textValue).byId[field]
  return JSON.stringify([value.value, value.conflict, value.validation?.status])
}

export function scoreFieldPilot(manifest, input, hashText) {
  const rows = validatePilotRuns(input, manifest, hashText)
  const adapter = criticalAdapter(manifest.samples.map(sample => criticalSample(sample, resolvedPilotLabels(sample, manifest.freeze.at))))
  const score = selected => scoreCriticalFields(adapter, selected).runs
  const rawRuns = score(rows)
  const correctedRows = rows.filter(row => row.review).map(row => ({ ...row, rawText: row.review.workingText, error: null, manuallyEdited: false, transcriptKind: 'raw-ocr-unedited' }))
  const reviewedRuns = score(correctedRows)
  const runs = manifest.modes.map(mode => {
    const modeRows = rows.filter(row => row.mode === mode.id); const reviewed = modeRows.filter(row => row.review)
    const corrections = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, reviewed.filter(row => extractionIdentity(row.rawText, field) !== extractionIdentity(row.review.workingText, field)).length]))
    // A registered mode with no rows must remain visible as entirely missing;
    // it cannot disappear from the report or be represented as 100% accuracy.
    const raw = rawRuns.find(run => run.mode === mode.id) ?? { mode: mode.id, photoCount: manifest.samples.length, attemptedPhotos: 0, missingPhotos: manifest.samples.length, completeCorpusRun: false, exactMatchCorrect: 0, exactMatchSamples: CRITICAL_FIELDS.reduce((sum, field) => sum + adapter.samples.filter(sample => sample.fields[field].metricEligible).length, 0), exactMatchRate: null, attemptedExactMatchRate: null, perField: Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { referenceFields: adapter.samples.filter(sample => sample.fields[field].metricEligible).length, attemptedFields: 0, exactMatchCorrect: 0, exactMatchRate: null, missingRunFields: adapter.samples.filter(sample => sample.fields[field].metricEligible).length }])), sampleResults: [] }
    const conditionCoverage = Object.fromEntries([...new Set(manifest.samples.flatMap(sample => sample.conditions))].map(condition => [condition, { photos: manifest.samples.filter(sample => sample.conditions.includes(condition)).length, attempted: modeRows.filter(row => manifest.samples.find(sample => sample.id === row.sampleId).conditions.includes(condition)).length }]))
    return {
      mode, rawOcr: raw, officerWorkingTranscript: reviewedRuns.find(run => run.mode === mode.id) ?? null,
      reviewBurden: { attemptedPhotos: modeRows.length, reviewedPhotos: reviewed.length, missingReviewObservations: modeRows.length - reviewed.length, requiredReviewPhotos: reviewed.filter(row => row.review.requiredReview).length, observedRequiredReviewRate: ratio(reviewed.filter(row => row.review.requiredReview).length, reviewed.length), changedTranscriptPhotos: reviewed.filter(row => row.rawText !== row.review.workingText).length, changedCriticalFields: corrections, totalReviewSeconds: reviewed.reduce((sum, row) => sum + row.review.reviewSeconds, 0), medianReviewSeconds: median(reviewed.map(row => row.review.reviewSeconds)) },
      latency: { observedRuns: modeRows.length, medianOcrSeconds: median(modeRows.map(row => (Date.parse(row.finishedAt) - Date.parse(row.startedAt)) / 1000)) }, conditionCoverage,
    }
  })
  return {
    schemaVersion: 1, kind: 'field-pilot-score', datasetId: manifest.datasetId, freezeSha256: manifest.freeze.payloadSha256, sampleCount: manifest.samples.length, isHoldout: false, freshnessClaim: manifest.freshnessClaim, groundTruthStatus: 'two-human-reviews-with-third-reviewer-adjudication-when-needed-self-attested', runs,
    definitions: { rawOcr: 'Actual existing critical-field extractor on supplied unchanged raw OCR, separately for every pre-registered mode. Missing photos preserve full readable denominators and null full-corpus accuracy.', officerWorkingTranscript: 'Assisted outcome after an officer reviewed/edited text; NEVER report this as raw OCR accuracy. Missing reviews remain missing, not assumed correct.', correctionBurden: 'Transcript changes and per-critical-field changes are computed from raw versus working text. Field changes compare extraction value/conflict/validation, not operator claims. Review times and review-needed flags are operator-supplied.', unreadableLabels: 'not_visible, illegible and ambiguous_field are excluded from exact-match denominators, never counted as correct negatives or legal absences.' },
    limitations: ['20–30 SKU-disjoint photographs are a pilot, not a representative or statistically established field-accuracy benchmark.', 'Hashes bind the files and submitted transcripts, but do not attest that OCR executed or that a person did not fabricate a transcript before hashing it.', 'Development exclusion checks cover recorded local inventory only. Team attestation cannot establish all prior exposure or pretrained model exposure.', 'Human identity, independence, capture rights, timing and observations are self-attested, not independently verified.', 'Once pilot results guide model tuning, retire this version to development and collect a new SKU-disjoint pilot.', 'No legal compliance correctness, typography accuracy, jurisdictional validity or cloud security is measured.'],
  }
}
