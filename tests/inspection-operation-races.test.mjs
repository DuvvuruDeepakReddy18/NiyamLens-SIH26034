import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { appendAuditEvent, verifyAuditChain } from '../src/lib/audit.mjs'
import { abortError, throwIfAborted } from '../src/lib/ocrLifecycle.mjs'
import { EMPTY_OCR, invalidateCapturedEvidence } from '../src/lib/inspectionWorkflow.mjs'
import { validateCloseUpCapture } from '../src/lib/captureCoach.mjs'

// These are exact-current-closure software tests, NOT React, browser, image
// decoding, or device tests. Only the component's relevant JS declarations are
// extracted. State setters are synchronous test doubles; image work is mocked;
// actual audit hashing is delayed to deterministically exercise cancellation.
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const names = ['cancelActiveJob', 'recordAudit', 'beginEvidenceRecord', 'handleFiles', 'applyDemo', 'transformActiveEvidence', 'rectifyActiveEvidence', 'rectifyFromBarcode', 'autoDetectReference']
const declarations = names.map(name => {
  const marker = `  const ${name} =`
  const start = app.indexOf(marker)
  assert.ok(start >= 0, `Missing actual App.jsx declaration ${name}; update the harness after a component refactor.`)
  // A top-level two-space declaration ends before the next sibling declaration
  // or intervening useEffect. Nested declarations have greater indentation.
  const rest = app.slice(start)
  const boundary = rest.indexOf('\n  }')
  assert.ok(boundary >= 0, `Cannot locate declaration end: ${name}`)
  return rest.slice(0, boundary + '\n  }'.length)
}).join('\n')
const pendingPreviewExpression = app.match(/  const ocrPreviewPending = ([^\r\n]+)/)?.[1]
assert.ok(pendingPreviewExpression, 'Missing exact App pending-preview expression; update the source harness after a refactor.')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const photo = id => ({ id, name: `${id}.jpg`, analysisUrl: `image:${id}`, originalUrl: `original:${id}`, sha256: 'a'.repeat(64), quality: { score: 80 }, width: 100, height: 100 })
const demo = { imageUrl: 'controlled.svg', fileName: 'controlled.svg', text: 'CONTROLLED TEXT', meta: {} }

async function harness({ empty = false, pauseType = '', pauseOccurrence = 1, failType = '' } = {}) {
  const oldChain = await appendAuditEvent([], 'old_observation', {}, 'officer')
  const state = {
    inspectionId: 'old-id', startedAt: '2026-09-01T00:00:00.000Z',
    evidenceItems: empty ? [] : [photo('old-photo')], text: 'ORIGINAL TEXT', rawOcrText: 'ORIGINAL RAW',
    meta: { officerNote: 'keep', panelMeasurements: { 'old-photo': { referencePx: 20 } } },
    ocrWords: [{ panelId: 'old-photo' }], auditChain: oldChain,
    barcodeState: { message: 'ean · detected', candidate: { evidenceId: 'old-photo', format: 'ean_13' } },
    focusResult: null, paddlePreview: null,
  }
  const entered = deferred(); const release = deferred(); let occurrences = 0
  const captureCalls = []
  const context = {
    ...state, saved: false, saving: false, workspace: null, challenge: null,
    activeEvidence: state.evidenceItems[0], actor: { id: 'officer' },
    activeJob: { current: null }, auditRef: { current: oldChain }, auditQueue: { current: Promise.resolve() }, auditGeneration: { current: 0 },
    fileInput: { current: { value: 'selected-file' } },
    AbortController, abortError, throwIfAborted, EMPTY_OCR, INITIAL_META: {}, invalidateCapturedEvidence, validateCloseUpCapture,
    CAPTURE_REQUIREMENTS: [{ id: 'front' }, { id: 'back' }, { id: 'side' }],
    createInspectionId: () => 'new-id', processImage: async () => 'new-image',
    analyzeImageQuality: async () => ({ width: 100, height: 100, score: 80 }),
    boundedOcr: async promise => promise,
    evidenceFromFile: async (file, options) => {
      captureCalls.push({ file, options })
      if (pauseType === 'evidence_decode') { entered.resolve(); await release.promise }
      if (failType === 'evidence_decode') throw new Error('Injected image decoding failure')
      return photo(file.id)
    },
    appendAuditEvent: async (...args) => {
      if (args[1] === failType) throw new Error('Injected audit failure')
      if (args[1] === pauseType && ++occurrences === pauseOccurrence) { entered.resolve(); await release.promise }
      return appendAuditEvent(...args)
    },
    reprocessEvidence: async item => ({ ...item, analysisUrl: 'changed-image', rotation: 90 }),
    rectifyEvidence: async item => ({ ...item, analysisUrl: 'changed-image', perspective: { method: 'manual', points: [] } }),
    rectifyEvidenceFromBarcode: async item => ({ ...item, analysisUrl: 'changed-image', perspective: { method: 'barcode', points: [] } }),
    detectReferenceCard: async () => ({ detected: true, pixelWidth: 90, confidence: 90 }),
    invalidatePanelMeasurement: id => { state.measurementInvalidated = id },
    updatePanelMeasurement: (key, value) => { state.measurementUpdated = { key, value } },
  }
  const setters = []
  for (const key of ['InspectionId', 'DraftChallengeId', 'StartedAt', 'Saved', 'AuditChain', 'Processing', 'OcrState', 'EvidenceItems', 'ActiveEvidenceId', 'OcrWords', 'Text', 'RawOcrText', 'Meta', 'BarcodeState']) {
    const stateKey = key[0].toLowerCase() + key.slice(1)
    context[`set${key}`] = value => { setters.push(key); state[stateKey] = typeof value === 'function' ? value(state[stateKey]) : value }
  }
  Object.defineProperty(context, 'ocrPreviewPending', { get: runInNewContext(`() => (${pendingPreviewExpression})`, context, { timeout: 1000 }) })
  const handlers = runInNewContext(`${declarations}\n({${names.join(',')}})`, context, { timeout: 1000, filename: 'App.jsx-extracted-operation-closures.js' })
  const cancel = async task => {
    await entered.promise
    handlers.cancelActiveJob()
    release.resolve()
    await task
    await context.auditQueue.current
  }
  return { context, state, handlers, entered, release, cancel, oldChain, setters, captureCalls }
}

