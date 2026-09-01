import { extractDeclarations } from './extraction.mjs'
import { evaluateCompliance } from './rules.mjs'

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
  { id: 'SYN-010', condition: 'food', text: `TURMERIC POWDER\nMRP Rs. 40 inclusive of all taxes\nNET QTY 100 g\nCONSUMER CARE: Food Helpdesk\n12 Market Road, Chennai 600001\nTelephone 1800 222 2026 · care@food.in`, meta: { ...baseMeta, category: 'food' }, expectedStatus: 'compliant', expectedFields: ['mrp', 'netQuantity', 'consumerCare', 'consumerAddress', 'phone', 'email'] },
  { id: 'SYN-011', condition: 'perishable-missing-date', text: complete, meta: { ...baseMeta, perishable: true }, expectedStatus: 'non_compliant', expectedFields: ['mrp', 'netQuantity', 'email'] },
  { id: 'SYN-012', condition: 'fast-food-exempt', text: '', meta: { ...baseMeta, commodityClass: 'fast_food' }, expectedStatus: 'manual_review', expectedFields: [] },
  { id: 'SYN-013', condition: 'pan-masala-carveout', text: 'PAN MASALA\nNET QTY 8 g', meta: { ...baseMeta, quantity: 8, unit: 'g', commodityClass: 'pan_masala' }, expectedStatus: 'non_compliant', expectedFields: ['netQuantity'] },
]

export function runBenchmark(samples = SEEDED_BENCHMARK) {
  const started = performance.now()
  let statusCorrect = 0; let tp = 0; let fp = 0; let fn = 0; let falseViolations = 0; let abstentions = 0; let valueCorrect = 0; let valueTotal = 0
  const failures = []
  for (const sample of samples) {
    const parsed = extractDeclarations(sample.text)
    const result = evaluateCompliance({ text: sample.text, meta: sample.meta || {} })
    if (result.status === sample.expectedStatus) statusCorrect += 1
    else failures.push({ id: sample.id, condition: sample.condition, expected: sample.expectedStatus, actual: result.status })
    if (result.status === 'manual_review') abstentions += 1
    if (result.status === 'non_compliant' && sample.expectedStatus !== 'non_compliant') falseViolations += 1
    const actualFields = new Set(parsed.fields.filter((field) => field.detected).map((field) => field.id))
    const expectedFields = new Set(sample.expectedFields || [])
    actualFields.forEach((id) => { if (expectedFields.has(id)) tp += 1; else fp += 1 })
    expectedFields.forEach((id) => { if (!actualFields.has(id)) fn += 1 })
    Object.entries(sample.expectedValues || {}).forEach(([id, expected]) => {
      valueTotal += 1
      const actual = parsed.byId[id]?.value ?? ''
      const normalize = (value) => String(value).toLocaleLowerCase('en-IN').replace(/\s+/g, ' ').trim()
      if (normalize(actual) === normalize(expected)) valueCorrect += 1
    })
  }
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  return {
    sampleCount: samples.length,
    statusAccuracy: samples.length ? statusCorrect / samples.length : 0,
    precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    valueAccuracy: valueTotal ? valueCorrect / valueTotal : null,
    valueSamples: valueTotal,
    falseViolationRate: samples.length ? falseViolations / samples.length : 0,
    abstentionRate: samples.length ? abstentions / samples.length : 0,
    elapsedMs: performance.now() - started,
    failures,
    datasetKind: samples === SEEDED_BENCHMARK ? 'synthetic-regression' : 'imported',
  }
}

function parseCsvRows(text) {
  const rows = []
  let row = []; let value = ''; let quoted = false
  const source = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted && char === '"' && source[index + 1] === '"') { value += '"'; index += 1 }
    else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) { row.push(value); value = '' }
    else if (char === '\n' && !quoted) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); row = []; value = '' }
    else value += char
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  row.push(value)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

export function parseBenchmarkFile(text, fileName = '') {
  if (/\.json$/i.test(fileName) || String(text).trim().startsWith('[')) {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('Benchmark JSON must be an array.')
    return parsed
  }
  const [headerRow, ...rows] = parseCsvRows(text)
  if (!headerRow?.length) throw new Error('Benchmark CSV is empty.')
  const headers = headerRow.map((value) => value.trim())
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}. Quote fields that contain commas.`)
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]?.trim() || '']))
    return { id: record.id || `IMPORT-${index + 1}`, condition: record.condition || 'imported', text: record.text || '', expectedStatus: record.expectedStatus || 'manual_review', expectedFields: (record.expectedFields || '').split('|').filter(Boolean), expectedValues: JSON.parse(record.expectedValues || '{}'), meta: JSON.parse(record.meta || '{}') }
  })
}
