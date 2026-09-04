import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { appendAuditEvent, verifyAuditChain } from '../src/lib/audit.mjs'
import { abortError } from '../src/lib/ocrLifecycle.mjs'
import { invalidateCapturedEvidence, restoreEvidencePolicy, ocrProvenance } from '../src/lib/inspectionWorkflow.mjs'
import { appendFocusedTranscript } from '../src/lib/focusOcr.mjs'
import { appendOcrHistory, validateOcrHistory } from '../src/lib/ocrHistory.mjs'
import { preparePaddleAppend, parsePaddleOutput, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'
import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from '../src/lib/ocrReadingOrder.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { fieldCandidates } from '../src/lib/inspectionSafety.mjs'
import { matchDeclarationRegions } from '../src/lib/vision.mjs'

// Exact-current App closure tests: real audit hashing, extraction, append and
// provenance helpers; synchronous state-setter doubles and a mocked OCR runner.
// These do NOT claim React/browser rendering or image-recognition coverage.
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const names = ['cancelActiveJob', 'recordAudit', 'restoreDraft', 'applyExtraction', 'appendFocusResult', 'runAlternativeOcr', 'appendAlternativeOcr']
const declarations = names.map(name => {
  const start = app.indexOf(`  const ${name} =`)
  assert.ok(start >= 0, `Missing App closure ${name}; update the source harness after a refactor.`)
  const rest = app.slice(start); const end = rest.indexOf('\n  }')
  assert.ok(end >= 0, `Missing App closure boundary ${name}.`)
  return rest.slice(0, end + '\n  }'.length)
}).join('\n')
const cleanup = app.match(/  useEffect\(\(\) => \(\) => (\{[^\n]*activeJob\.current\?\.abort\(\)[^\n]*\}), \[\]\)/)?.[1]
assert.ok(cleanup, 'Missing exact App unmount cleanup; update the source harness after a refactor.')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const clone = value => JSON.parse(JSON.stringify(value))
const oldWord = { panelId: 'p1', text: 'ORIGINAL', lineText: 'ORIGINAL RAW', confidence: 80, bbox: { x0: 1, y0: 1, x1: 40, y1: 12 }, pageWidth: 100, pageHeight: 80 }
const photo = { id: 'p1', name: 'real.jpg', analysisUrl: 'image:old', originalUrl: 'original:old', ocrText: 'ORIGINAL RAW', ocrPasses: [{ id: 'old-pass', text: 'ORIGINAL RAW', confidence: 80 }], ocrWords: [oldWord] }
const paddleParsed = parsePaddleOutput({ image: { width: 100, height: 80 }, items: [
  { text: 'PACKED ON:', score: .9, poly: [[1, 20], [40, 20], [40, 30], [1, 30]] },
  { text: '02/08/2026', score: .8, poly: [[45, 20], [98, 20], [98, 30], [45, 30]] },
] }, 'p1', { width: 100, height: 80 })
const paddleOutput = { provider: 'paddleocr-js', model: PADDLE_MODEL, reliability: null, items: [{
  id: 'p1', imageUrl: photo.analysisUrl, source: 'original-resolution-bounded', width: 100, height: 80,
  ...paddleParsed, ocrWords: paddleParsed.words,
  ocrPasses: [{ id: 'p1:paddle-original', text: paddleParsed.text, confidence: paddleParsed.confidence, provider: 'paddleocr-js', model: PADDLE_MODEL, strategy: 'local-alternative-original' }],
}] }
const proposal = { panelId: 'p1', text: 'PACKED ON: 02/08/2026', sourceIds: paddleParsed.lines.map(line => line.id) }

async function harness({ pauseType = '', failType = '', pauseRunner = false, failRunner = false } = {}) {
  const oldChain = await appendAuditEvent([], 'old_observation', {}, 'officer')
  const state = {
    inspectionId: 'old-id', startedAt: '2026-09-01T00:00:00.000Z', evidenceItems: [clone(photo)], activeEvidenceId: 'p1',
    text: 'OFFICER CORRECTED TEXT', rawOcrText: 'ORIGINAL RAW', ocrWords: [clone(oldWord)], auditChain: oldChain,
    meta: { officerNote: 'keep', ocrConfidence: 95, ocrEngineConfidence: 96, fieldReviews: { mrp: { status: 'verified' } }, placementReviews: { mrp: { confirmed: true } }, quantitySpacing: { confirmed: true }, allPanelsCaptured: true, classificationConfirmed: true, measurementConfirmed: true, widthCharacterConfirmed: true },
    processing: false, saving: false, ocrState: { running: false, progress: 0, error: '' },
    focusSelection: { panelId: 'p1', imageUrl: photo.analysisUrl, rect: { x0: .1, y0: .1, x1: .9, y1: .9 } },
    focusResult: { panelId: 'p1', imageUrl: photo.analysisUrl, runId: 'focus-run', crop: { x0: .1, y0: .1, x1: .9, y1: .9 }, source: 'original-resolution', output: { items: [{ id: 'p1', ocrText: 'NET QTY. 100 g', ocrConfidence: 87, ocrWords: [clone(oldWord)], ocrPasses: [{ id: 'focus-pass', text: 'NET QTY. 100 g', confidence: 87 }] }] } },
    paddlePreview: { output: clone(paddleOutput), runId: 'paddle-run', proposals: [clone(proposal)] },
    draft: { inspectionId: 'draft-id', startedAt: '2026-09-02T00:00:00.000Z', evidenceItems: [{ ...clone(photo), id: 'draft-panel', analysisUrl: 'image:draft' }], activeEvidenceId: 'draft-panel', text: 'DRAFT TEXT', rawOcrText: 'DRAFT RAW', meta: {}, ocrWords: [], auditChain: [] },
  }
  const initial = clone(state); const entered = deferred(); const release = deferred()
  const runnerEntered = deferred(); const runnerRelease = deferred(); const calls = []
  const context = {
    ...state, challenge: null, activeEvidence: state.evidenceItems[0], actor: { id: 'officer' },
    activeJob: { current: null }, auditRef: { current: oldChain }, auditQueue: { current: Promise.resolve() }, auditGeneration: { current: 0 },
    AbortController, crypto, abortError, INITIAL_META: {}, invalidateCapturedEvidence, restoreEvidencePolicy,
    appendFocusedTranscript, appendOcrHistory, validateOcrHistory, preparePaddleAppend, fieldCandidates, extractDeclarations,
    reconstructOcrReadingOrder, reviewableDeclarationProposals,
    appendAuditEvent: async (...args) => {
      if (args[1] === failType) throw new Error('Injected audit failure')
      if (args[1] === pauseType) { entered.resolve(); await release.promise }
      return appendAuditEvent(...args)
    },
    runPaddleOcr: async options => {
      calls.push(options); runnerEntered.resolve()
      if (pauseRunner) await runnerRelease.promise
      if (failRunner) throw new Error('Injected OCR failure')
      return clone(paddleOutput)
    },
    createPaddleFocusInput: async (item, rect) => ({ item, rect, syntheticTestInput: true }),
  }
  const setters = []
  for (const key of ['InspectionId', 'StartedAt', 'AuditChain', 'Processing', 'OcrState', 'EvidenceItems', 'ActiveEvidenceId', 'OcrWords', 'Text', 'RawOcrText', 'Meta', 'FocusSelection', 'FocusResult', 'PaddlePreview', 'Draft', 'DraftMessage']) {
    const stateKey = key[0].toLowerCase() + key.slice(1)
    context[`set${key}`] = value => { setters.push(key); state[stateKey] = typeof value === 'function' ? value(state[stateKey]) : value }
  }
  const handlers = runInNewContext(`${declarations}\n({${names.join(',')}, unmount: () => ${cleanup}})`, context, { timeout: 1000, filename: 'App.jsx-extracted-paddle-publication-closures.js' })
  return { state, initial, context, handlers, entered, release, runnerEntered, runnerRelease, calls, setters, oldChain }
}

function assertEvidencePreserved(h) {
  for (const key of ['inspectionId', 'startedAt', 'evidenceItems', 'text', 'rawOcrText', 'ocrWords', 'meta']) assert.deepEqual(clone(h.state[key]), h.initial[key], `${key} must not publish early/stale evidence`)
}

for (const handler of ['appendFocusResult', 'appendAlternativeOcr']) {
  test(`${handler}: delayed audit keeps previous evidence atomic until success`, async () => {
    const h = await harness({ pauseType: 'ocr_completed' })
    const task = h.handlers[handler](); await h.entered.promise
    assertEvidencePreserved(h)
    assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation'])
    h.release.resolve(); await task
    assert.ok(h.state.text.startsWith(h.initial.text))
    assert.ok(h.state.rawOcrText.startsWith(h.initial.rawOcrText))
    assert.equal(h.state.evidenceItems[0].ocrPasses.length, 2)
    assert.equal(h.state.evidenceItems[0].ocrPasses[0].text, 'ORIGINAL RAW')
    assert.equal(h.state.meta.officerNote, 'keep')
    for (const key of ['fieldReviews', 'placementReviews', 'quantitySpacing']) assert.deepEqual(clone(h.state.meta[key]), {})
    for (const key of ['allPanelsCaptured', 'classificationConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed']) assert.equal(h.state.meta[key], false)
    assert.equal(h.state.meta.ocrConfidence, null)
    assert.equal(h.state.meta.ocrEngineConfidence, null)
    const provenance = ocrProvenance(h.state)
    assert.equal(provenance.hasRun, true); assert.equal(provenance.reliability, null)
    assert.equal(await verifyAuditChain(h.state.auditChain), true)
  })

  test(`${handler}: audit failure publishes no text, boxes, candidates or completed event`, async () => {
    const h = await harness({ failType: 'ocr_completed' })
    await h.handlers[handler]()
    assertEvidencePreserved(h)
    assert.match(h.state.ocrState.error, /Injected audit failure/)
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
    assert.equal(h.context.activeJob.current, null)
  })

  for (const action of ['cancel', 'unmount']) {
    test(`${handler}: ${action} during delayed audit cannot publish late evidence`, async () => {
      const h = await harness({ pauseType: 'ocr_completed' })
      const task = h.handlers[handler](); await h.entered.promise
      if (action === 'cancel') h.handlers.cancelActiveJob()
      else h.handlers.unmount()
      const settersAfterStop = h.setters.length
      h.release.resolve(); await task; await h.context.auditQueue.current
      assertEvidencePreserved(h)
      assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
      if (action === 'unmount') assert.equal(h.setters.length, settersAfterStop, 'Unmounted closure must not issue any later React state setter')
      assert.equal(await verifyAuditChain(h.state.auditChain), true)
    })
  }

  test(`${handler}: restoring a late-loaded draft is blocked while append audit is pending`, async () => {
    const h = await harness({ pauseType: 'ocr_completed' })
    const task = h.handlers[handler](); await h.entered.promise
    h.handlers.restoreDraft()
    assertEvidencePreserved(h)
    assert.match(h.state.draftMessage, /Finish or cancel/)
    h.handlers.cancelActiveJob(); h.release.resolve(); await task; await h.context.auditQueue.current
    assertEvidencePreserved(h)
  })
}

test('Paddle append retains selected layout mapping but never places joined suggestions into raw OCR', async () => {
  const h = await harness()
  await h.handlers.appendAlternativeOcr([clone(proposal)])
  assert.match(h.state.text, /OFFICER-SELECTED LAYOUT SUGGESTIONS/)
  assert.ok(h.state.text.endsWith(proposal.text))
  assert.equal(h.state.rawOcrText.includes(proposal.text), false)
  assert.ok(h.state.rawOcrText.endsWith(paddleParsed.text))
  assert.equal(h.state.evidenceItems[0].ocrPasses.at(-1).text, paddleParsed.text)
  const event = h.state.auditChain.at(-1)
  assert.equal(event.type, 'ocr_completed')
  assert.equal(event.payload.reliability, null)
  assert.deepEqual(clone(event.payload.reviewedRows[0].parts), paddleParsed.lines.map(({ id, text, box }) => ({ id, text, box })))
  assert.equal(event.payload.reviewedRows[0].method, 'officer-selected-geometric-row')
})

for (const handler of ['appendFocusResult', 'appendAlternativeOcr']) {
  test(`${handler}: stale image preview cannot publish to a replacement image`, async () => {
    const h = await harness()
    h.context.evidenceItems = [{ ...clone(photo), analysisUrl: 'image:replacement' }]
    h.context.activeEvidence = h.context.evidenceItems[0]
    await h.handlers[handler]()
    assertEvidencePreserved(h)
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
  })
}

for (const action of ['cancel', 'unmount']) {
  test(`Paddle request audit ${action}: runner never starts and no preview becomes evidence`, async () => {
    const h = await harness({ pauseType: 'alternative_ocr_requested' })
    const task = h.handlers.runAlternativeOcr(); await h.entered.promise
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const setterCount = h.setters.length
    h.release.resolve(); await task; await h.context.auditQueue.current
    assertEvidencePreserved(h); assert.equal(h.calls.length, 0); assert.equal(h.state.paddlePreview, null)
    assert.equal(h.state.auditChain.some(event => event.type === 'alternative_ocr_requested'), false)
    if (action === 'unmount') assert.equal(h.setters.length, setterCount)
  })

  test(`Paddle runner ${action}: late progress and output cannot replace preserved evidence/preview`, async () => {
    const h = await harness({ pauseRunner: true })
    const task = h.handlers.runAlternativeOcr(); await h.runnerEntered.promise
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const setterCount = h.setters.length
    h.calls[0].onProgress({ running: true, progress: 99, label: 'STALE CALLBACK' })
    h.runnerRelease.resolve(); await task; await h.context.auditQueue.current
    assertEvidencePreserved(h); assert.equal(h.state.paddlePreview, null)
    assert.notEqual(h.state.ocrState.label, 'STALE CALLBACK')
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
    if (action === 'unmount') assert.equal(h.setters.length, setterCount)
  })
}

test('Paddle request audit failure does not run recognition or change evidence', async () => {
  const h = await harness({ failType: 'alternative_ocr_requested' })
  await h.handlers.runAlternativeOcr()
  assertEvidencePreserved(h); assert.equal(h.calls.length, 0)
  assert.equal(h.state.paddlePreview, null); assert.match(h.state.ocrState.error, /Injected audit failure/)
})

test('Paddle runner failure cannot claim completion or leave a stale preview', async () => {
  const h = await harness({ failRunner: true })
  await h.handlers.runAlternativeOcr()
  assertEvidencePreserved(h); assert.equal(h.state.paddlePreview, null)
  assert.match(h.state.ocrState.error, /Injected OCR failure/)
  assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
})

test('successful Paddle preview is separate from evidence and has no completed OCR provenance until append', async () => {
  const h = await harness()
  await h.handlers.runAlternativeOcr()
  assertEvidencePreserved(h)
  assert.deepEqual(clone(h.state.paddlePreview.output), paddleOutput)
  assert.equal(h.state.auditChain.at(-1).type, 'alternative_ocr_requested')
  assert.equal(ocrProvenance(h.state).hasRun, false)
})

test('focused Paddle request checks current image identity and carries exact officer crop to its runner', async () => {
  const h = await harness()
  await h.handlers.runAlternativeOcr(true)
  assertEvidencePreserved(h)
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].evidenceItems.length, 1)
  const input = await h.calls[0].inputFactory(photo)
  assert.deepEqual(clone(input.rect), h.initial.focusSelection.rect)
  assert.deepEqual(clone(h.state.auditChain.at(-1).payload.crop), h.initial.focusSelection.rect)
  const stale = await harness(); stale.context.focusSelection = { ...stale.context.focusSelection, imageUrl: 'image:stale' }
  await stale.handlers.runAlternativeOcr(true)
  assert.equal(stale.calls.length, 0)
})

