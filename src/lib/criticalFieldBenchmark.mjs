import { extractDeclarations } from './extraction.mjs'
import { MAX_LABEL_TEXT, normalizeUnit } from './labelParser.mjs'

export const CRITICAL_FIELDS = Object.freeze(['mrp', 'netQuantity', 'packDate'])
export const CRITICAL_BENCHMARK_LIMITS = Object.freeze({ samples: 500, rows: 5000, text: MAX_LABEL_TEXT, totalCharacters: 20_000_000, nodes: 200_000, depth: 15 })
const LABEL_STATUSES = new Set(['readable', 'not_visible', 'illegible', 'ambiguous_field'])
const NON_HOLDOUT_CORPUS_ROLES = new Set(['previously-used-development-corpus', 'availability-sampled-abstention-checkset', 'prospectively-frozen-ai-discovery-corpus'])
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const ratio = (a, b) => b ? a / b : null
const fail = message => { throw new Error(message) }
const boundedText = (value, name, max = 200, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${name} must be ${empty ? '' : 'nonempty '}text of at most ${max} characters.`)
  return value
}

// Direct callers receive the same finite-JSON and size safeguards as CLI imports.
function safeJson(value) {
  let nodes = 0; let characters = 0
  const active = new Set()
  const visit = (item, depth = 0) => {
    if (++nodes > CRITICAL_BENCHMARK_LIMITS.nodes || depth > CRITICAL_BENCHMARK_LIMITS.depth) fail('Critical benchmark input is too complex or deeply nested.')
    if (typeof item === 'string') { characters += item.length; if (characters > CRITICAL_BENCHMARK_LIMITS.totalCharacters) fail('Critical benchmark input exceeds its text budget.'); return }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return
    if (!Array.isArray(item) && !plain(item)) fail('Critical benchmark accepts finite JSON values and plain objects only.')
    if (active.has(item)) fail('Critical benchmark input contains a circular reference.')
    if (Array.isArray(item) && Object.keys(item).length !== item.length) fail('Critical benchmark arrays must not be sparse or have extra properties.')
    active.add(item)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(descriptor, 'value')) fail('Critical benchmark contains an unsafe property.')
      visit(descriptor.value, depth + 1)
    }
    active.delete(item)
  }
  visit(value)
}

export function normalizeCriticalValue(field, value) {
  boundedText(value, 'Critical value', 2000, true)
  let normalized = value.trim().toLowerCase().replace(/\s+/g, ' ')
  if (field === 'netQuantity') {
    const match = /^([\d,.]+)\s*([a-zℓ]+)$/.exec(normalized)
    if (match) normalized = `${match[1]} ${match[2] === 'ℓ' ? 'l' : normalizeUnit(match[2])}`
  }
  return normalized
}

function checkedPath(value, name) {
  boundedText(value, name, 1000)
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f]/.test(path)) fail(`${name} must be a safe repository-relative path.`)
  return path
}

export function validateCriticalFieldManifest(manifest) {
  safeJson(manifest)
  if (!plain(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.samples)) fail('Critical manifest requires schemaVersion 1 and a samples array.')
  boundedText(manifest.datasetId, 'datasetId')
  if (manifest.isHoldout !== false || !NON_HOLDOUT_CORPUS_ROLES.has(manifest.corpusRole)) fail('This scorer requires an explicitly identified development corpus, AI discovery corpus or abstention checkset, not a holdout claim.')
  if (!plain(manifest.annotation) || manifest.annotation.status !== 'provisional-human-review-required' || manifest.annotation.humanReviewed !== false) fail('Manifest must preserve the provisional AI / human-review-required annotation status.')
  if (!manifest.samples.length || manifest.samples.length > CRITICAL_BENCHMARK_LIMITS.samples) fail('Critical manifest requires between 1 and 500 photographs.')
  const ids = new Set(); const paths = new Set()
  for (const sample of manifest.samples) {
    if (!plain(sample)) fail('Each critical sample must be an object.')
    boundedText(sample.id, 'sample.id')
    if (ids.has(sample.id)) fail('Duplicate critical sample ID.'); ids.add(sample.id)
    const path = checkedPath(sample.sourcePath, 'sample.sourcePath')
    if (paths.has(path)) fail('Duplicate critical source photograph.'); paths.add(path)
    if (typeof sample.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(sample.sha256)) fail('Each photograph requires a SHA256 hexadecimal digest.')
    if (sample.expectedStatus !== null) fail('Critical photo labels must not supply a legal compliance verdict.')
    if (!plain(sample.fields) || !plain(sample.expectedValues)) fail('Each critical sample requires fields and expectedValues objects.')
    if (Object.keys(sample.fields).some(key => !CRITICAL_FIELDS.includes(key)) || Object.keys(sample.expectedValues).some(key => !CRITICAL_FIELDS.includes(key))) fail('Critical labels contain an unsupported field.')
    for (const field of CRITICAL_FIELDS) {
      const label = sample.fields[field]
      if (!plain(label) || !LABEL_STATUSES.has(label.status)) fail(`Invalid label status for ${sample.id}.${field}.`)
      if (label.status === 'readable') {
        boundedText(label.value, `${sample.id}.${field}.value`, 2000)
        if (label.metricEligible !== true || sample.expectedValues[field] !== label.value) fail('Readable labels must be eligible and agree exactly with expectedValues.')
        const heading = { mrp: 'MRP Rs. ', netQuantity: 'NET QUANTITY: ', packDate: 'PACKED ON: ' }[field]
        const reference = extractDeclarations(`${heading}${label.value}`).byId[field]
        if (reference.candidates.length !== 1 || !reference.candidates[0].valid || reference.conflict) fail(`Readable reference ${sample.id}.${field} is not a valid complete critical value.`)
      } else if (label.metricEligible !== false || label.value !== null || Object.hasOwn(sample.expectedValues, field)) fail('Unreadable or ambiguous labels must be excluded with a null value, not scored as negatives.')
    }
  }
  if (manifest.scoringPolicy?.expectedReadableDenominators) {
    for (const field of CRITICAL_FIELDS) {
      const count = manifest.samples.filter(sample => sample.fields[field].metricEligible).length
      if (manifest.scoringPolicy.expectedReadableDenominators[field] !== count) fail(`Stored ${field} denominator does not match readable labels.`)
    }
  }
  return manifest
}

export function validateCriticalOcrRows(rows, manifest) {
  safeJson(rows)
  if (!Array.isArray(rows) || rows.length > CRITICAL_BENCHMARK_LIMITS.rows) fail('Critical OCR rows must be an array of at most 5000 rows.')
  const samples = new Map(manifest.samples.map(sample => [sample.id, sample]))
  const seen = new Set()
  return rows.map(row => {
    if (!plain(row)) fail('Each OCR row must be an object.')
    boundedText(row.sampleId, 'row.sampleId')
    boundedText(row.mode, 'row.mode', 300)
    const sample = samples.get(row.sampleId)
    if (!sample) fail(`OCR row references unknown sample ${row.sampleId}.`)
    const key = JSON.stringify([row.sampleId, row.mode])
    if (seen.has(key)) fail('Duplicate sample/mode OCR rows would inflate denominators.'); seen.add(key)
    boundedText(row.rawText, 'row.rawText', CRITICAL_BENCHMARK_LIMITS.text, true)
    if (row.error !== undefined && row.error !== null) boundedText(row.error, 'row.error', 2000)
    if (row.manuallyEdited === true || row.transcriptKind && row.transcriptKind !== 'raw-ocr-unedited') fail('Only unedited raw OCR transcripts are eligible; manually repaired text must not be submitted.')
    if (row.sourcePath !== undefined && checkedPath(row.sourcePath, 'row.sourcePath') !== sample.sourcePath.replace(/\\/g, '/')) fail('OCR source path does not match the labelled photograph.')
    if (row.sourceSha256 !== undefined && (typeof row.sourceSha256 !== 'string' || row.sourceSha256.toLowerCase() !== sample.sha256.toLowerCase())) fail('OCR source hash does not match the labelled photograph.')
    return { ...row, transcriptKind: 'raw-ocr-unedited' }
  })
}

// Adapts the fresh recognition experiment's JSONL rows. Precomputed extraction,
// visibleChecks and engine confidence are deliberately not used for scoring.
export function adaptCriticalOcrInput(input, manifest, { modePrefix = 'import' } = {}) {
  safeJson(input)
  boundedText(modePrefix, 'modePrefix', 100)
  const rows = Array.isArray(input) ? input : plain(input) && Array.isArray(input.rows) ? input.rows : null
  if (!rows || rows.length > CRITICAL_BENCHMARK_LIMITS.rows) fail('OCR input must be an array, an object with rows, or parsed JSONL rows.')
  const knownPaths = new Map(manifest.samples.map(sample => [sample.sourcePath.replace(/\\/g, '/'), sample]))
  const output = []; const unmatched = []; let sessionRows = 0
  for (const [index, row] of rows.entries()) {
    if (!plain(row)) fail(`OCR input row ${index + 1} must be an object.`)
    if (row.type === 'session') { sessionRows += 1; continue }
    if (row.type === 'result' || row.type === 'error') {
      const image = checkedPath(row.image, 'experiment.image')
      const sourcePath = image.startsWith('datasets/') ? image : `datasets/openfoodfacts-india/real-labels/${image}`
      boundedText(row.variant, 'experiment.variant', 100)
      if (!['string', 'number'].includes(typeof row.psm) || !/^\d{1,2}$/.test(String(row.psm))) fail('Experiment PSM must be a short integer.')
      const sample = knownPaths.get(sourcePath)
      if (!sample) { unmatched.push({ row: index + 1, sourcePath, variant: row.variant, psm: row.psm, reason: 'No label exists for this exact photograph; same product code is insufficient.' }); continue }
      if (row.sampleId !== undefined && row.sampleId !== sample.id) fail('Experiment sampleId disagrees with its exact image path.')
      if (row.sourcePath !== undefined && checkedPath(row.sourcePath, 'experiment.sourcePath') !== sourcePath) fail('Experiment sourcePath disagrees with its image path.')
      const rawText = row.rawText ?? (row.type === 'error' ? '' : undefined)
      const error = typeof row.error === 'string' ? row.error : row.type === 'error' ? 'OCR experiment reported an error.' : null
      const outputRow = { sampleId: sample.id, sourcePath, mode: `${modePrefix}:${row.variant}:psm${row.psm}`, rawText, error, transcriptKind: 'raw-ocr-unedited', manuallyEdited: row.manuallyEdited ?? false, metadata: { variant: row.variant, psm: row.psm, crop: row.crop ?? null, manuallySelectedRoi: row.crop != null, suppliedProvenance: row.provenance ?? null, provenance: 'Imported raw experiment field; no independent attestation of capture or transcript integrity.' } }
      if (row.imageSha256 !== undefined) outputRow.sourceSha256 = row.imageSha256
      output.push(outputRow)
    } else if (row.type !== undefined) fail(`Unsupported OCR input row type ${String(row.type)}.`)
    else { boundedText(row.mode, 'row.mode', 200); output.push({ ...row, mode: `${modePrefix}:${row.mode}` }) }
  }
  return { rows: validateCriticalOcrRows(output, manifest), unmatched, sessionRows }
}

function wrongTypedValue(field, candidate, expected) {
  if (!candidate.valid) return false
  if (field === 'mrp') return candidate.amount !== Number(expected.replace(/,/g, ''))
  if (field === 'netQuantity') {
    const match = /^([\d,.]+)\s+(.+)$/.exec(normalizeCriticalValue(field, expected))
    return !match || candidate.quantity !== Number(match[1].replace(/,/g, '')) || candidate.unit !== match[2]
  }
  // Dates are compared as printed text. Do not silently infer the century or
  // treat a use-by date as a packing date because its digits happen to match.
  return normalizeCriticalValue(field, candidate.value) !== normalizeCriticalValue(field, expected)
}

export function scoreCriticalFields(manifestInput, inputRows) {
  const manifest = validateCriticalFieldManifest(manifestInput)
  const rows = validateCriticalOcrRows(inputRows, manifest)
  const modes = [...new Set(rows.map(row => row.mode))].sort()
  const runs = modes.map(mode => {
    const lookup = new Map(rows.filter(row => row.mode === mode).map(row => [row.sampleId, row]))
    const perField = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { referenceFields: 0, attemptedFields: 0, exactMatchCorrect: 0, exactMatchSamples: 0, exactMatchRate: null, attemptedExactMatchRate: null, missingRunFields: 0, errorFields: 0, wrongValidValues: 0, invalidCandidateFields: 0, conflictFields: 0, excludedFields: 0, excludedAttemptedFields: 0, excludedWithCandidates: 0 }]))
    const sampleResults = manifest.samples.map(sample => {
      const row = lookup.get(sample.id)
      const error = row?.error || null
      const parsed = extractDeclarations(row?.rawText || '')
      const fields = Object.fromEntries(CRITICAL_FIELDS.map(id => {
        const label = sample.fields[id]; const field = parsed.byId[id]; const stat = perField[id]
        const candidates = field.candidates || []
        const eligible = label.status === 'readable' && label.metricEligible
        const valid = !error && candidates.length === 1 && candidates[0].valid === true && field.validation?.status === 'format_valid' && !field.conflict
        const normalizedActual = valid ? normalizeCriticalValue(id, field.value) : null
        const normalizedExpected = eligible ? normalizeCriticalValue(id, label.value) : null
        const correct = eligible && row ? valid && normalizedActual === normalizedExpected : null
        const wrongNumericCandidates = eligible ? candidates.filter(candidate => wrongTypedValue(id, candidate, label.value)) : []
        let outcome = !eligible ? 'excluded_label' : !row ? 'missing_run' : error ? 'ocr_error' : field.conflict ? 'conflict' : !candidates.length ? 'not_extracted' : !valid ? 'invalid_candidate' : correct ? 'exact_match' : 'wrong_value'
        if (eligible) {
          stat.referenceFields += 1; stat.exactMatchSamples += 1
          if (!row) stat.missingRunFields += 1
          else { stat.attemptedFields += 1; if (correct) stat.exactMatchCorrect += 1 }
          if (error) stat.errorFields += 1
          if (outcome === 'wrong_value') stat.wrongValidValues += 1
          if (field.conflict) stat.conflictFields += 1
          if (candidates.some(candidate => !candidate.valid)) stat.invalidCandidateFields += 1
        } else {
          stat.excludedFields += 1
          if (row) { stat.excludedAttemptedFields += 1; if (candidates.length) stat.excludedWithCandidates += 1 }
        }
        return [id, { labelStatus: label.status, eligible, expected: eligible ? label.value : null, actual: field.value || null, valid, normalizedActual, normalizedExpected, correct, outcome, conflict: field.conflict === true, validation: field.validation, candidates, wrongNumericCandidates, exclusionNote: eligible ? null : label.notes || 'No readable value ground truth for this photograph.' }]
      }))
      return { sampleId: sample.id, sourcePath: sample.sourcePath, expectedImageSha256: sample.sha256, attempted: Boolean(row), error, rawText: row?.rawText ?? null, rawTextLength: row?.rawText.length ?? null, inputMetadata: row?.metadata ?? null, fields }
    })
    for (const field of Object.values(perField)) {
      field.attemptedExactMatchRate = ratio(field.exactMatchCorrect, field.attemptedFields)
      field.exactMatchRate = field.missingRunFields ? null : ratio(field.exactMatchCorrect, field.exactMatchSamples)
    }
    const sum = key => Object.values(perField).reduce((total, field) => total + field[key], 0)
    return { mode, photoCount: manifest.samples.length, attemptedPhotos: lookup.size, missingPhotos: manifest.samples.length - lookup.size, failedPhotos: [...lookup.values()].filter(row => row.error).length, completeCorpusRun: lookup.size === manifest.samples.length, exactMatchCorrect: sum('exactMatchCorrect'), exactMatchSamples: sum('exactMatchSamples'), attemptedExactMatchSamples: sum('attemptedFields'), exactMatchRate: sum('missingRunFields') ? null : ratio(sum('exactMatchCorrect'), sum('exactMatchSamples')), attemptedExactMatchRate: ratio(sum('exactMatchCorrect'), sum('attemptedFields')), perField, sampleResults }
  })
  return {
    schemaVersion: 1, datasetId: manifest.datasetId, corpusRole: manifest.corpusRole, isHoldout: false, annotationStatus: manifest.annotation.status, humanReviewed: false,
    sampleCount: manifest.samples.length, inputRows: rows.length, runs,
    complianceVerdictMetric: null,
    definitions: {
      exactMatch: 'One valid conflict-free extraction candidate whose normalized value exactly matches the readable photo label. Raw OCR is passed to the actual extractor unchanged; precomputed predictions and numeric-presence probes are ignored.',
      normalization: 'Trim/collapse whitespace and ignore case; normalize quantity unit spelling only. No OCR digit repair, date meaning conversion, century inference or unit conversion.',
      exactMatchSamples: 'All readable reference fields in the frozen corpus for this mode. Missing rows are visible; full-corpus exactMatchRate is null if any readable reference lacks an attempted row.',
      attemptedExactMatchRate: 'Exact matches / readable fields on attempted photos, including OCR errors and empty transcripts as failures. This is a partial-run diagnostic when coverage is incomplete, not a full-corpus accuracy claim.',
      excludedFields: 'not_visible, illegible and ambiguous_field labels never count as correct negatives, errors or positives; candidates on them are diagnostics only.',
      conflict: 'Multiple distinct candidates prevent an exact match, even if one candidate matches the label.',
    },
    limitations: ['Previously used development photographs; not an unseen-product holdout or a representative field sample.', 'Photo labels are provisional AI annotations requiring independent human review.', 'Scoring supplied raw OCR outputs does not independently prove their freshness, source identity, lack of editing, or that OCR ran on the whole photograph.', 'ROI variants may use manually selected crops; do not describe them as automatic field localization.', 'No legal verdict labels, compliance accuracy, false-clear rate, measurement accuracy, or officer/cloud workflow claims are measured.'],
  }
}
