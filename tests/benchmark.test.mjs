import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBenchmarkFile, runBenchmark, SEEDED_BENCHMARK } from '../src/lib/benchmark.mjs'
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

for (const edgeCase of RULE_EDGE_CASES) {
  test(`rule edge case: ${edgeCase.title}`, () => {
    const result = evaluateCompliance({ text: edgeCase.text, meta: edgeCase.meta })
    assert.equal(result.status, edgeCase.expectedStatus)
  })
}
