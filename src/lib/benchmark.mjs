import { extractDeclarations } from './extraction.mjs'
import { evaluateCompliance } from './rules.mjs'
import { MAX_LABEL_TEXT } from './labelParser.mjs'
import { validateInspectionMetadata } from './inspectionMetadata.mjs'

const consumerBlock = `CONSUMER CARE: Example Foods Consumer Cell
12 Market Road, Chennai 600001
Telephone: 1800 111 2026 · care@example.in`

const complete = `GENERIC NAME: TEST PRODUCT
MRP Rs. 40.00 inclusive of all taxes
NET QTY 100 g
PACKED 08/2026
MANUFACTURED BY: EXAMPLE FOODS, CHENNAI 600001
${consumerBlock}
UNIT SALE PRICE Rs. 0.40/g`

const baseMeta = { productName: 'Test product', category: 'general', commodityClass: 'standard', quantity: 100, unit: 'g', pdpArea: 75, pdpUncertainty: 2, referenceMm: 20, referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5, measurementUncertainty: 3, ocrConfidence: 95 }

export const SEEDED_BENCHMARK = [
  { id: 'SYN-001', condition: 'clean', text: complete, meta: baseMeta, expectedStatus: 'compliant', expectedFields: ['mrp', 'netQuantity', 'packDate', 'responsibleEntity', 'consumerCare', 'consumerAddress', 'email', 'phone', 'unitSalePrice'], expectedValues: { mrp: '40.00', netQuantity: '100 g', packDate: '08/2026' } },
  { id: 'SYN-002', condition: 'missing-care', text: complete.replace(consumerBlock, ''), meta: baseMeta, expectedStatus: 'non_compliant', expectedFields: ['mrp', 'netQuantity', 'packDate', 'responsibleEntity', 'unitSalePrice'] },
  { id: 'SYN-003', condition: 'low-confidence', text: 'MRP Rs. 40.00', meta: { ...baseMeta, ocrConfidence: 42 }, expectedStatus: 'manual_review', expectedFields: ['mrp'] },
  { id: 'SYN-004', condition: 'small-exempt', text: 'NET QTY 8 ml', meta: { ...baseMeta, quantity: 8, unit: 'ml' }, expectedStatus: 'exempt', expectedFields: ['netQuantity'] },
  { id: 'SYN-005', condition: 'tobacco-carveout', text: 'TOBACCO PRODUCT\nNET QTY 8 g', meta: { ...baseMeta, quantity: 8, unit: 'g', commodityClass: 'tobacco' }, expectedStatus: 'non_compliant', expectedFields: ['netQuantity'] },
  { id: 'SYN-006', condition: 'import-origin', text: `${complete}\nCOUNTRY OF ORIGIN: INDIA`, meta: { ...baseMeta, category: 'imported' }, expectedStatus: 'compliant', expectedFields: ['mrp', 'netQuantity', 'countryOrigin', 'email'] },
  { id: 'SYN-007', condition: 'import-missing-origin', text: complete, meta: { ...baseMeta, category: 'imported' }, expectedStatus: 'non_compliant', expectedFields: ['mrp', 'netQuantity', 'email'] },
  { id: 'SYN-008', condition: 'font-fail', text: complete, meta: { ...baseMeta, glyphPx: 5 }, expectedStatus: 'non_compliant', expectedFields: ['mrp', 'netQuantity', 'email'] },
  { id: 'SYN-009', condition: 'tier-boundary', text: complete, meta: { ...baseMeta, pdpArea: 99, pdpUncertainty: 5 }, expectedStatus: 'manual_review', expectedFields: ['mrp', 'netQuantity', 'email'] },
  { id: 'SYN-010', condition: 'food', text: `GENERIC NAME: TURMERIC POWDER\nMRP Rs. 40 inclusive of all taxes\nNET QTY 100 g\nPACKED 08/2026\nMANUFACTURED BY: EXAMPLE FOODS, CHENNAI\nCONSUMER CARE: Food Helpdesk\n12 Market Road, Chennai 600001\nTelephone 1800 222 2026 · care@food.in\nUNIT SALE PRICE Rs. 0.40/g`, meta: { ...baseMeta, category: 'food' }, expectedStatus: 'compliant', expectedFields: ['mrp', 'netQuantity', 'packDate', 'responsibleEntity', 'consumerCare', 'consumerAddress', 'phone', 'email', 'unitSalePrice'] },
  { id: 'SYN-011', condition: 'perishable-missing-date', text: complete, meta: { ...baseMeta, perishable: true }, expectedStatus: 'non_compliant', expectedFields: ['mrp', 'netQuantity', 'email'] },
  { id: 'SYN-012', condition: 'fast-food-exempt', text: '', meta: { ...baseMeta, commodityClass: 'fast_food' }, expectedStatus: 'manual_review', expectedFields: [] },
  { id: 'SYN-013', condition: 'pan-masala-carveout', text: 'PAN MASALA\nNET QTY 8 g', meta: { ...baseMeta, quantity: 8, unit: 'g', commodityClass: 'pan_masala' }, expectedStatus: 'non_compliant', expectedFields: ['netQuantity'] },
]

