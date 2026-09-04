import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBenchmarkFile, runBenchmark, validateBenchmarkSamples, SEEDED_BENCHMARK, BENCHMARK_LIMITS } from '../src/lib/benchmark.mjs'
import { evaluateCompliance } from '../src/lib/rules.mjs'
import { RULE_EDGE_CASES } from '../src/lib/ruleMatrix.mjs'

test('seeded benchmark executes without invented field metrics', () => {
  const result = runBenchmark(SEEDED_BENCHMARK)
  assert.equal(result.sampleCount, SEEDED_BENCHMARK.length)
  assert.ok(result.precision >= 0 && result.precision <= 1)
  assert.ok(result.recall >= 0 && result.recall <= 1)
  assert.equal(result.datasetKind, 'synthetic-regression')
})

test('CSV benchmark import preserves quoted commas, JSON metadata and labelled values', () => {
  const csv = 'id,condition,text,expectedStatus,expectedFields,expectedValues,meta\n"C-1","comma","MRP Rs. 40, inclusive of all taxes","manual_review","mrp","{""mrp"":""40""}","{""category"":""general"",""ocrConfidence"":50}"'
  const [sample] = parseBenchmarkFile(csv, 'fixtures.csv')
  assert.equal(sample.text, 'MRP Rs. 40, inclusive of all taxes')
  assert.deepEqual(sample.meta, { category: 'general', ocrConfidence: 50 })
  assert.deepEqual(sample.expectedValues, { mrp: '40' })
})

test('missing ground truth remains unlabelled instead of inventing review, presence or value labels', () => {
  for (const samples of [parseBenchmarkFile('[{"text":"MRP Rs. 40.00"}]', 'data.json'), parseBenchmarkFile('text,expectedStatus,expectedFields,expectedValues\nMRP Rs. 40.00,,,', 'data.csv')]) {
    assert.equal(samples[0].expectedStatus, null)
    assert.equal(samples[0].expectedFields, null)
    const metrics = runBenchmark(samples)
    assert.equal(metrics.sampleCount, 1)
    assert.equal(metrics.statusSamples, 0)
    assert.equal(metrics.unlabelledStatusSamples, 1)
    for (const key of ['statusAccuracy', 'precision', 'recall', 'f1', 'valueAccuracy', 'falseClearRate', 'falseViolationRate']) assert.equal(metrics[key], null, key)
    assert.equal(metrics.failures.length, 0)
    assert.equal(metrics.groundTruthStatus, 'unlabelled')
    assert.equal(metrics.sampleResults[0].statusCorrect, null)
    assert.equal(metrics.sampleResults[0].fields.find((field) => field.id === 'mrp').correct, null)
    assert.equal(metrics.perField.mrp.exactMatchRate, null)
    assert.equal(metrics.abstentionRate, 1)
  }
})

test('per-field normalised exact-match metrics use labelled values, preserve mismatches and do not dilute denominators', () => {
  const metrics = runBenchmark([
    { id: 'a', text: 'MRP Rs. 40.00\nNET QTY 100 g', expectedValues: { mrp: '40.00', netQuantity: ' 100  G ' } },
    { id: 'b', text: 'MRP Rs. 20', expectedValues: { mrp: '21', phone: null } },
    { id: 'c', text: 'MRP Rs. 40', expectedValues: { mrp: null } },
  ])
  assert.equal(metrics.valueCorrect, 2)
  assert.equal(metrics.valueSamples, 3)
  assert.equal(metrics.valueAccuracy, 2 / 3)
  assert.deepEqual(metrics.perField.mrp, { label: 'Maximum Retail Price', exactMatchCorrect: 1, exactMatchSamples: 2, exactMatchRate: 0.5 })
  assert.equal(metrics.perField.netQuantity.exactMatchSamples, 1)
  assert.equal(metrics.perField.netQuantity.exactMatchRate, 1)
  assert.equal(metrics.perField.phone.exactMatchSamples, 0)
  assert.equal(metrics.perField.phone.exactMatchRate, null)
  const mismatch = metrics.sampleResults[1].fields.find((field) => field.id === 'mrp')
  assert.equal(mismatch.expected, '21')
  assert.equal(mismatch.actual, '20')
  assert.equal(mismatch.correct, false)
  assert.match(metrics.definitions.valueAccuracy, /without numeric or date coercion/)
})

test('verdict accuracy, unsafe clears and unsupported flags expose their eligible ground-truth denominators', () => {
  const clear = SEEDED_BENCHMARK[0]
  const violation = SEEDED_BENCHMARK[1]
  const review = SEEDED_BENCHMARK[2]
  const exempt = SEEDED_BENCHMARK[3]
  const metrics = runBenchmark([
    { ...clear, id: 'unsafe-clear', expectedStatus: 'non_compliant' },
    { ...exempt, id: 'unsafe-exemption', expectedStatus: 'manual_review' },
    { ...violation, id: 'unsupported-flag', expectedStatus: 'compliant' },
    { ...review, id: 'correct-review', expectedStatus: 'manual_review' },
    { ...clear, id: 'unlabelled-clear', expectedStatus: null },
    { ...violation, id: 'unlabelled-flag', expectedStatus: null },
  ])
  assert.equal(metrics.statusSamples, 4)
  assert.equal(metrics.statusCorrect, 1)
  assert.equal(metrics.statusAccuracy, 0.25)
  assert.equal(metrics.falseClears, 2)
  assert.equal(metrics.falseClearSamples, 3)
  assert.equal(metrics.falseClearRate, 2 / 3)
  assert.equal(metrics.falseViolations, 1)
  assert.equal(metrics.falseViolationSamples, 3)
  assert.equal(metrics.falseViolationRate, 1 / 3)
  assert.equal(metrics.failures.length, 3)
  assert.equal(metrics.sampleResults[4].falseClear, null)
  assert.equal(metrics.sampleResults[5].falseViolation, null)
})