test('idle draft restore invalidates queued audit generation and clears OCR previews', async () => {
  const h = await harness({ pauseType: 'officer_note' })
  const pending = h.handlers.recordAudit('officer_note')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await h.entered.promise
  h.handlers.restoreDraft()
  h.release.resolve(); await rejected
  assert.equal(h.state.inspectionId, 'draft-id'); assert.equal(h.state.text, 'DRAFT TEXT')
  assert.equal(h.context.auditGeneration.current, 1)
  for (const key of ['focusResult', 'focusSelection', 'paddlePreview']) assert.equal(h.state[key], null)
  assert.deepEqual(clone(h.state.auditChain), [])
})

const regionExtraction = { fields: [{ id: 'mrp', label: 'MRP', detected: true, evidence: 'MRP 40.00' }] }
const regionWord = (overrides = {}) => ({ panelId: 'p1', text: 'MRP', lineText: 'MRP 40.00', confidence: 90, pageWidth: 2200, pageHeight: 1800, bbox: { x0: 100, y0: 100, x1: 150, y1: 120 }, ...overrides })

test('declaration region cannot union identical text from different OCR frame widths', () => {
  const words = [regionWord(), regionWord({ text: '40.00', bbox: { x0: 155, y0: 100, x1: 200, y1: 120 } }), regionWord({ pageWidth: 2000, pageHeight: 1636, bbox: { x0: 90, y0: 90, x1: 181, y1: 109 } })]
  const [region] = matchDeclarationRegions(regionExtraction, words)
  assert.deepEqual(region.bbox, { x0: 100, y0: 100, x1: 200, y1: 120 })
  assert.equal(region.pageWidth, 2200); assert.equal(region.pageHeight, 1800); assert.equal(region.pixelHeight, 20)
})

test('declaration region separates frame height even when panel, text and width match', () => {
  const [region] = matchDeclarationRegions(regionExtraction, [regionWord(), regionWord({ pageHeight: 2200, bbox: { x0: 80, y0: 300, x1: 200, y1: 360 } })])
  assert.deepEqual(region.bbox, regionWord().bbox); assert.equal(region.pageHeight, 1800)
})

test('line polygons cannot inflate word/glyph regions even within the same page dimensions', () => {
  const [region] = matchDeclarationRegions(regionExtraction, [regionWord(), regionWord({ geometryKind: 'line-box-not-glyph', bbox: { x0: 70, y0: 80, x1: 250, y1: 140 } })])
  assert.deepEqual(region.bbox, regionWord().bbox); assert.equal(region.pixelHeight, 20)
})