export const BENCHMARK_LIMITS = Object.freeze({ samples: 500, fileCharacters: 5_000_000, totalTextCharacters: 2_000_000, fieldValueCharacters: 2000, nesting: 12, nodes: 100_000 })
const STATUSES = ['compliant', 'non_compliant', 'manual_review', 'exempt']
const CLEAR_STATUSES = new Set(['compliant', 'exempt'])
const FIELD_DEFINITIONS = extractDeclarations('').fields.map(({ id, label }) => ({ id, label }))
const FIELD_IDS = new Set(FIELD_DEFINITIONS.map(({ id }) => id))
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const normalizeValue = (value) => value.toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim()
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null

// Validate direct callers as well as JSON imports. The path/depth bounds also
// prevent deeply nested metadata or cyclic hand-built manifests from reaching
// extraction. Never infer a ground-truth label from an actual prediction.
export function validateBenchmarkSamples(samples) {
  if (!Array.isArray(samples)) throw new Error('Benchmark JSON must be an array of sample objects.')
  if (samples.length > BENCHMARK_LIMITS.samples) throw new Error(`Benchmark supports at most ${BENCHMARK_LIMITS.samples} samples per run.`)
  let nodes = 0; let characters = 0
  const ancestors = new Set()
  const visit = (value, depth = 0) => {
    if (++nodes > BENCHMARK_LIMITS.nodes || depth > BENCHMARK_LIMITS.nesting) throw new Error('Benchmark metadata is too complex or deeply nested.')
    if (typeof value === 'string') {
      characters += value.length
      if (value.length > MAX_LABEL_TEXT || characters > BENCHMARK_LIMITS.fileCharacters) throw new Error('Benchmark contains oversized text or metadata.')
      return
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
    if (!Array.isArray(value) && !plainObject(value)) throw new Error('Benchmark samples must contain only finite JSON values and plain objects.')
    if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new Error('Benchmark arrays must not contain missing entries or extra properties.')
    if (ancestors.has(value)) throw new Error('Benchmark metadata must not contain circular references.')
    ancestors.add(value)
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue
      if (RESERVED_KEYS.has(key) || key.length > 200 || !Object.hasOwn(descriptor, 'value')) throw new Error('Benchmark contains an unsafe or invalid metadata key.')
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(samples)
  const seen = new Set(); let textCharacters = 0
  return samples.map((sample, index) => {
    const at = `Sample ${index + 1}`
    if (!plainObject(sample)) throw new Error(`${at} must be an object.`)
    const id = sample.id ?? `IMPORT-${index + 1}`
    if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error(`${at} requires a nonempty text ID no longer than 200 characters.`)
    if (seen.has(id.trim())) throw new Error(`${at} has a duplicate sample ID.`)
    seen.add(id.trim())
    if (typeof sample.text !== 'string' || sample.text.length > MAX_LABEL_TEXT) throw new Error(`${at}.text must be a string no longer than ${MAX_LABEL_TEXT} characters.`)
    textCharacters += sample.text.length
    if (textCharacters > BENCHMARK_LIMITS.totalTextCharacters) throw new Error('Benchmark transcript total exceeds the 2,000,000-character run limit.')
    if (sample.condition !== undefined && (typeof sample.condition !== 'string' || sample.condition.length > 200)) throw new Error(`${at}.condition must be text no longer than 200 characters.`)
    const expectedStatus = sample.expectedStatus ?? null
    if (expectedStatus !== null && !STATUSES.includes(expectedStatus)) throw new Error(`${at}.expectedStatus must be a supported verdict or null for unlabelled data.`)
    const expectedFields = sample.expectedFields ?? null
    if (expectedFields !== null && (!Array.isArray(expectedFields) || expectedFields.length > FIELD_IDS.size || expectedFields.some((id) => typeof id !== 'string' || !FIELD_IDS.has(id)) || new Set(expectedFields).size !== expectedFields.length)) throw new Error(`${at}.expectedFields must be unique known field IDs, or null when the complete presence labels are unavailable.`)
    const expectedValues = sample.expectedValues ?? {}
    if (!plainObject(expectedValues) || Object.keys(expectedValues).some((id) => !FIELD_IDS.has(id))) throw new Error(`${at}.expectedValues must be an object keyed by known field IDs.`)
    for (const value of Object.values(expectedValues)) if (value !== null && (typeof value !== 'string' || value.length > BENCHMARK_LIMITS.fieldValueCharacters)) throw new Error(`${at}.expectedValues must contain strings no longer than 2000 characters, or null for unlabelled fields.`)
    const meta = sample.meta ?? {}
    if (!plainObject(meta)) throw new Error(`${at}.meta must be an object.`)
    const issues = validateInspectionMetadata(meta)
    if (issues.length) throw new Error(`${at}.meta is invalid: ${issues[0].field}: ${issues[0].reason}`)
    return { ...sample, id: id.trim(), condition: sample.condition || 'imported', text: sample.text, expectedStatus, expectedFields, expectedValues, meta }
  })
}

export function runBenchmark(samples = SEEDED_BENCHMARK) {
  const started = performance.now()
  const validated = validateBenchmarkSamples(samples)
  let statusCorrect = 0; let statusSamples = 0; let tp = 0; let fp = 0; let fn = 0; let presenceSamples = 0
  let falseViolations = 0; let falseViolationSamples = 0; let falseClears = 0; let falseClearSamples = 0
  let abstentions = 0; let valueCorrect = 0; let valueTotal = 0
  const failures = []; const sampleResults = []
  const perField = Object.fromEntries(FIELD_DEFINITIONS.map(({ id, label }) => [id, { label, exactMatchCorrect: 0, exactMatchSamples: 0, exactMatchRate: null }]))
  for (const sample of validated) {
    const parsed = extractDeclarations(sample.text)
    const result = evaluateCompliance({ text: sample.text, meta: sample.meta })
    const statusLabelled = sample.expectedStatus !== null
    let falseClear = null; let falseViolation = null
    if (statusLabelled) {
      statusSamples += 1
      if (result.status === sample.expectedStatus) statusCorrect += 1
      else failures.push({ id: sample.id, condition: sample.condition, expected: sample.expectedStatus, actual: result.status })
      if (!CLEAR_STATUSES.has(sample.expectedStatus)) { falseClearSamples += 1; falseClear = CLEAR_STATUSES.has(result.status); if (falseClear) falseClears += 1 }
      if (sample.expectedStatus !== 'non_compliant') { falseViolationSamples += 1; falseViolation = result.status === 'non_compliant'; if (falseViolation) falseViolations += 1 }
    }
    if (result.status === 'manual_review') abstentions += 1
    if (sample.expectedFields !== null) {
      presenceSamples += 1
      const actualFields = new Set(parsed.fields.filter((field) => field.detected).map((field) => field.id))
      const expectedFields = new Set(sample.expectedFields)
      actualFields.forEach((id) => { if (expectedFields.has(id)) tp += 1; else fp += 1 })
      expectedFields.forEach((id) => { if (!actualFields.has(id)) fn += 1 })
    }
    const fields = FIELD_DEFINITIONS.map(({ id }) => {
      const expected = sample.expectedValues[id] ?? null
      const actual = parsed.byId[id]?.value ?? ''
      const correct = expected === null ? null : normalizeValue(actual) === normalizeValue(expected)
      if (expected !== null) {
        valueTotal += 1; perField[id].exactMatchSamples += 1
        if (correct) { valueCorrect += 1; perField[id].exactMatchCorrect += 1 }
      }
      return { id, expected, actual, labelled: expected !== null, correct, validation: parsed.byId[id]?.validation?.status || null, conflict: parsed.byId[id]?.conflict === true }
    })
    sampleResults.push({ id: sample.id, condition: sample.condition, expectedStatus: sample.expectedStatus, actualStatus: result.status, statusLabelled, statusCorrect: statusLabelled ? result.status === sample.expectedStatus : null, falseClear, falseViolation, presenceLabelled: sample.expectedFields !== null, fields })
  }
  for (const field of Object.values(perField)) field.exactMatchRate = ratio(field.exactMatchCorrect, field.exactMatchSamples)
  const precision = ratio(tp, tp + fp); const recall = ratio(tp, tp + fn)
  return {
    sampleCount: validated.length, statusSamples, statusCorrect, unlabelledStatusSamples: validated.length - statusSamples,
    statusAccuracy: ratio(statusCorrect, statusSamples),
    presenceSamples, presenceCounts: { truePositive: tp, falsePositive: fp, falseNegative: fn },
    precision, recall, f1: ratio(2 * tp, 2 * tp + fp + fn),
    valueAccuracy: ratio(valueCorrect, valueTotal), valueSamples: valueTotal, valueCorrect, perField,
    falseClearRate: ratio(falseClears, falseClearSamples), falseClears, falseClearSamples,
    falseViolationRate: ratio(falseViolations, falseViolationSamples), falseViolations, falseViolationSamples,
    abstentionRate: ratio(abstentions, validated.length), abstentions,
    elapsedMs: performance.now() - started, failures, sampleResults,
    datasetKind: samples === SEEDED_BENCHMARK ? 'synthetic-regression' : 'imported',
    evaluationScope: 'Supplied transcript extraction and deterministic rules; OCR is not executed by this benchmark.',
    groundTruthStatus: statusSamples || presenceSamples || valueTotal ? 'labels-supplied-unverified' : 'unlabelled',
    definitions: {
      statusAccuracy: 'Correct verdicts / samples with an expectedStatus label.',
      presence: 'Micro-averaged presence counts only on samples whose expectedFields is an explicitly supplied exhaustive field set; omit or null partial labels.',
      valueAccuracy: 'Micro-averaged normalised exact match over supplied non-null expectedValues; trim, collapse whitespace and ignore case, without numeric or date coercion.',
      falseClearRate: 'Predicted compliant/exempt / samples labelled non_compliant or manual_review. This includes unsafe dismissal of a required review.',
      falseViolationRate: 'Predicted non_compliant / samples labelled compliant, exempt or manual_review. This includes unsupported decisive flags on required-review examples.',
      abstentionRate: 'Predicted manual_review / all evaluated samples; no ground-truth label is required for this operational rate.',
    },
    limitations: ['Imported labels are user-supplied, not independently adjudicated.', 'No real-world accuracy, unbiased sampling or unseen-product holdout is established by importing a manifest.', 'Presence labels must be exhaustive; value labels may be partial. Missing labels never count as errors or successes.', 'This transcript-only benchmark does not measure image OCR, physical typography, officer workflow or cloud operation.'],
  }
}

function parseCsvRows(text) {
  const rows = []
  let row = []; let value = ''; let quoted = false; let afterQuote = false
  const source = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const finishRow = () => {
    row.push(value)
    if (row.some((cell) => cell.trim())) rows.push(row)
    if (rows.length > BENCHMARK_LIMITS.samples + 1) throw new Error(`Benchmark supports at most ${BENCHMARK_LIMITS.samples} samples per run.`)
    row = []; value = ''; afterQuote = false
  }
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted && char === '"' && source[index + 1] === '"') { value += '"'; index += 1 }
    else if (quoted && char === '"') { quoted = false; afterQuote = true }
    else if (char === ',' && !quoted) { row.push(value); value = ''; afterQuote = false }
    else if (char === '\n' && !quoted) finishRow()
    else if (afterQuote && /[ \t]/.test(char)) continue
    else if (afterQuote) throw new Error('CSV has unexpected content after a closing quote.')
    else if (char === '"' && !quoted) {
      if (value.trim()) throw new Error('CSV quotes must begin at the start of a field.')
      value = ''; quoted = true
    }
    else value += char
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  finishRow()
  return rows
}

export function parseBenchmarkFile(text, fileName = '') {
  if (typeof text !== 'string' || text.length > BENCHMARK_LIMITS.fileCharacters) throw new Error('Benchmark file must contain at most 5,000,000 text characters.')
  const source = text.replace(/^\uFEFF/, '')
  const json = (value, context) => { try { return JSON.parse(value) } catch { throw new Error(`${context} contains invalid JSON.`) } }
  if (/\.json$/i.test(fileName) || /^[\[{]/.test(source.trim())) {
    return validateBenchmarkSamples(json(source, 'Benchmark file'))
  }
  const [headerRow, ...rows] = parseCsvRows(source)
  if (!headerRow?.length) throw new Error('Benchmark CSV is empty.')
  const headers = headerRow.map((value) => value.trim())
  const allowed = new Set(['id', 'condition', 'text', 'expectedStatus', 'expectedFields', 'expectedValues', 'meta'])
  if (!headers.includes('text') || headers.some((header) => !allowed.has(header)) || new Set(headers).size !== headers.length) throw new Error('CSV requires a text column and unique supported headers: id, condition, text, expectedStatus, expectedFields, expectedValues, meta.')
  return validateBenchmarkSamples(rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}. Quote fields that contain commas.`)
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() || '']))
    const expectedFields = !record.expectedFields ? null : record.expectedFields.startsWith('[') ? json(record.expectedFields, `CSV row ${index + 2} expectedFields`) : record.expectedFields.split('|').map((field) => field.trim()).filter(Boolean)
    return { id: record.id || `IMPORT-${index + 1}`, condition: record.condition || 'imported', text: record.text || '', expectedStatus: record.expectedStatus || null, expectedFields, expectedValues: json(record.expectedValues || '{}', `CSV row ${index + 2} expectedValues`), meta: json(record.meta || '{}', `CSV row ${index + 2} meta`) }
  }))
}
