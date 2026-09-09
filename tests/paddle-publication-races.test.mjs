import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { appendAuditEvent, verifyAuditChain } from '../src/lib/audit.mjs'
import { abortError } from '../src/lib/ocrLifecycle.mjs'
import { invalidateCapturedEvidence, restoreEvidencePolicy, ocrProvenance } from '../src/lib/inspectionWorkflow.mjs'
import { appendFocusedTranscript } from '../src/lib/focusOcr.mjs'
import { appendOcrHistory, validateOcrHistory } from '../src/lib/ocrHistory.mjs'
import { preparePaddleAppend, parsePaddleOutput, paddleSourceBinding, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'
import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from '../src/lib/ocrReadingOrder.mjs'
import { collectPaddleLayoutProposals } from '../src/lib/paddleLayoutProposals.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { fieldCandidates } from '../src/lib/inspectionSafety.mjs'
import { matchDeclarationRegions } from '../src/lib/vision.mjs'
import { resolvePaddleFocusSuggestion } from '../src/lib/ocrFocusGuidance.mjs'
import { prepareOcrPassSelection } from '../src/lib/ocrPassSelection.mjs'

// Exact-current App closure tests: real audit hashing, extraction, append and
// provenance helpers; synchronous state-setter doubles and a mocked OCR runner.
// These do NOT claim React/browser rendering or image-recognition coverage.
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const names = ['cancelActiveJob', 'recordAudit', 'restoreDraft', 'applyExtraction', 'runStructuredOcr', 'runOcr', 'runConnectedOcr', 'runFocusedOcr', 'appendFocusResult', 'runAlternativeOcr', 'appendAlternativeOcr', 'applyRawPassSelection']
const declarations = names.map(name => {
  const start = app.indexOf(`  const ${name} =`)
  assert.ok(start >= 0, `Missing App closure ${name}; update the source harness after a refactor.`)
  const rest = app.slice(start); const end = rest.indexOf('\n  }')
  assert.ok(end >= 0, `Missing App closure boundary ${name}.`)
  return rest.slice(0, end + '\n  }'.length)
}).join('\n')
const cleanup = app.match(/return \(\) => (\{[^\n]*studioMounted\.current = false[^\n]*activeJob\.current\?\.abort\(\)[^\n]*\})/)?.[1]
assert.ok(cleanup, 'Missing exact App unmount cleanup; update the source harness after a refactor.')
const pendingPreviewExpression = app.match(/  const ocrPreviewPending = ([^\r\n]+)/)?.[1]
assert.ok(pendingPreviewExpression, 'Missing exact App pending-preview expression; update the source harness after a refactor.')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const clone = value => JSON.parse(JSON.stringify(value))
const oldWord = { panelId: 'p1', text: 'ORIGINAL', lineText: 'ORIGINAL RAW', confidence: 80, bbox: { x0: 1, y0: 1, x1: 40, y1: 12 }, pageWidth: 100, pageHeight: 80 }
const photo = { id: 'p1', name: 'real.jpg', analysisUrl: 'image:old', originalUrl: 'original:old', ocrText: 'ORIGINAL RAW', ocrPasses: [{ id: 'old-pass', text: 'ORIGINAL RAW', confidence: 80 }], ocrWords: [oldWord] }
const paddleParsed = parsePaddleOutput({ image: { width: 100, height: 80 }, items: [
  { text: 'PACKED ON:', score: .9, poly: [[1, 20], [40, 20], [40, 30], [1, 30]] },
  { text: '02/08/2026', score: .8, poly: [[45, 20], [98, 20], [98, 30], [45, 30]] },
] }, 'p1', { width: 100, height: 80 })
const paddleOutput = { provider: 'paddleocr-js', model: PADDLE_MODEL, reliability: null, items: [{
  id: 'p1', imageUrl: photo.analysisUrl, sourceBinding: paddleSourceBinding(photo), source: 'original-resolution-bounded', width: 100, height: 80,
  ...paddleParsed, ocrWords: paddleParsed.words,
  ocrPasses: [{ id: 'p1:paddle-original', text: paddleParsed.text, confidence: paddleParsed.confidence, provider: 'paddleocr-js', model: PADDLE_MODEL, strategy: 'local-alternative-original' }],
}] }
const proposal = { panelId: 'p1', text: 'PACKED ON: 02/08/2026', sourceIds: paddleParsed.lines.map(line => line.id) }

async function harness({ pauseType = '', failType = '', pauseRunner = false, failRunner = false, pendingPreviews = true } = {}) {
  const oldChain = await appendAuditEvent([], 'old_observation', {}, 'officer')
  const state = {
    inspectionId: 'old-id', startedAt: '2026-09-01T00:00:00.000Z', evidenceItems: [clone(photo)], activeEvidenceId: 'p1',
    text: 'OFFICER CORRECTED TEXT', rawOcrText: 'ORIGINAL RAW', ocrWords: [clone(oldWord)], auditChain: oldChain,
    meta: { officerNote: 'keep', ocrConfidence: 95, ocrEngineConfidence: 96, fieldReviews: { mrp: { status: 'verified' } }, placementReviews: { mrp: { confirmed: true } }, quantitySpacing: { confirmed: true }, allPanelsCaptured: true, classificationConfirmed: true, rule3ApplicabilityConfirmed: true, placementPdpConfirmed: true, measurementConfirmed: true, widthCharacterConfirmed: true },
    processing: false, saved: false, saving: false, ocrState: { running: false, progress: 0, error: '' },
    focusSelection: { panelId: 'p1', imageUrl: photo.analysisUrl, rect: { x0: .1, y0: .1, x1: .9, y1: .9 } },
    focusResult: { panelId: 'p1', imageUrl: photo.analysisUrl, runId: 'focus-run', crop: { x0: .1, y0: .1, x1: .9, y1: .9 }, source: 'original-resolution', output: { items: [{ id: 'p1', ocrText: 'NET QTY. 100 g', ocrConfidence: 87, ocrWords: [clone(oldWord)], ocrPasses: [{ id: 'focus-pass', text: 'NET QTY. 100 g', confidence: 87 }] }] } },
    paddlePreview: { output: clone(paddleOutput), runId: 'paddle-run', proposals: [clone(proposal)] },
    paddleGuidance: [],
    draft: { inspectionId: 'draft-id', startedAt: '2026-09-02T00:00:00.000Z', evidenceItems: [{ ...clone(photo), id: 'draft-panel', analysisUrl: 'image:draft' }], activeEvidenceId: 'draft-panel', text: 'DRAFT TEXT', rawOcrText: 'DRAFT RAW', meta: {}, ocrWords: [], auditChain: [] },
  }
  if (!pendingPreviews) { state.focusResult = null; state.paddlePreview = null }
  const initial = clone(state); const entered = deferred(); const release = deferred()
  const runnerEntered = deferred(); const runnerRelease = deferred(); const calls = []
  const context = {
    ...state, challenge: null, workspace: { offlineOnly: false }, activeEvidence: state.evidenceItems[0], actor: { id: 'officer' }, qualityBlocked: false,
    activeJob: { current: null }, auditRef: { current: oldChain }, auditQueue: { current: Promise.resolve() }, auditGeneration: { current: 0 },
    studioMounted: { current: true },
    AbortController, crypto, abortError, INITIAL_META: {}, invalidateCapturedEvidence, restoreEvidencePolicy,
    appendFocusedTranscript, appendOcrHistory, validateOcrHistory, preparePaddleAppend, fieldCandidates, extractDeclarations,
    reconstructOcrReadingOrder, reviewableDeclarationProposals, collectPaddleLayoutProposals,
    resolvePaddleFocusSuggestion, prepareOcrPassSelection,
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
  for (const key of ['InspectionId', 'StartedAt', 'AuditChain', 'Processing', 'OcrState', 'EvidenceItems', 'ActiveEvidenceId', 'OcrWords', 'Text', 'RawOcrText', 'Meta', 'FocusSelection', 'FocusResult', 'PaddlePreview', 'PaddleGuidance', 'Draft', 'DraftMessage']) {
    const stateKey = key[0].toLowerCase() + key.slice(1)
    context[`set${key}`] = value => { setters.push(key); state[stateKey] = typeof value === 'function' ? value(state[stateKey]) : value }
  }
  // Evaluate the exact shipped expression against the harness closure values.
  // Request tests start with no previews; append tests keep real seeded output.
  Object.defineProperty(context, 'ocrPreviewPending', { get: runInNewContext(`() => (${pendingPreviewExpression})`, context, { timeout: 1000 }) })
  const handlers = runInNewContext(`${declarations}\n({${names.join(',')}, unmount: () => ${cleanup}})`, context, { timeout: 1000, filename: 'App.jsx-extracted-paddle-publication-closures.js' })
  return { state, initial, context, handlers, entered, release, runnerEntered, runnerRelease, calls, setters, oldChain }
}

function assertEvidencePreserved(h) {
  for (const key of ['inspectionId', 'startedAt', 'evidenceItems', 'text', 'rawOcrText', 'ocrWords', 'meta']) assert.deepEqual(clone(h.state[key]), h.initial[key], `${key} must not publish early/stale evidence`)
}

const rawPassRequest = { selections: [{ panelId: 'p1', passId: 'crop-pass' }], reason: 'Compared both readings against the photograph; the complete unit is supported in the crop.' }
async function rawSelectionHarness(options = {}) {
  const h = await harness({ ...options, pendingPreviews: false })
  const captured = [{ ...clone(photo), ocrText: 'Net Content:\n500m\nMRP:22.00\n\nNet Content:\n500ml\nMRP:22.00', ocrPasses: [
    { id: 'old-pass', text: 'Net Content:\n500m\nMRP:22.00', confidence: 99 },
    { id: 'crop-pass', text: 'Net Content:\n500ml\nMRP:22.00', confidence: 81, provider: 'paddleocr-js', strategy: 'local-alternative-officer-focus' },
  ] }]
  h.state.evidenceItems = h.context.evidenceItems = captured
  h.initial.evidenceItems = clone(captured)
  h.state.rawOcrText = h.context.rawOcrText = captured[0].ocrText
  h.initial.rawOcrText = h.state.rawOcrText
  h.state.paddlePreview = h.context.paddlePreview = null
  h.context.activeEvidence = captured[0]
  return h
}

test('working raw-pass selection publishes only after audit and retains all raw evidence with null confidence', async () => {
  const h = await rawSelectionHarness({ pauseType: 'working_ocr_passes_selected' })
  const expected = prepareOcrPassSelection({ evidenceItems: h.context.evidenceItems, ...rawPassRequest })
  const pending = h.handlers.applyRawPassSelection(rawPassRequest)
  await h.entered.promise
  assertEvidencePreserved(h)
  assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation'])
  assert.equal(h.state.processing, true)
  assert.ok(h.context.activeJob.current)
  h.release.resolve()
  assert.equal(await pending, true)
  assert.equal(h.state.text, expected.text)
  for (const key of ['evidenceItems', 'rawOcrText', 'ocrWords']) assert.deepEqual(clone(h.state[key]), h.initial[key], `${key} cannot be changed by a working-pass choice`)
  assert.equal(h.state.evidenceItems[0].ocrPasses.length, 2)
  assert.equal(h.state.meta.officerNote, 'keep')
  for (const key of ['fieldReviews', 'placementReviews', 'quantitySpacing']) assert.deepEqual(clone(h.state.meta[key]), {})
  for (const key of ['allPanelsCaptured', 'classificationConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed']) assert.equal(h.state.meta[key], false)
  assert.equal(h.state.meta.ocrConfidence, null)
  assert.equal(h.state.meta.ocrEngineConfidence, null)
  assert.equal(h.state.meta.ocrSource, 'officer-selected-raw-passes')
  assert.equal(h.state.meta.quantity, 500)
  assert.equal(h.state.meta.unit, 'ml')
  assert.equal(h.state.meta.fieldCandidates.netQuantity.length, 2, 'Excluded historical disagreement remains visible, not erased')
  const event = h.state.auditChain.at(-1)
  assert.equal(event.type, 'working_ocr_passes_selected')
  assert.deepEqual(clone(event.payload.selectedPasses), expected.auditPayload.selectedPasses)
  assert.deepEqual(clone(event.payload.excludedPasses), expected.auditPayload.excludedPasses)
  assert.equal(event.payload.previousWorkingText, h.initial.text)
  assert.equal(event.payload.rawHistoryPreserved, true)
  assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false, 'Selecting an old pass is not a new recognition run')
  assert.equal(await verifyAuditChain(h.state.auditChain), true)
  assert.equal(h.context.activeJob.current, null)
  assert.equal(h.state.processing, false)
})

test('working raw-pass selection audit failure preserves all text, evidence and previous confirmations', async () => {
  const h = await rawSelectionHarness({ failType: 'working_ocr_passes_selected' })
  assert.equal(await h.handlers.applyRawPassSelection(rawPassRequest), false)
  assertEvidencePreserved(h)
  assert.match(h.state.ocrState.error, /Injected audit failure/)
  assert.equal(h.state.auditChain.some(event => event.type === 'working_ocr_passes_selected'), false)
  assert.equal(h.context.activeJob.current, null)
  assert.equal(h.state.processing, false)
})

for (const action of ['cancel', 'unmount']) {
  test(`working raw-pass selection ${action}: delayed audit cannot replace a transcript or clear its confirmations`, async () => {
    const h = await rawSelectionHarness({ pauseType: 'working_ocr_passes_selected' })
    const pending = h.handlers.applyRawPassSelection(rawPassRequest)
    await h.entered.promise
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const stoppedSetterCount = h.setters.length
    h.release.resolve()
    assert.equal(await pending, false)
    await h.context.auditQueue.current
    assertEvidencePreserved(h)
    assert.equal(h.state.auditChain.some(event => event.type === 'working_ocr_passes_selected'), false)
    assert.equal(await verifyAuditChain(h.state.auditChain), true)
    if (action === 'unmount') assert.equal(h.setters.length, stoppedSetterCount, 'Unmounted selection may not issue late state setters')
  })
}

test('working raw-pass selection rejects missing/stale IDs, supplied text and malformed selections before audit', async () => {
  const requests = [
    { selections: [{ panelId: 'old-panel', passId: 'crop-pass' }], reason: rawPassRequest.reason },
    { selections: [{ panelId: 'p1', passId: 'no-longer-present' }], reason: rawPassRequest.reason },
    { selections: [{ panelId: 'p1', passId: 'crop-pass', text: 'NET QTY 999ml' }], reason: rawPassRequest.reason },
    { selections: [{ panelId: 'p1', passId: 'crop-pass' }, { panelId: 'p1', passId: 'crop-pass' }], reason: rawPassRequest.reason },
    { selections: [], reason: rawPassRequest.reason },
    { ...rawPassRequest, reason: '' },
  ]
  for (const request of requests) {
    const h = await rawSelectionHarness()
    assert.equal(await h.handlers.applyRawPassSelection(request), false)
    assertEvidencePreserved(h)
    assert.ok(h.state.ocrState.error)
    assert.equal(h.state.auditChain.some(event => event.type === 'working_ocr_passes_selected'), false)
    assert.equal(h.context.activeJob.current, null)
    assert.equal(h.state.processing, false)
  }
})

test('working raw-pass selection cannot drop another panel with readable OCR', async () => {
  const h = await rawSelectionHarness()
  h.context.evidenceItems = [...h.context.evidenceItems, { id: 'p2', ocrPasses: [{ id: 'other-pass', text: 'PACKED ON 01/2026' }] }]
  assert.equal(await h.handlers.applyRawPassSelection(rawPassRequest), false)
  assert.match(h.state.ocrState.error, /panel 2/)
  assertEvidencePreserved(h)
  assert.equal(h.state.auditChain.some(event => event.type === 'working_ocr_passes_selected'), false)
})

test('working raw-pass selection cannot run while saved, saving, previewing or another job holds its lock', async () => {
  for (const blockedBy of ['saved', 'saving', 'paddlePreview', 'focusResult', 'activeJob']) {
    const h = await rawSelectionHarness()
    if (blockedBy === 'activeJob') h.context.activeJob.current = new AbortController()
    else h.context[blockedBy] = ['paddlePreview', 'focusResult'].includes(blockedBy) ? { pending: true } : true
    assert.equal(await h.handlers.applyRawPassSelection(rawPassRequest), false)
    assertEvidencePreserved(h)
    assert.equal(h.setters.length, 0)
    assert.equal(h.state.auditChain.some(event => event.type === 'working_ocr_passes_selected'), false)
  }
})

test('working raw-pass selection blocks draft restore while its audit is pending', async () => {
  const h = await rawSelectionHarness({ pauseType: 'working_ocr_passes_selected' })
  const pending = h.handlers.applyRawPassSelection(rawPassRequest)
  await h.entered.promise
  h.handlers.restoreDraft()
  assertEvidencePreserved(h)
  assert.match(h.state.draftMessage, /Finish or cancel/)
  h.handlers.cancelActiveJob(); h.release.resolve()
  assert.equal(await pending, false)
  await h.context.auditQueue.current
  assertEvidencePreserved(h)
})

test('guided retry resolves the current crop, not a stale event rectangle, and preserves raw evidence', async () => {
  const h = await harness({ pendingPreviews: false })
  const guidance = { id: 'guide-1', panelId: 'p1', imageUrl: photo.analysisUrl, method: 'heading-guided-focus-v1', field: 'netQuantity', rect: { x0: .1, y0: .1, x1: .9, y1: .9 }, sourceFrame: { width: 100, height: 80 }, headingIds: ['heading-1'] }
  h.context.paddlePreview = null
  h.context.paddleGuidance = [guidance]
  await h.handlers.runAlternativeOcr(true, { id: guidance.id, rect: { x0: 0, y0: 0, x1: 1, y1: 1 } })
  assert.equal(h.calls.length, 1)
  const input = await h.calls[0].inputFactory(photo)
  assert.deepEqual(clone(input.rect), guidance.rect)
  assert.equal(h.state.paddlePreview.guidedSuggestionId, guidance.id)
  assertEvidencePreserved(h)
})

test('guided retry rejects a changed image and cannot discard a pending preview', async () => {
  const h = await harness()
  h.context.paddleGuidance = [{ id: 'guide-1', panelId: 'p1', imageUrl: 'changed-image' }]
  await h.handlers.runAlternativeOcr(true, { id: 'guide-1' })
  assert.equal(h.calls.length, 0)
  assert.ok(h.state.paddlePreview)
  h.context.paddlePreview = null
  h.context.focusResult = null
  await h.handlers.runAlternativeOcr(true, { id: 'guide-1' })
  assert.equal(h.calls.length, 0)
  assert.match(h.state.ocrState.error, /image changed/)
  assert.equal(h.context.activeJob.current, null)
  assertEvidencePreserved(h)
})

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

test('fresh crop-first append populates unconfirmed package suggestions without altering its OCR or source', async () => {
  const h = await harness({ pauseType: 'ocr_completed' })
  const captured = [{ ...clone(photo), ocrText: '', ocrPasses: [], ocrWords: [] }]
  const rawCrop = 'COMMON NAME: OATS\nNET QTY. 100 g\nINGREDIENTS: OATS'
  const result = { ...clone(h.context.focusResult), output: { items: [{ ...clone(h.context.focusResult.output.items[0]), ocrText: rawCrop, ocrPasses: [{ id: 'focus-pass', text: rawCrop, confidence: 87 }] }] } }
  for (const [key, value] of Object.entries({ evidenceItems: captured, text: '', rawOcrText: '', ocrWords: [], paddlePreview: null, focusResult: result, meta: { ...h.context.meta, productName: '', category: 'general', quantity: '', unit: '', fieldReviews: {}, classificationConfirmed: false, rule3ApplicabilityConfirmed: false } })) {
    h.context[key] = h.state[key] = value
    h.initial[key] = clone(value)
  }
  h.context.activeEvidence = captured[0]
  const pending = h.handlers.appendFocusResult()
  await h.entered.promise
  assertEvidencePreserved(h)
  assert.equal(h.state.meta.quantity, '', 'Suggestions cannot publish before the completed audit')
  h.release.resolve()
  await pending
  assert.equal(h.state.meta.quantity, 100)
  assert.equal(h.state.meta.unit, 'g')
  assert.equal(h.state.meta.productName, 'OATS')
  assert.equal(h.state.meta.category, 'food')
  assert.equal(h.state.meta.classificationConfirmed, false)
  assert.equal(h.state.meta.rule3ApplicabilityConfirmed, false)
  assert.deepEqual(clone(h.state.meta.fieldReviews), {})
  assert.equal(h.state.meta.ocrConfidence, null)
  assert.equal(h.state.meta.ocrEngineConfidence, null)
  assert.equal(h.state.evidenceItems[0].originalUrl, photo.originalUrl)
  assert.equal(h.state.evidenceItems[0].analysisUrl, photo.analysisUrl)
  assert.equal(h.state.evidenceItems[0].ocrPasses.length, 1)
  assert.equal(h.state.evidenceItems[0].ocrPasses[0].text, rawCrop)
  assert.ok(h.state.rawOcrText.endsWith(rawCrop))
  assert.ok(h.state.text.endsWith(rawCrop))
  assert.equal(h.state.focusResult, null)
  assert.equal(h.state.auditChain.at(-1).payload.strategy, 'officer-selected-focus-append')
  assert.equal(await verifyAuditChain(h.state.auditChain), true)
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
    const h = await harness({ pauseType: 'alternative_ocr_requested', pendingPreviews: false })
    const task = h.handlers.runAlternativeOcr(); await h.entered.promise
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const setterCount = h.setters.length
    h.release.resolve(); await task; await h.context.auditQueue.current
    assertEvidencePreserved(h); assert.equal(h.calls.length, 0); assert.equal(h.state.paddlePreview, null)
    assert.equal(h.state.auditChain.some(event => event.type === 'alternative_ocr_requested'), false)
    if (action === 'unmount') assert.equal(h.setters.length, setterCount)
  })

  test(`Paddle runner ${action}: late progress and output cannot replace preserved evidence/preview`, async () => {
    const h = await harness({ pauseRunner: true, pendingPreviews: false })
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
  const h = await harness({ failType: 'alternative_ocr_requested', pendingPreviews: false })
  await h.handlers.runAlternativeOcr()
  assertEvidencePreserved(h); assert.equal(h.calls.length, 0)
  assert.equal(h.state.paddlePreview, null); assert.match(h.state.ocrState.error, /Injected audit failure/)
})

test('Paddle runner failure cannot claim completion or leave a stale preview', async () => {
  const h = await harness({ failRunner: true, pendingPreviews: false })
  await h.handlers.runAlternativeOcr()
  assertEvidencePreserved(h); assert.equal(h.state.paddlePreview, null)
  assert.match(h.state.ocrState.error, /Injected OCR failure/)
  assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
})

test('successful Paddle preview is separate from evidence and has no completed OCR provenance until append', async () => {
  const h = await harness({ pendingPreviews: false })
  await h.handlers.runAlternativeOcr()
  assertEvidencePreserved(h)
  assert.deepEqual(clone(h.state.paddlePreview.output), paddleOutput)
  assert.equal(h.state.auditChain.at(-1).type, 'alternative_ocr_requested')
  assert.equal(ocrProvenance(h.state).hasRun, false)
})

test('focused Paddle request checks current image identity and carries exact officer crop to its runner', async () => {
  const h = await harness({ pendingPreviews: false })
  await h.handlers.runAlternativeOcr(true)
  assertEvidencePreserved(h)
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].evidenceItems.length, 1)
  const input = await h.calls[0].inputFactory(photo)
  assert.deepEqual(clone(input.rect), h.initial.focusSelection.rect)
  assert.deepEqual(clone(h.state.auditChain.at(-1).payload.crop), h.initial.focusSelection.rect)
  const stale = await harness({ pendingPreviews: false }); stale.context.focusSelection = { ...stale.context.focusSelection, imageUrl: 'image:stale' }
  await stale.handlers.runAlternativeOcr(true)
  assert.equal(stale.calls.length, 0)
})

