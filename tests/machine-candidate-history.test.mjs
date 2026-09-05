import test from 'node:test'
import assert from 'node:assert/strict'
import { machineCandidateHistory, MACHINE_HISTORY_LIMITS } from '../src/lib/machineCandidateHistory.mjs'

const candidate = () => ({ panelId: 'p1', field: 'netQuantity', text: 'NET QUANTITY: 250 g', sourceIds: ['h', 'v'], parts: [{ id: 'h', text: 'NET QUANTITY:' }, { id: 'v', text: '250 g' }], method: 'system-derived-geometric-candidate', requiresOfficerReview: true, eligibleForAutomaticVerdict: false })
const event = () => ({ type: 'ocr_completed', payload: { strategy: 'machine-structured-candidates-v1', candidateRows: [candidate()], reviewedRows: [], warnings: [], requiresOfficerReview: true } })
const unavailable = chain => {
  const result = machineCandidateHistory(chain)
  assert.equal(result.status, 'unavailable')
  assert.equal(result.verified, false)
  assert.equal(result.historical, true)
  assert.deepEqual(result.rows, [])
  assert.ok(result.reason)
}

test('machine history projects bounded primitive display values without claiming verification', () => {
  const input = [event()]; const original = structuredClone(input)
  const result = machineCandidateHistory(input)
  assert.equal(result.status, 'available')
  assert.equal(result.verified, false)
  assert.equal(result.historical, true)
  assert.equal(result.rows[0].label, 'Net quantity')
  assert.equal(result.rows[0].text, 'NET QUANTITY: 250 g')
  assert.deepEqual(result.rows[0].sourceIds, ['h', 'v'])
  assert.equal(result.rows[0].requiresOfficerReview, true)
  assert.equal(result.rows[0].eligibleForAutomaticVerdict, false)
  result.rows[0].sourceIds.push('unrelated')
  assert.deepEqual(input, original)
})

test('no machine history is distinct from an explicitly empty successful association record', () => {
  assert.equal(machineCandidateHistory().status, 'none')
  assert.equal(machineCandidateHistory([{ type: 'note', payload: {} }]).status, 'none')
  const empty = event(); empty.payload.candidateRows = []
  const result = machineCandidateHistory([empty])
  assert.equal(result.status, 'available')
  assert.equal(result.rows.length, 0)
  assert.equal(result.verified, false)
})

test('latest malformed machine record cannot fall back to an older successful record', () => {
  const broken = event(); broken.payload.candidateRows = null
  unavailable([event(), broken])
  unavailable([event(), { type: 'ocr_completed', payload: null }])
  unavailable([event(), null])
  unavailable([event(), { type: 'ocr_completed', payload: {} }])
  const newer = event(); newer.payload.candidateRows = []
  assert.equal(machineCandidateHistory([event(), newer]).rows.length, 0)
})

test('later ordinary OCR is disclosed rather than relabelling historical machine candidates as current', () => {
  const result = machineCandidateHistory([event(), { type: 'ocr_completed', payload: { strategy: 'standard' } }, { type: 'note', payload: {} }])
  assert.equal(result.status, 'available')
  assert.equal(result.eventIndex, 0)
  assert.equal(result.laterOcrCompletions, 1)
  assert.equal(result.historical, true)
  assert.equal(result.verified, false)
})

test('null, objects, sparse arrays and oversized history fail closed without coercion', () => {
  for (const chain of [null, {}, 'history', new Array(2), new Array(MACHINE_HISTORY_LIMITS.events + 1)]) unavailable(chain)
  const accessorArray = []
  Object.defineProperty(accessorArray, 0, { get: () => { throw new Error('Do not execute getters') } })
  unavailable(accessorArray)
})