test('presence labels may be absent, but an explicit empty set is a labelled absence set', () => {
  const onlyLabelled = runBenchmark([{ id: 'a', text: 'MRP Rs. 40', expectedFields: ['mrp'] }])
  const partial = runBenchmark([{ id: 'a', text: 'MRP Rs. 40', expectedFields: ['mrp'] }, { id: 'b', text: 'NET QTY 100 g' }])
  assert.equal(partial.presenceSamples, 1)
  assert.deepEqual(partial.presenceCounts, onlyLabelled.presenceCounts)
  assert.equal(partial.f1, onlyLabelled.f1)
  const explicit = runBenchmark([{ text: 'MRP Rs. 40', expectedFields: [] }])
  assert.equal(explicit.presenceSamples, 1)
  assert.equal(explicit.presenceCounts.falsePositive, 1)
  assert.equal(explicit.precision, 0)
  assert.equal(explicit.recall, null)
  assert.equal(explicit.f1, 0)
})

test('JSON import validates row, field, verdict and metadata shapes before the UI accepts samples', () => {
  const variants = [
    '{}', '[null]', '[7]', '[[]]', '[{"text":null}]', '[{"text":{}}]',
    '[{"text":"x","meta":[]}]', '[{"text":"x","expectedValues":[]}]',
    '[{"text":"x","expectedValues":{"mrp":{}}}]', '[{"text":"x","expectedValues":{"unknown":"value"}}]',
    '[{"text":"x","expectedFields":"mrp"}]', '[{"text":"x","expectedFields":[null]}]',
    '[{"text":"x","expectedFields":["mrp","mrp"]}]', '[{"text":"x","expectedStatus":"winner"}]',
    '[{"id":"same","text":"x"},{"id":"same","text":"y"}]',
    '[{"text":"x","meta":{"ocrConfidence":999}}]', '[{"text":"x","meta":{"__proto__":{}}}]',
  ]
  for (const manifest of variants) assert.throws(() => parseBenchmarkFile(manifest, 'unsafe.json'), Error, manifest)
  assert.throws(() => parseBenchmarkFile('[', 'broken.json'), /invalid JSON/)
  assert.throws(() => runBenchmark([null]), /must be an object/)
  assert.throws(() => runBenchmark(Array(1)), /missing entries/)
})

test('CSV import rejects malformed quoting, duplicate or missing headers and malformed cell JSON', () => {
  for (const csv of [
    'id,id,text\na,b,x', 'id,unknown\na,x',
    'text,meta\nx,[]', 'text,expectedValues\nx,{oops}',
    'text,expectedFields\nx,unknown', 'text\n"x"junk', 'text\nx"y"', 'text\n"unfinished',
    'text,meta\nx,{},extra',
  ]) assert.throws(() => parseBenchmarkFile(csv, 'bad.csv'), Error, csv)
  const [sample] = parseBenchmarkFile('\uFEFFtext,expectedFields,meta\n"MRP Rs. 40\nNET QTY 100 g",[],{}', 'good.csv')
  assert.equal(sample.text, 'MRP Rs. 40\nNET QTY 100 g')
  assert.deepEqual(sample.expectedFields, [])
})

test('manifest execution is bounded and rejects cyclic, nonfinite and accessor metadata without evaluating getters', () => {
  assert.throws(() => parseBenchmarkFile('x'.repeat(BENCHMARK_LIMITS.fileCharacters + 1), 'big.csv'), /5,000,000/)
  assert.throws(() => runBenchmark(Array.from({ length: BENCHMARK_LIMITS.samples + 1 }, (_, index) => ({ id: String(index), text: '' }))), /at most 500/)
  assert.throws(() => runBenchmark([{ text: 'a'.repeat(100001) }]), /oversized/)
  assert.throws(() => runBenchmark(Array.from({ length: 21 }, (_, index) => ({ id: String(index), text: 'a'.repeat(100000) }))), /transcript total/)
  const cycle = {}; cycle.loop = cycle
  assert.throws(() => validateBenchmarkSamples([{ text: '', meta: cycle }]), /circular/)
  assert.throws(() => runBenchmark([{ text: '', meta: { quantity: Infinity } }]), /finite JSON/)
  let evaluated = false
  assert.throws(() => runBenchmark([{ text: '', meta: { get quantity() { evaluated = true; return 100 } } }]), /invalid metadata key/)
  assert.equal(evaluated, false)
})

test('empty datasets and user-asserted real/holdout metadata never invent metrics or dataset authenticity', () => {
  const empty = runBenchmark([])
  for (const key of ['statusAccuracy', 'valueAccuracy', 'precision', 'recall', 'f1', 'falseClearRate', 'falseViolationRate', 'abstentionRate']) assert.equal(empty[key], null)
  const metrics = runBenchmark([{ text: 'MRP Rs. 40', datasetKind: 'real-held-out', holdout: true }])
  assert.equal(metrics.datasetKind, 'imported')
  assert.equal(metrics.groundTruthStatus, 'unlabelled')
  assert.match(metrics.evaluationScope, /OCR is not executed/)
  assert.ok(metrics.limitations.some((message) => /holdout/.test(message)))
})

for (const edgeCase of RULE_EDGE_CASES) {
  test(`rule edge case: ${edgeCase.title}`, () => {
    const result = evaluateCompliance({ text: edgeCase.text, meta: edgeCase.meta })
    assert.equal(result.status, edgeCase.expectedStatus)
  })
}