for (const preview of ['focusResult', 'paddlePreview']) {
  test(`every whole-panel, manual-region and guided scan refuses a pending ${preview} without audit or state changes`, async () => {
    const requests = [
      ['runStructuredOcr'], ['runOcr', 'standard'], ['runOcr', 'deep'], ['runConnectedOcr'], ['runFocusedOcr'],
      ['runAlternativeOcr', false], ['runAlternativeOcr', true],
      ['runAlternativeOcr', true, { id: 'guide-1' }],
      ['runAlternativeOcr', false, null, 'dark-ink'], ['runAlternativeOcr', true, null, 'dark-ink-90'],
    ]
    for (const [handler, ...args] of requests) {
      const h = await harness({ pendingPreviews: false })
      h.context[preview] = { pending: true }
      const pendingBefore = h.context[preview]
      await h.handlers[handler](...args)
      assert.equal(h.context[preview], pendingBefore, `${handler}: pending preview cannot be discarded`)
      assertEvidencePreserved(h)
      assert.equal(h.setters.length, 0, `${handler}: no state setters before the preview decision`)
      assert.equal(h.calls.length, 0, `${handler}: no recognition before the preview decision`)
      assert.equal(h.context.activeJob.current, null, `${handler}: no acquired job lock`)
      assert.deepEqual(clone(h.state.auditChain), clone(h.oldChain), `${handler}: no new audit event`)
    }
  })
}

