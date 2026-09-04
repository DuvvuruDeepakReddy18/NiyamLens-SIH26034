import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateCriticalFieldManifest, scoreCriticalFields } from '../src/lib/criticalFieldBenchmark.mjs'

test('the six-photo checkset remains product-code-disjoint and cannot claim positive accuracy', async () => {
  const source = JSON.parse(await readFile(new URL('../datasets/critical-fields.v1.json', import.meta.url), 'utf8'))
  const checkset = JSON.parse(await readFile(new URL('../datasets/critical-fields.checkset.v1.json', import.meta.url), 'utf8'))
  validateCriticalFieldManifest(source); validateCriticalFieldManifest(checkset)
  const excluded = new Set(source.samples.map(sample => sample.productCode))
  assert.equal(checkset.samples.length, 6)
  assert.equal(new Set(checkset.samples.map(sample => sample.productCode)).size, 6)
  assert.ok(checkset.samples.every(sample => !excluded.has(sample.productCode)))
  assert.equal(checkset.positiveRecognitionEvaluationReady, false)
  assert.equal(checkset.isHoldout, false)
  assert.equal(checkset.annotation.humanReviewed, false)
  const raw = checkset.samples.map(sample => ({ sampleId: sample.id, mode: 'synthetic-empty-contract-only', rawText: '' }))
  const result = scoreCriticalFields(checkset, raw).runs[0]
  assert.equal(result.exactMatchSamples, 0)
  assert.equal(result.exactMatchRate, null)
})
