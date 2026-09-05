import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStructuredPaddleAddition } from '../src/lib/paddleWorkingText.mjs'
import { preparePaddleAppend, paddleSourceBinding, parsePaddleOutput, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

// Synthetic geometry/atomic-publication tests, NOT an OCR accuracy benchmark.
// The APIs receive emitted source fragments only, never expected answer fields.
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const source = (text, x, y, w, h = 40) => ({ text, score: .92, poly: box(x, y, w, h) })
const panel = () => ({
  id: 'p1', name: 'synthetic-layout.jpg', originalUrl: 'data:image/jpeg;base64,c3ludGhldGlj',
  analysisUrl: 'data:image/png;base64,c3ludGhldGljLWFuYWx5c2lz', width: 1000, height: 800,
  analysisWidth: 1000, analysisHeight: 800, originalWidth: 1000, originalHeight: 800,
  rotation: 0, perspective: null, grayscale: false, contrast: 100,
  ocrText: 'PRIOR RAW OBSERVATION', ocrPasses: [{ id: 'old', text: 'PRIOR RAW OBSERVATION' }], ocrWords: [],
})
function observation(entries, evidence = panel()) {
  const frame = { width: 1000, height: 800 }
  const parsed = parsePaddleOutput({ image: frame, items: entries }, evidence.id, frame)
  return {
    id: evidence.id, ...frame, ...parsed, imageUrl: evidence.analysisUrl,
    sourceBinding: paddleSourceBinding(evidence), previewUrl: 'data:image/png;base64,c3ludGhldGljLXByZXZpZXc=',
    ocrWords: parsed.words,
    ocrPasses: [{ id: `${evidence.id}:paddle-original`, text: parsed.text, confidence: parsed.confidence, provider: 'paddleocr-js', model: PADDLE_MODEL, strategy: 'local-alternative-original' }],
  }
}
const stacked = () => [source('Net quantity:', 100, 100, 200), source('Other column', 10, 170, 70, 20), source('250 g', 150, 150, 100)]
const request = (item, evidence = panel(), extra = {}) => ({ evidenceItems: [evidence], text: '', rawOcrText: '', output: { items: [item] }, runId: 'synthetic-machine-run', structured: true, ...extra })
const value = (text, key = 'netQuantity') => extractDeclarations(text).byId[key]
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

test('machine candidates derive from source geometry without claiming officer-selected or confirmed values', () => {
  const item = freeze(observation(stacked()))
  const before = JSON.stringify(item)
  const result = buildStructuredPaddleAddition([item])
  assert.equal(result.candidateRows.length, 1)
  const row = result.candidateRows[0]
  assert.equal(row.method, 'system-derived-geometric-candidate')
  assert.equal(row.field, 'netQuantity')
  assert.equal(row.value, '250 g')
  assert.equal(row.text, row.parts.map(part => part.text).join(' '))
  assert.equal(row.requiresOfficerReview, true)
  assert.equal(row.eligibleForAutomaticVerdict, false)
  assert.deepEqual(result.reviewedRows, [])
  assert.match(result.workingAddition, /MACHINE LAYOUT CANDIDATES · UNVERIFIED/)
  assert.doesNotMatch(result.workingAddition, /OFFICER-SELECTED/)
  assert.equal(JSON.stringify(item), before)
})

test('machine derivation preserves exact raw observations and accounts for every source fragment exactly once', () => {
  const item = observation(stacked())
  const result = buildStructuredPaddleAddition([item])
  assert.equal(result.rawAddition, `\n\n[PADDLE RAW OCR · PANEL 1]\n${item.text}`)
  assert.doesNotMatch(result.rawAddition, /Net quantity: 250 g|MACHINE LAYOUT/)
  assert.equal(value(result.workingAddition).value, '250 g')
  assert.equal(value(result.rawAddition).validation.status, 'invalid')
  assert.match(result.workingAddition, /Other column/)
  assert.equal(result.workingMappings.length, 1)
  assert.equal(result.workingMappings[0].sourceOnce, true)
  const retained = result.workingMappings[0].rows.flatMap(row => row.sourceIds)
  assert.equal(new Set(retained).size, retained.length)
  assert.deepEqual([...retained].sort(), item.lines.map(line => line.id).sort())
  assert.equal(result.workingMappings[0].rows.find(row => row.sourceIds.length === 2).kind, 'machine-layout-candidate')
})

test('automatic same-row date candidates retain every digit and ignore unrelated serialized lines', () => {
  const item = observation([source('02/11/2026', 350, 100, 200), source('Other column', 10, 500, 150), source('PACKED ON:', 100, 100, 200)])
  const result = buildStructuredPaddleAddition([item])
  assert.equal(result.candidateRows.length, 1)
  assert.equal(result.candidateRows[0].text, 'PACKED ON: 02/11/2026')
  assert.equal(value(result.workingAddition, 'packDate').value, '02/11/2026')
  assert.ok(result.rawAddition.endsWith('PACKED ON:'))
  assert.deepEqual(result.reviewedRows, [])
})

test('invalid characters, absent headings and unresolved competing values do not become machine answers', () => {
  const cases = [
    [source('250 g', 150, 150, 100), source('Other column', 10, 400, 150)],
    [source('Net quantity:', 100, 100, 200), source('2S0 g', 150, 150, 100)],
    [source('Net quantity:', 100, 100, 200), source('250 g', 110, 150, 85), source('500 g', 205, 150, 85)],
    [source('MRP:', 100, 100, 100), source('40.00', 220, 100, 100), source('80.00', 340, 100, 100)],
    [source('MRP:', 100, 100, 100), source('USP:', 220, 100, 100), source('40.00', 340, 100, 100)],
    [source('NTENTS at 30°C: 910 g', 0, 100, 400)],
  ]
  for (const entries of cases) {
    const item = observation(entries)
    const result = buildStructuredPaddleAddition([item])
    assert.equal(result.candidateRows.length, 0, item.text)
    assert.deepEqual(result.reviewedRows, [])
    assert.equal(result.workingAddition, result.rawAddition, item.text)
  }
})

test('invalid source geometry is withheld with warning; raw disagreement and duplicate IDs are rejected', () => {
  const item = observation(stacked())
  const invalidGeometry = structuredClone(item)
  invalidGeometry.lines[0].box[0][0] = -1
  const result = buildStructuredPaddleAddition([invalidGeometry])
  assert.deepEqual(result.candidateRows, [])
  assert.ok(result.warnings.length > 0)
  assert.equal(result.workingAddition, result.rawAddition)
  assert.throws(() => buildStructuredPaddleAddition([{ ...item, text: `${item.text}\nInjected answer` }]), /exactly/)
  const duplicates = structuredClone(item)
  duplicates.lines[2].id = duplicates.lines[0].id
  assert.throws(() => buildStructuredPaddleAddition([duplicates]), /uniquely/)
})

test('structured append is atomic, machine-attributed, and preserves original/history/transcript byte strings', () => {
  const evidence = freeze(panel())
  const item = freeze(observation(stacked(), evidence))
  const before = JSON.stringify({ evidence, item })
  const result = preparePaddleAppend(request(item, evidence, { text: 'OFFICER NOTE', rawOcrText: evidence.ocrText }))
  assert.ok(result.text.startsWith('OFFICER NOTE'))
  assert.ok(result.rawOcrText.startsWith(evidence.ocrText))
  assert.equal(result.candidateRows.length, 1)
  assert.deepEqual(result.reviewedRows, [])
  assert.equal(result.evidenceItems[0].originalUrl, evidence.originalUrl)
  assert.equal(result.evidenceItems[0].ocrPasses[0].text, evidence.ocrPasses[0].text)
  assert.equal(result.evidenceItems[0].ocrPasses[1].text, item.text)
  assert.equal(result.evidenceItems[0].ocrText, `${evidence.ocrText}\n\n${item.text}`)
  assert.doesNotMatch(result.rawOcrText, /MACHINE LAYOUT/)
  assert.deepEqual(result.evidenceItems[0].ocrWords, item.ocrWords)
  assert.equal(JSON.stringify({ evidence, item }), before)
})

test('automatic candidates never erase previous invalid OCR or contradictory valid readings', () => {
  const item = observation(stacked())
  for (const previous of ['Net quantity: 2S0 g', 'Net quantity: 500 g']) {
    const evidence = { ...panel(), ocrText: previous, ocrPasses: [{ id: 'old', text: previous }] }
    const next = preparePaddleAppend(request(item, evidence, { text: previous, rawOcrText: previous }))
    assert.ok(next.text.startsWith(previous))
    assert.ok(next.rawOcrText.startsWith(previous))
    assert.equal(next.evidenceItems[0].ocrPasses[0].text, previous)
    assert.equal(value(next.text).conflict, true)
    assert.equal(value(next.text).validation.status, 'conflict')
    assert.equal(value(next.text).value, '')
    assert.equal(next.candidateRows[0].value, '250 g', 'A new candidate does not select away the earlier evidence')
  }
})

test('structured append refuses supplied answers and non-boolean mode before publishing any changes', () => {
  const evidence = panel()
  const item = observation(stacked(), evidence)
  const before = JSON.stringify({ evidence, item })
  const supplied = { panelId: 'p1', sourceIds: ['p1:line-0', 'p1:line-2'], text: 'Net quantity: 250 g' }
  assert.throws(() => preparePaddleAppend(request(item, evidence, { proposedRows: [supplied] })), /computed from the actual source geometry/)
  for (const structured of ['true', 1, null, {}, []]) assert.throws(() => preparePaddleAppend(request(item, evidence, { structured })), /computed from the actual source geometry/)
  assert.equal(JSON.stringify({ evidence, item }), before)
})

test('machine mode rejects stale or tampered source bindings atomically', () => {
  const evidence = panel()
  const item = observation(stacked(), evidence)
  const before = JSON.stringify({ evidence, item })
  const changes = [
    target => { target.sourceBinding = undefined },
    target => { target.sourceBinding.originalUrl = 'data:image/jpeg;base64,b3RoZXI=' },
    target => { target.sourceBinding.analysisUrl = 'data:image/png;base64,b3RoZXI=' },
    target => { target.sourceBinding.transform = '{}' },
    target => { target.sourceBinding.inputKind = 'analysis' },
    target => { target.imageUrl = 'another-image' },
  ]
  for (const change of changes) {
    const tampered = structuredClone(item); change(tampered)
    assert.throws(() => preparePaddleAppend(request(tampered, evidence)), /image changed/)
  }
  assert.throws(() => preparePaddleAppend(request(item, { ...evidence, rotation: 90 })), /image changed/)
  assert.equal(JSON.stringify({ evidence, item }), before)
})

test('machine candidates retain bounded history, run uniqueness, and explicit panel order', () => {
  const evidence = panel()
  const item = observation(stacked(), evidence)
  const first = preparePaddleAppend(request(item, evidence))
  assert.throws(() => preparePaddleAppend(request(item, first.evidenceItems[0])), /Duplicate/)
  assert.throws(() => preparePaddleAppend(request(item, evidence, { text: 'x'.repeat(100000) })), /limit/)
  assert.throws(() => preparePaddleAppend(request(item, evidence, { rawOcrText: 'x'.repeat(100000) })), /limit/)
  const ordered = buildStructuredPaddleAddition([item], ['other-panel', 'p1'])
  assert.match(ordered.rawAddition, /PANEL 2/)
  assert.match(ordered.workingAddition, /PANEL 2/)
  assert.throws(() => buildStructuredPaddleAddition([item], ['other-panel']), /current captured panels/)
})