test('structured OCR publishes automatic candidates only after completion audit and invalidates every prior confirmation', async () => {
  const h = await harness({ pauseType: 'ocr_completed', pendingPreviews: false })
  const pending = h.handlers.runStructuredOcr()
  await h.entered.promise
  assertEvidencePreserved(h)
  assert.equal(h.calls.length, 1)
  assert.equal(h.state.ocrState.running, true)
  assert.equal(h.state.auditChain.at(-1).type, 'ocr_requested')
  assert.equal(h.state.auditChain.at(-1).payload.strategy, 'machine-structured-candidates-v1')
  h.release.resolve()
  await pending
  assert.match(h.state.text, /MACHINE LAYOUT CANDIDATES · UNVERIFIED/)
  assert.doesNotMatch(h.state.text, /OFFICER-SELECTED/)
  assert.ok(h.state.text.startsWith(h.initial.text))
  assert.ok(h.state.rawOcrText.startsWith(h.initial.rawOcrText))
  assert.ok(h.state.rawOcrText.endsWith(paddleParsed.text))
  assert.equal(h.state.rawOcrText.includes(proposal.text), false)
  assert.equal(h.state.evidenceItems[0].ocrPasses[0].text, photo.ocrPasses[0].text)
  assert.equal(h.state.evidenceItems[0].ocrPasses.at(-1).text, paddleParsed.text)
  assert.equal(h.state.evidenceItems[0].originalUrl, photo.originalUrl)
  assert.equal(h.state.meta.officerNote, 'keep')
  for (const key of ['fieldReviews', 'placementReviews', 'quantitySpacing']) assert.deepEqual(clone(h.state.meta[key]), {})
  for (const key of ['allPanelsCaptured', 'classificationConfirmed', 'rule3ApplicabilityConfirmed', 'placementPdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed']) assert.equal(h.state.meta[key], false, key)
  assert.equal(h.state.meta.ocrSource, 'local-paddle-structured')
  assert.equal(h.state.meta.ocrConfidence, null)
  assert.equal(h.state.meta.ocrEngineConfidence, null)
  const event = h.state.auditChain.at(-1)
  assert.equal(event.type, 'ocr_completed')
  assert.equal(event.payload.strategy, 'machine-structured-candidates-v1')
  assert.deepEqual(clone(event.payload.reviewedRows), [])
  assert.equal(event.payload.candidateRows.length, 1)
  assert.equal(event.payload.candidateRows[0].method, 'system-derived-geometric-candidate')
  assert.equal(event.payload.candidateRows[0].requiresOfficerReview, true)
  assert.equal(event.payload.candidateRows[0].eligibleForAutomaticVerdict, false)
  assert.deepEqual(clone(event.payload.candidateRows[0].parts), paddleParsed.lines.map(({ id, text, box }) => ({ id, text, box })))
  assert.equal(event.payload.rawHistoryUnchanged, true)
  assert.equal(event.payload.reliability, null)
  assert.equal(event.payload.engineConfidence, null)
  assert.equal(ocrProvenance(h.state).hasRun, true)
  assert.equal(await verifyAuditChain(h.state.auditChain), true)
  assert.equal(h.state.ocrState.running, false)
  assert.equal(h.context.activeJob.current, null)
  assert.equal(h.state.paddlePreview, null, 'Automatic candidates do not pretend that a preview was accepted')
})