function assertPreserved(h, expectedPhotoCount = 1) {
  assert.equal(h.state.inspectionId, 'old-id')
  assert.equal(h.state.startedAt, '2026-09-01T00:00:00.000Z')
  assert.equal(h.state.evidenceItems.length, expectedPhotoCount)
  if (expectedPhotoCount) assert.equal(h.state.evidenceItems[0].analysisUrl, 'image:old-photo')
  assert.equal(h.state.text, 'ORIGINAL TEXT')
  assert.equal(h.state.rawOcrText, 'ORIGINAL RAW')
  assert.equal(h.context.auditRef.current[0].hash, h.oldChain[0].hash)
  assert.equal(h.context.auditGeneration.current, 0)
  assert.equal(h.state.measurementInvalidated, undefined)
  assert.equal(h.state.measurementUpdated, undefined)
}

test('controlled replacement cancellation retains prior ID, evidence, text and audit chain', async () => {
  const h = await harness({ pauseType: 'controlled_packet_loaded' })
  await h.cancel(h.handlers.applyDemo(demo))
  assertPreserved(h)
  assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation', 'processing_cancelled'])
  assert.equal(await verifyAuditChain(h.context.auditRef.current), true)
})

test('controlled replacement audit failure preserves prior inspection instead of partially resetting it', async () => {
  const h = await harness({ failType: 'controlled_packet_loaded' })
  await h.handlers.applyDemo(demo)
  assertPreserved(h)
  assert.match(h.state.ocrState.error, /Injected audit failure/)
})

test('successful controlled replacement commits a fresh valid audit and new evidence together', async () => {
  const h = await harness()
  await h.handlers.applyDemo(demo)
  assert.equal(h.state.inspectionId, 'new-id')
  assert.equal(h.state.text, 'CONTROLLED TEXT')
  assert.equal(h.state.evidenceItems[0].analysisUrl, 'new-image')
  assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['controlled_packet_loaded'])
  assert.equal(await verifyAuditChain(h.context.auditRef.current), true)
})

for (const stage of [{ pauseType: 'inspection_started' }, { pauseType: 'evidence_captured', pauseOccurrence: 2 }]) {
  test(`first capture cancelled during ${stage.pauseType} preserves prior ID/audit and publishes no partial panels`, async () => {
    const h = await harness({ empty: true, ...stage })
    await h.cancel(h.handlers.handleFiles([{ id: 'one' }, { id: 'two' }]))
    assertPreserved(h, 0)
    assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation', 'processing_cancelled'])
  })
}

test('successful first multi-panel capture publishes every panel with a fresh complete valid audit', async () => {
  const h = await harness({ empty: true })
  await h.handlers.handleFiles([{ id: 'one' }, { id: 'two' }])
  assert.equal(h.state.inspectionId, 'new-id')
  assert.equal(h.state.evidenceItems.map(item => item.id).join(','), 'one,two')
  assert.equal(h.state.text, '')
  assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['inspection_started', 'evidence_captured', 'evidence_captured'])
  assert.equal(await verifyAuditChain(h.context.auditRef.current), true)
})

