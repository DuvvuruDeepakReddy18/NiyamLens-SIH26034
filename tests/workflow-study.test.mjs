import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreWorkflowStudy } from '../src/lib/workflowStudy.mjs'
const trial = (method, extra = {}) => ({ id: method, participantId: 'P01', packageId: 'PK01', method, order: method === 'manual' ? 1 : 2, outcome: 'complete', totalSeconds: method === 'manual' ? 300 : 240, stages: { capture: 30, read_or_transcribe: 30, verify_and_correct: 30, measure: 30, export: 30 }, corrections: 2, notes: '', ...extra })
const study = trials => ({ schemaVersion: 1, kind: 'paired-inspection-time-study', trials })
const reviewed = { reviewerId: 'R01', independentPhysicalCheck: true, reportCorrect: true, notes: 'Compared the complete report with all physical package panels.' }
test('no observations or no correctness adjudication produces no time-saving claim', () => {
  assert.equal(scoreWorkflowStudy(study([])).medianVerifiedSecondsSaved, null)
  assert.equal(scoreWorkflowStudy(study([trial('manual'), trial('niyamlens')])).medianVerifiedSecondsSaved, null)
})
test('paired verified outcomes retain positive and negative time differences', () => {
  const rows = [trial('manual', { qualityReview: reviewed }), trial('niyamlens', { qualityReview: reviewed })]
  assert.equal(scoreWorkflowStudy(study(rows)).medianVerifiedSecondsSaved, 60)
  rows[1].totalSeconds = 400
  assert.equal(scoreWorkflowStudy(study(rows)).medianVerifiedSecondsSaved, -100)
})
test('failed attempts are retained and cannot be selected out as successful pairs', () => {
  const result = scoreWorkflowStudy(study([trial('manual', { qualityReview: reviewed }), trial('niyamlens', { outcome: 'failed', notes: 'Could not read tiny price stamp' })]))
  assert.equal(result.outcomes.failed, 1); assert.equal(result.validPairs.length, 0)
})
test('repeated method or self-adjudication cannot manufacture evidence', () => {
  const rows = [trial('manual', { qualityReview: reviewed }), trial('niyamlens', { qualityReview: reviewed }), trial('niyamlens', { id: 'retry', qualityReview: reviewed })]
  assert.equal(scoreWorkflowStudy(study(rows)).validPairs.length, 0)
  assert.throws(() => scoreWorkflowStudy(study([trial('manual', { qualityReview: { ...reviewed, reviewerId: 'P01' } })])), /another reviewer/)
  assert.throws(() => scoreWorkflowStudy(study([trial('manual', { totalSeconds: -2 })])), /Timing/)
})