test('object-valued field, text, panel, fragment and warnings never escape into React children', () => {
  for (const mutate of [
    e => { e.payload.candidateRows[0].field = {} },
    e => { e.payload.candidateRows[0].field = '__proto__' },
    e => { e.payload.candidateRows[0].text = {} },
    e => { e.payload.candidateRows[0].panelId = {} },
    e => { e.payload.candidateRows[0].parts = {} },
    e => { e.payload.candidateRows[0].parts[0] = null },
    e => { e.payload.candidateRows[0].parts[0].id = {} },
    e => { e.payload.candidateRows[0].parts[0].text = {} },
    e => { e.payload.candidateRows[0].sourceIds = null },
    e => { e.payload.warnings = [{}] },
    e => { e.payload.reviewedRows = null },
    e => { e.payload.requiresOfficerReview = false },
    e => { e.payload.candidateRows[0].eligibleForAutomaticVerdict = true },
  ]) {
    const input = event(); mutate(input); unavailable([input])
  }
})

test('display caps reject oversized candidates, fragments, identifiers and warnings without silent truncation', () => {
  for (const mutate of [
    e => { e.payload.candidateRows = Array.from({ length: 51 }, candidate) },
    e => { e.payload.candidateRows[0].parts = Array(13).fill({ id: 'h', text: 'x' }) },
    e => { e.payload.candidateRows[0].text = 'x'.repeat(MACHINE_HISTORY_LIMITS.text + 1) },
    e => { e.payload.candidateRows[0].parts[0].text = 'x'.repeat(MACHINE_HISTORY_LIMITS.partText + 1) },
    e => { e.payload.candidateRows[0].panelId = 'x'.repeat(MACHINE_HISTORY_LIMITS.identifier + 1) },
    e => { e.payload.warnings = Array(51).fill('warning') },
    e => { e.payload.warnings = ['x'.repeat(MACHINE_HISTORY_LIMITS.warningText + 1)] },
  ]) { const input = event(); mutate(input); unavailable([input]) }
})

test('tampered association text, source-ID disagreement and source reuse are not displayed as valid candidates', () => {
  const changed = event(); changed.payload.candidateRows[0].text = 'NET QUANTITY: 999 g'; unavailable([changed])
  const wrongId = event(); wrongId.payload.candidateRows[0].sourceIds[1] = 'elsewhere'; unavailable([wrongId])
  const reused = event(); reused.payload.candidateRows.push(candidate()); unavailable([reused])
  const officerClaim = event(); officerClaim.payload.reviewedRows = [candidate()]; unavailable([officerClaim])
})

test('accessor payload fields are unavailable without executing their getters', () => {
  const input = event()
  Object.defineProperty(input.payload, 'candidateRows', { get: () => { throw new Error('Do not invoke restored payload getter') } })
  unavailable([input])
  const row = event()
  Object.defineProperty(row.payload.candidateRows[0], 'text', { get: () => { throw new Error('Do not invoke row getter') } })
  unavailable([row])
  const coercion = event()
  coercion.payload.candidateRows[0].parts[0].id = { toJSON: () => { throw new Error('Do not coerce an object-valued identifier') } }
  unavailable([coercion])
  const cyclic = {}; cyclic.self = cyclic
  const cyclicId = event(); cyclicId.payload.candidateRows[0].parts[0].id = cyclic
  unavailable([cyclicId])
})

test('literal markup stays text in the projection, with warning and attribution intact', () => {
  const input = event()
  input.payload.warnings = ['<img src=x onerror=alert(1)>']
  const result = machineCandidateHistory([input])
  assert.equal(result.status, 'available')
  assert.equal(result.warnings[0], '<img src=x onerror=alert(1)>')
  assert.equal(result.verified, false)
})

test('valid boundary-sized records stay available without dropping rows or warnings', () => {
  const input = event()
  input.payload.candidateRows = Array.from({ length: MACHINE_HISTORY_LIMITS.rows }, (_, index) => {
    const row = candidate()
    row.sourceIds = [`h-${index}`, `v-${index}`]
    row.parts[0].id = row.sourceIds[0]; row.parts[1].id = row.sourceIds[1]
    return row
  })
  input.payload.warnings = Array(MACHINE_HISTORY_LIMITS.warnings).fill('x'.repeat(MACHINE_HISTORY_LIMITS.warningText))
  const result = machineCandidateHistory([input])
  assert.equal(result.status, 'available')
  assert.equal(result.rows.length, MACHINE_HISTORY_LIMITS.rows)
  assert.equal(result.warnings.length, MACHINE_HISTORY_LIMITS.warnings)
})