for (const preview of ['focusResult', 'paddlePreview']) {
  test(`pending ${preview} blocks source additions, replacements, controlled packets and image transforms`, async () => {
    const requests = [
      ['handleFiles', [{ id: 'added' }]], ['handleFiles', [{ id: 'replacement' }], { replaceId: 'old-photo' }],
      ['applyDemo', demo], ['transformActiveEvidence', { rotation: 90 }],
      ['rectifyActiveEvidence', []], ['rectifyFromBarcode'],
    ]
    for (const [handler, ...args] of requests) {
      const h = await harness()
      const pending = { pending: true }
      h.context[preview] = pending
      await h.handlers[handler](...args)
      assertPreserved(h)
      assert.equal(h.context[preview], pending, `${handler}: pending preview must not be discarded`)
      assert.equal(h.setters.length, 0, `${handler}: no source/state writes before preview decision`)
      assert.equal(h.context.activeJob.current, null, `${handler}: no acquired source-operation lock`)
      assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation'], `${handler}: no audit mutation`)
      assert.equal(await verifyAuditChain(h.state.auditChain), true)
    }
  })
}

for (const [handler, pauseType, argument] of [
  ['transformActiveEvidence', 'image_preprocessing_changed', { rotation: 90 }],
  ['rectifyActiveEvidence', 'perspective_rectified', []],
  ['rectifyFromBarcode', 'barcode_plane_rectified'],
  ['autoDetectReference', 'reference_card_detected'],
]) {
  test(`${handler} cancellation during audit cannot publish image or calibration changes`, async () => {
    const h = await harness({ pauseType })
    await h.cancel(h.handlers[handler](argument))
    assertPreserved(h)
    assert.equal(h.context.auditRef.current.some(event => event.type === pauseType), false)
  })
}

for (const scenario of ['cancel', 'new-inspection', 'unmount']) {
  test(`delayed OCR audit cannot publish after ${scenario}`, async () => {
    const h = await harness({ pauseType: 'ocr_completed' })
    const controller = new AbortController(); h.context.activeJob.current = controller
    const task = h.handlers.recordAudit('ocr_completed')
    const rejected = assert.rejects(task, { name: 'AbortError' })
    await h.entered.promise
    controller.abort(); h.context.activeJob.current = null
    if (scenario === 'new-inspection') h.handlers.beginEvidenceRecord()
    if (scenario === 'unmount') h.context.auditGeneration.current += 1
    h.release.resolve(); await rejected
    assert.equal(h.context.auditRef.current.some(event => event.type === 'ocr_completed'), false)
    if (scenario === 'new-inspection') {
      await h.handlers.recordAudit('inspection_started')
      assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['inspection_started'])
    } else assert.equal(h.context.auditRef.current[0].hash, h.oldChain[0].hash)
  })
}

for (const target of ['mrp', 'netQuantity', 'packDate']) {
  test(`guided ${target} close-up adds one source photo without replacing previous readings or fabricating an OCR answer`, async () => {
    const h = await harness()
    const oldPhoto = h.state.evidenceItems[0]
    oldPhoto.ocrText = 'OLD UNCHANGED READING'
    oldPhoto.ocrPasses = [{ text: 'OLD RAW PASS', provider: 'fixture' }]
    const before = structuredClone(oldPhoto)
    h.state.meta.fieldReviews = { [target]: { state: 'confirmed', value: 'old', reason: 'Previous photo review' } }
    h.state.meta.measurementConfirmed = true
    await h.handlers.handleFiles([{ id: 'new-close-up' }], { captureTarget: target })
    assert.equal(h.state.inspectionId, 'old-id')
    assert.equal(h.state.evidenceItems.length, 2)
    assert.deepEqual(h.state.evidenceItems[0], before)
    assert.equal(h.state.evidenceItems[1].id, 'new-close-up')
    assert.equal(h.state.text, 'ORIGINAL TEXT')
    assert.equal(h.state.rawOcrText, 'ORIGINAL RAW')
    assert.equal(h.captureCalls.length, 1)
    assert.ok(h.captureCalls[0].options.signal instanceof AbortSignal)
    assert.equal(h.state.meta.measurementConfirmed, false)
    assert.deepEqual(h.state.meta.fieldReviews, {})
    assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation', 'evidence_captured'])
    const captured = h.context.auditRef.current[1].payload
    assert.deepEqual(captured.capturePurpose, { target, kind: 'officer-requested-additional-close-up', originalEvidencePreserved: true, suppliesOcrAnswer: false })
    assert.equal(captured.sha256, h.state.evidenceItems[1].sha256)
    assert.equal(Object.hasOwn(captured, 'value'), false)
    assert.equal(Object.hasOwn(h.state.evidenceItems[1], 'ocrText'), false)
    assert.equal(await verifyAuditChain(h.context.auditRef.current), true)
    assert.match(h.state.ocrState.label, /previous photographs and readings retained/)
  })
}

