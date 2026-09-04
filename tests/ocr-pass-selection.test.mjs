import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareOcrPassSelection, OCR_PASS_SELECTION_METHOD } from '../src/lib/ocrPassSelection.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const evidence = () => [{ id: 'p1', analysisUrl: 'original', ocrText: 'WHOLE HISTORY', ocrPasses: [{ id: 'whole', text: 'Net Content:\n500m\nMRP:22.00', provider: 'paddleocr-js', strategy: 'local-alternative-original' }, { id: 'crop', text: ' Net Content:\n500ml\n ', provider: 'paddleocr-js', strategy: 'local-alternative-officer-focus' }], ocrWords: [] }]
const reason = 'Compared both readings with the photograph; the crop preserves the visible unit.'
const prepare = (overrides = {}) => prepareOcrPassSelection({ evidenceItems: evidence(), selections: [{ panelId: 'p1', passId: 'crop' }], reason, ...overrides })

test('officer selection copies complete exact raw text and preserves every original pass and panel', () => {
  const evidenceItems = evidence(); const before = structuredClone(evidenceItems)
  const result = prepare({ evidenceItems })
  assert.equal(result.text, '[OFFICER-SELECTED RAW PASS · PANEL 1 · READING 2]\n Net Content:\n500ml\n ')
  assert.deepEqual(evidenceItems, before)
  assert.equal(result.auditPayload.method, OCR_PASS_SELECTION_METHOD)
  assert.deepEqual(result.auditPayload.selectedPasses.map(pass => pass.passId), ['crop'])
  assert.deepEqual(result.auditPayload.excludedPasses.map(pass => pass.passId), ['whole'])
  assert.equal(result.auditPayload.rawHistoryPreserved, true)
  assert.equal(result.auditPayload.legalVerdictInferred, false)
  assert.equal(result.auditPayload.reason, reason)
  assert.equal('rawOcrText' in result, false)
  assert.equal('evidenceItems' in result, false)
  assert.doesNotMatch(JSON.stringify(result.auditPayload), /analysisUrl|500ml/)
})

test('selection never resolves a conflict by score and supports explicitly retaining both conflicting readings', () => {
  const evidenceItems = evidence()
  evidenceItems[0].ocrPasses[0].confidence = 99
  evidenceItems[0].ocrPasses[1].confidence = 20
  const selected = prepare({ evidenceItems })
  assert.ok(selected.text.endsWith(evidenceItems[0].ocrPasses[1].text))
  const both = prepare({ evidenceItems, selections: [{ panelId: 'p1', passId: 'crop' }, { panelId: 'p1', passId: 'whole' }] })
  assert.equal(both.auditPayload.selectedPasses.length, 2)
  assert.match(both.text, /500m\n/); assert.match(both.text, /500ml\n/)
  assert.ok(both.text.indexOf('READING 1') < both.text.indexOf('READING 2'), 'history order is stable, never caller-selected confidence order')
})

test('supplied text, unknown raw IDs, duplicates, empty passes and stale panel IDs cannot be selected', () => {
  for (const selections of [[], [{ panelId: 'p1', passId: 'crop', text: 'NET QTY 999ml' }], [{ panelId: 'p1', passId: 'new' }], [{ panelId: 'new', passId: 'crop' }], [{ panelId: 'p1', passId: 'crop' }, { panelId: 'p1', passId: 'crop' }], new Array(1)]) assert.throws(() => prepare({ selections }))
  const evidenceItems = evidence(); evidenceItems[0].ocrPasses[1].text = '  \n '
  assert.throws(() => prepare({ evidenceItems }), /missing or empty/)
})

test('all photographed panels with raw OCR require a choice and unread panels remain explicit', () => {
  const evidenceItems = [...evidence(), { id: 'p2', ocrPasses: [{ id: 'whole', text: 'Packed on 01/2026' }] }, { id: 'p3', ocrPasses: [] }]
  assert.throws(() => prepare({ evidenceItems }), /panel 2/)
  const result = prepare({ evidenceItems, selections: [{ panelId: 'p1', passId: 'crop' }, { panelId: 'p2', passId: 'whole' }] })
  assert.deepEqual(result.auditPayload.unreadPanelIds, ['p3'])
  assert.match(result.text, /PANEL 3 · NO RAW OCR READING AVAILABLE · NOT ASSESSED FROM OCR/)
  assert.deepEqual(result.auditPayload.selectedPasses.map(pass => [pass.panelId, pass.passId]), [['p1', 'crop'], ['p2', 'whole']])
})

test('reason and immutable history checks run before any working transcript is returned', () => {
  for (const invalid of ['', 'too short', 'a'.repeat(1001), 'has\u0000control byte']) assert.throws(() => prepare({ reason: invalid }), /12–1000/)
  const evidenceItems = evidence(); evidenceItems[0].ocrPasses.push({ ...evidenceItems[0].ocrPasses[0] })
  assert.throws(() => prepare({ evidenceItems }), /Duplicate OCR pass/)
})

test('working transcript limits include separators; selection never silently truncates raw passes', () => {
  const evidenceItems = evidence(); evidenceItems[0].ocrPasses[1].text = 'x'.repeat(100000)
  const before = structuredClone(evidenceItems)
  assert.throws(() => prepare({ evidenceItems }), /100,000/)
  assert.deepEqual(evidenceItems, before)
})

test('separators prevent a heading in one selected raw pass borrowing a bare number from another', () => {
  const evidenceItems = [{ id: 'p1', ocrPasses: [{ id: 'one', text: 'NET QUANTITY:' }, { id: 'two', text: '500ml' }] }]
  const result = prepare({ evidenceItems, selections: [{ panelId: 'p1', passId: 'one' }, { panelId: 'p1', passId: 'two' }] })
  const field = extractDeclarations(result.text).byId.netQuantity
  assert.notEqual(field.validation?.status, 'format_valid')
})
