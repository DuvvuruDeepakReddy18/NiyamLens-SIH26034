import test from 'node:test'
import assert from 'node:assert/strict'
import { buildInspectionAnalysis, declarationState, EVIDENCE_STATES } from '../src/lib/inspectionAnalysis.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const label = 'SOAP\nMRP Rs 40.00\nNET QTY 100 g\nPACKED 08/2026'
const record = (patch = {}) => ({ inspectionId: 'current-only', evidenceItems: [{ id: 'p1', name: 'soap.jpg', panelRole: 'price_date', analysisUrl: 'photo:soap', ocrPasses: [{ text: label }], quality: { score: 70 } }], text: label, meta: {}, ...patch })

test('empty inspection has no invented chart denominator, product pass or rule history', () => {
  const view = buildInspectionAnalysis()
  assert.equal(view.hasEvidence, false)
  assert.equal(view.fields.length, 0)
  assert.equal(view.checks.length, 0)
  assert.equal(view.status, 'empty')
  assert.ok(view.distribution.every(row => row.count === 0))
  assert.equal(buildInspectionAnalysis({ text: label }).fields.length, 0, 'text alone is not a photographed inspection')
})
test('distribution counts each tracked field exactly once and never calls OCR verified', () => {
  const view = buildInspectionAnalysis(record())
  assert.equal(view.fields.length, 14)
  assert.equal(view.distribution.reduce((sum, row) => sum + row.count, 0), 14)
  assert.equal(view.verified, 0)
  assert.equal(view.status, 'manual_review')
  assert.equal(view.fields.find(field => field.id === 'mrp').status, 'detected')
  assert.equal(new Set(EVIDENCE_STATES.map(row => row.color)).size, 6)
})
test('confirmed reading requires matching current value and note; changed value is not verified', () => {
  const meta = { fieldReviews: { mrp: { value: '40.00', state: 'confirmed', reason: 'Test fixture: checked price.' } } }
  const current = buildInspectionAnalysis(record({ meta }))
  assert.equal(current.verified, 1)
  assert.equal(buildInspectionAnalysis(record({ meta, text: label.replace('40.00', '50.00') })).verified, 0)
})
test('missing is not absence; physical absence needs all-panels confirmation and a reason', () => {
  const field = extractDeclarations('').byId.mrp
  assert.equal(declarationState(field), 'missing')
  const meta = { fieldReviews: { mrp: { state: 'absent', value: '', reason: 'All physical surfaces inspected in test fixture.' } } }
  assert.equal(declarationState(field, meta), 'missing')
  assert.equal(declarationState(field, { ...meta, allPanelsCaptured: true }), 'absent')
})
test('conflict, incomplete, unreadable and uncaptured states are distinct from a product violation', () => {
  const conflict = buildInspectionAnalysis(record({ text: 'MRP Rs 40\nMRP Rs 50' }))
  assert.equal(conflict.fields.find(field => field.id === 'mrp').status, 'conflict')
  assert.equal(declarationState(extractDeclarations('NET QTY 0 g').byId.netQuantity), 'unreadable')
  const field = extractDeclarations(label).byId.mrp
  assert.equal(declarationState(field, { fieldReviews: { mrp: { value: field.value, state: 'unreadable' } } }), 'unreadable')
  assert.equal(declarationState(field, { fieldReviews: { mrp: { value: field.value, state: 'not_captured' } } }), 'missing')
})
test('invalid barcode cannot be charted as officer verified', () => {
  const field = extractDeclarations('BARCODE 1234567890123').byId.barcode
  assert.equal(declarationState(field, { fieldReviews: { barcode: { value: field.value, state: 'confirmed', reason: 'Fixture' } } }), 'unreadable')
})
test('current selected field may be verified while historical disagreement remains visible', () => {
  const view = buildInspectionAnalysis(record({ meta: { fieldCandidates: { mrp: [{ value: '40' }, { value: '50' }] }, fieldReviews: { mrp: { value: '40.00', state: 'confirmed', reason: 'Explicitly chose current reading after reviewing raw history.' } } } }))
  const field = view.fields.find(field => field.id === 'mrp')
  assert.equal(field.status, 'verified')
  assert.equal(field.historicalDisagreement, true)
})
test('panel coverage, source bars and rule distributions have explicit current-case denominators', () => {
  const view = buildInspectionAnalysis(record({ ocrWords: [{ panelId: 'p1', lineText: 'MRP Rs 40.00', text: 'MRP Rs 40.00', confidence: 80, bbox: { x0: 0, y0: 0, x1: 100, y1: 20 }, pageWidth: 200, pageHeight: 200 }] }))
  assert.equal(view.panels[0].passes, 1)
  assert.ok(view.panels[0].located >= 1)
  assert.equal(view.coverage.find(row => row.id === 'price_date').captured, true)
  assert.equal(view.coverage.find(row => row.id === 'front').captured, false)
  assert.equal(view.ruleDistribution.reduce((sum, row) => sum + row.count, 0), view.checks.length)
  assert.equal(view.id, 'current-only')
})
test('draft restore, running scans, pending previews and sealed state are explicit, not inferred from history', () => {
  const state = { pendingRestore: true, running: false, pendingPreview: true, saved: false }
  const view = buildInspectionAnalysis(record(), state)
  for (const [key, value] of Object.entries(state)) assert.equal(view[key], value)
  assert.equal(buildInspectionAnalysis(record({ text: '' })).status, 'awaiting_ocr')
})