for (const scenario of [
  { name: 'unsupported declaration target', target: 'expiryDate', count: 1 },
  { name: 'attempted replacement of original evidence', target: 'mrp', count: 1, replaceId: 'old-photo' },
  { name: 'multiple selected photos', target: 'mrp', count: 2 },
  { name: 'multiple photos despite only one remaining slot', target: 'mrp', count: 2, panelCount: 3 },
]) {
  test(`guided capture rejects ${scenario.name} before image work or audit`, async () => {
    const h = await harness()
    while (h.state.evidenceItems.length < (scenario.panelCount || 1)) h.state.evidenceItems.push(photo(`prior-${h.state.evidenceItems.length}`))
    const previousMeta = structuredClone(h.state.meta)
    await h.handlers.handleFiles(Array.from({ length: scenario.count }, (_, i) => ({ id: `new-${i}` })), { captureTarget: scenario.target, replaceId: scenario.replaceId || '' })
    assertPreserved(h, scenario.panelCount || 1)
    assert.deepEqual(h.state.meta, previousMeta)
    assert.equal(h.captureCalls.length, 0)
    assert.equal(h.context.activeJob.current, null)
    assert.equal(h.context.auditRef.current.length, 1)
    assert.match(h.state.ocrState.error, /close-up|one new close-up/)
  })
}

test('guided close-up at the four-panel limit cannot drop an earlier panel or start decoding', async () => {
  const h = await harness()
  while (h.state.evidenceItems.length < 4) h.state.evidenceItems.push(photo(`prior-${h.state.evidenceItems.length}`))
  const before = structuredClone(h.state.evidenceItems)
  await h.handlers.handleFiles([{ id: 'fifth' }], { captureTarget: 'mrp' })
  assertPreserved(h, 4)
  assert.deepEqual(h.state.evidenceItems, before)
  assert.equal(h.captureCalls.length, 0)
  assert.equal(h.context.auditRef.current.length, 1)
  assert.equal(h.setters.length, 0)
})

test('guided close-up without an original panel cannot create a falsely linked first capture', async () => {
  const h = await harness({ empty: true })
  await h.handlers.handleFiles([{ id: 'ungrounded-close-up' }], { captureTarget: 'packDate' })
  assertPreserved(h, 0)
  assert.equal(h.captureCalls.length, 0)
  assert.equal(h.context.auditRef.current.length, 1)
  assert.match(h.state.ocrState.error, /needs a captured panel/)
})

for (const pauseType of ['evidence_decode', 'evidence_captured']) {
  test(`guided close-up cancellation during ${pauseType} preserves all original evidence and records no successful capture`, async () => {
    const h = await harness({ pauseType })
    const oldMeta = structuredClone(h.state.meta)
    const before = structuredClone(h.state.evidenceItems)
    await h.cancel(h.handlers.handleFiles([{ id: 'cancelled-close-up' }], { captureTarget: 'netQuantity' }))
    assertPreserved(h)
    assert.deepEqual(h.state.evidenceItems, before)
    assert.deepEqual(h.state.meta, oldMeta)
    assert.equal(h.captureCalls.length, 1)
    assert.equal(h.captureCalls[0].options.signal.aborted, true)
    assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation', 'processing_cancelled'])
    assert.equal(await verifyAuditChain(h.context.auditRef.current), true)
    assert.equal(h.context.activeJob.current, null)
  })
}

for (const failType of ['evidence_decode', 'evidence_captured']) {
  test(`guided close-up ${failType} failure publishes no image or partial capture purpose`, async () => {
    const h = await harness({ failType })
    const oldMeta = structuredClone(h.state.meta)
    await h.handlers.handleFiles([{ id: 'failed-close-up' }], { captureTarget: 'mrp' })
    assertPreserved(h)
    assert.deepEqual(h.state.meta, oldMeta)
    assert.deepEqual(h.context.auditRef.current.map(event => event.type), ['old_observation'])
    assert.match(h.state.ocrState.error, /Injected/)
  })
}
