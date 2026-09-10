import test from 'node:test'
import assert from 'node:assert/strict'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { fieldEngineScore } from '../src/lib/inspectionInsights.mjs'
import { buildInspectionAnalysis } from '../src/lib/inspectionAnalysis.mjs'
import { flattenOcrWords } from '../src/lib/vision.mjs'

const raw = 'SOAP\nMRP Rs 40.00 (inclusive of all taxes)\nNET QTY 100 g'
const word = (text = 'MRP Rs 40.00', confidence = 94) => ({ text, lineText: text, confidence, confidenceSource: 'engine', panelId: 'p1', bbox: { x0: 0, y0: 0, x1: 90, y1: 20 }, pageWidth: 100, pageHeight: 100 })
const record = (patch = {}) => ({ text: raw, rawOcrText: raw, inspectionId: 'test-inspection', meta: { quantity: 100, unit: 'g', rule3ConsumerScope: 'retail', rule3CommodityClass: 'ordinary', rule3ApplicabilityConfirmed: true, ocrSource: 'local' }, evidenceItems: [{ id: 'p1', name: 'label.jpg', ocrPasses: [{ id: 'pass1', text: raw }], ocrWords: [word()] }], auditChain: [{ type: 'ocr_completed', at: '2026-09-10T00:00:00Z' }], ...patch })
const price = text => extractDeclarations(text || raw).byId.mrp

test('scores use retained engine values, not the parser fixed 96', () => {
  const field = price()
  assert.equal(field.confidence, 96)
  assert.equal(fieldEngineScore(field, record(), true).value, 94)
  const data = record(); data.evidenceItems[0].ocrWords.push(word('MRP Rs 40.00', 62))
  const actual = fieldEngineScore(field, data, true)
  assert.equal(actual.value, 62)
  assert.equal(actual.band, 'low')
  assert.equal(actual.observations, 2)
})
test('missing, invalid, unrecorded or legacy unknown scores remain unavailable, not zero', () => {
  for (const value of [null, undefined, NaN, Infinity, '94', -1, 101]) {
    const data = record(); data.evidenceItems[0].ocrWords[0].confidence = value
    assert.equal(fieldEngineScore(price(), data, true).value, null)
  }
  const legacy = record(); delete legacy.evidenceItems[0].ocrWords[0].confidenceSource
  assert.equal(fieldEngineScore(price(), legacy, true).value, null)
  assert.equal(fieldEngineScore(price(), record(), false).value, null)
  assert.equal(fieldEngineScore(price('MRP Rs 40\nMRP Rs 50'), record(), true).value, null)
  assert.equal(fieldEngineScore(price('MRP'), record(), true).value, null)
})
test('current corrections and other declarations cannot inherit an old OCR score', () => {
  assert.equal(fieldEngineScore(price('MRP Rs 20.00'), record(), true).value, null)
  const data = record(); data.evidenceItems[0].ocrWords = [word('NET QTY 40.00 g', 99)]
  data.evidenceItems[0].ocrPasses[0].text = 'NET QTY 40.00 g'
  assert.equal(fieldEngineScore(price(), data, true).value, null)
  assert.equal(fieldEngineScore({ ...price(), value: '40' }, record(), true).value, null, '40 is not the exact retained value 40.00')
  const unbound = record(); unbound.evidenceItems[0].ocrWords[0].panelId = 'old-panel'
  assert.equal(fieldEngineScore(price(), unbound, true).value, null)
})
test('a genuine zero engine score remains zero and unavailable source never becomes a score', () => {
  const data = record(); data.evidenceItems[0].ocrWords[0].confidence = 0
  assert.equal(fieldEngineScore(price(), data, true).value, 0)
  const blocks = [{ paragraphs: [{ lines: [{ text: 'MRP Rs 40.00', words: [{ text: '40.00', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }] }] }] }]
  assert.equal(flattenOcrWords(blocks, 'p1', 100, 100)[0].confidenceSource, 'unavailable')
  blocks[0].paragraphs[0].lines[0].words[0].confidence = 0
  assert.equal(flattenOcrWords(blocks, 'p1', 100, 100)[0].confidenceSource, 'engine')
})
test('high confidence and declaration presence do not bypass explicit human verification', () => {
  const data = record(); data.evidenceItems[0].ocrWords[0].confidence = 100
  const view = buildInspectionAnalysis(data)
  const explanation = view.insights.explanations.find(field => field.id === 'mrp')
  assert.equal(explanation.reportedScore.value, 100)
  assert.equal(explanation.decision, 'MANUAL REVIEW')
  assert.match(explanation.humanReview, /Required/)
  assert.equal(view.status, 'manual_review')
  assert.ok(explanation.relatedChecks.some(check => /6/.test(check.rule)))
})
test('why-result explanations recompute after correction and preserve the original source record', () => {
  const data = record(); data.meta.fieldReviews = { mrp: { value: '40.00', state: 'confirmed', reason: 'Explicit software fixture confirmation' } }
  const before = JSON.stringify(data)
  assert.equal(buildInspectionAnalysis(data).insights.explanations.find(field => field.id === 'mrp').decision, 'PASS')
  const edited = buildInspectionAnalysis({ ...data, text: raw.replace('40.00', '60.00') }).insights.explanations.find(field => field.id === 'mrp')
  assert.equal(edited.decision, 'MANUAL REVIEW')
  assert.equal(edited.reportedScore.value, null)
  assert.equal(JSON.stringify(data), before)
})
test('workflow stages use photos, fields, checks and recorded verdicts with explicit units', () => {
  const data = record(); const view = buildInspectionAnalysis(data)
  const stages = Object.fromEntries(view.insights.stages.map(stage => [stage.id, stage]))
  assert.equal(stages.captured.count, 1)
  assert.equal(stages.ocr.count, 1)
  assert.equal(stages.structured.count, 3)
  assert.equal(stages.validated.count, 0)
  assert.equal(stages.rules.count, view.checks.length)
  assert.equal(stages.final.count, 0)
  assert.equal(buildInspectionAnalysis(data, { saved: true }).insights.stages.at(-1).count, 1)
  assert.match(buildInspectionAnalysis(data, { saved: true }).insights.stages.at(-1).detail, /MANUAL REVIEW/)
  assert.equal(buildInspectionAnalysis(data, { saved: true, pendingPreview: true }).insights.stages.at(-1).count, 0)
  const empty = buildInspectionAnalysis()
  assert.ok(empty.insights.stages.every(stage => stage.count === 0))
})