for (const action of ['cancel', 'unmount']) {
  test(`structured request-audit ${action} prevents recognition and late evidence publication`, async () => {
    const h = await harness({ pauseType: 'ocr_requested', pendingPreviews: false })
    const pending = h.handlers.runStructuredOcr()
    await h.entered.promise
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const stoppedSetters = h.setters.length
    h.release.resolve(); await pending; await h.context.auditQueue.current
    assertEvidencePreserved(h)
    assert.equal(h.calls.length, 0)
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed' || event.type === 'ocr_requested'), false)
    if (action === 'unmount') assert.equal(h.setters.length, stoppedSetters)
    assert.equal(await verifyAuditChain(h.state.auditChain), true)
  })

  test(`structured runner ${action} suppresses late model progress and output`, async () => {
    const h = await harness({ pauseRunner: true, pendingPreviews: false })
    const pending = h.handlers.runStructuredOcr()
    await h.runnerEntered.promise
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const stoppedSetters = h.setters.length
    h.calls[0].onProgress({ running: true, progress: 99, label: 'STALE MACHINE CALLBACK' })
    h.runnerRelease.resolve(); await pending; await h.context.auditQueue.current
    assertEvidencePreserved(h)
    assert.notEqual(h.state.ocrState.label, 'STALE MACHINE CALLBACK')
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
    assert.equal(h.state.paddlePreview, null)
    if (action === 'unmount') assert.equal(h.setters.length, stoppedSetters)
    assert.equal(await verifyAuditChain(h.state.auditChain), true)
  })

  test(`structured completion-audit ${action} prevents the prepared machine candidates from publishing`, async () => {
    const h = await harness({ pauseType: 'ocr_completed', pendingPreviews: false })
    const pending = h.handlers.runStructuredOcr()
    await h.entered.promise
    assertEvidencePreserved(h)
    if (action === 'cancel') h.handlers.cancelActiveJob(); else h.handlers.unmount()
    const stoppedSetters = h.setters.length
    h.release.resolve(); await pending; await h.context.auditQueue.current
    assertEvidencePreserved(h)
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
    if (action === 'unmount') assert.equal(h.setters.length, stoppedSetters)
    assert.equal(await verifyAuditChain(h.state.auditChain), true)
  })
}

for (const failType of ['ocr_requested', 'ocr_completed']) {
  test(`structured ${failType} failure preserves original evidence and cannot claim completion`, async () => {
    const h = await harness({ failType, pendingPreviews: false })
    await h.handlers.runStructuredOcr()
    assertEvidencePreserved(h)
    assert.equal(h.calls.length, failType === 'ocr_requested' ? 0 : 1)
    assert.equal(h.state.auditChain.some(event => event.type === 'ocr_completed'), false)
    assert.match(h.state.ocrState.error, /Injected audit failure/)
    assert.equal(h.state.ocrState.running, false)
    assert.equal(h.context.activeJob.current, null)
    assert.equal(await verifyAuditChain(h.state.auditChain), true)
  })
}

test('structured runner failure preserves evidence, and its job lock prevents overlapping scans', async () => {
  const failed = await harness({ failRunner: true, pendingPreviews: false })
  await failed.handlers.runStructuredOcr()
  assertEvidencePreserved(failed)
  assert.match(failed.state.ocrState.error, /Injected OCR failure/)
  assert.equal(failed.state.auditChain.some(event => event.type === 'ocr_completed'), false)
  assert.equal(failed.context.activeJob.current, null)
  const h = await harness({ pauseRunner: true, pendingPreviews: false })
  const first = h.handlers.runStructuredOcr(); await h.runnerEntered.promise
  await h.handlers.runStructuredOcr()
  assert.equal(h.calls.length, 1)
  h.handlers.restoreDraft()
  assert.match(h.state.draftMessage, /Finish or cancel/)
  assertEvidencePreserved(h)
  h.handlers.cancelActiveJob(); h.runnerRelease.resolve(); await first; await h.context.auditQueue.current
  assertEvidencePreserved(h)
})

test('draft restore preserves unresolved OCR previews and does not drop a queued audit', async () => {
  const h = await harness({ pauseType: 'officer_note' })
  const pending = h.handlers.recordAudit('officer_note')
  await h.entered.promise
  await h.handlers.restoreDraft()
  assert.match(h.state.draftMessage, /Append or dismiss/)
  assertEvidencePreserved(h)
  assert.equal(h.context.auditGeneration.current, 0)
  for (const key of ['focusResult', 'focusSelection', 'paddlePreview']) assert.deepEqual(clone(h.state[key]), h.initial[key])
  h.release.resolve(); await pending
  assert.equal(h.state.auditChain.at(-1).type, 'officer_note')
  assert.equal(await verifyAuditChain(h.state.auditChain), true)
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
