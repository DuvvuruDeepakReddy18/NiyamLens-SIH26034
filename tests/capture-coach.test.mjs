import test from 'node:test'
import assert from 'node:assert/strict'
import { captureTargets, fieldReviewComplete } from '../src/lib/captureCoach.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { singleFlight } from '../src/lib/singleFlight.mjs'

test('capture coach keeps three critical headings and never labels parser output verified', () => {
  const rows = captureTargets(extractDeclarations('NET QTY 100 g\nMRP Rs 40.00\nPKD 08/2026'))
  assert.equal(rows.length, 3)
  assert.ok(rows.every(row => row.issue === 'Compare with photo'))
  assert.match(rows[1].guidance, /serving sizes/)
})
test('missing and conflicting declarations have explicit source-focused recovery', () => {
  const rows = captureTargets({ byId: { mrp: { conflict: true } } })
  assert.equal(rows[0].issue, 'Conflicting readings')
  assert.equal(rows[1].issue, 'Not detected')
  assert.ok(rows.every(row => row.needsCapture))
})

test('pre-OCR capture targets cannot imply detection, absence or recovered values', () => {
  const rows = captureTargets(extractDeclarations('MRP 40\nNET QTY 100 g'), { hasReading: false })
  assert.equal(rows.length, 3)
  assert.ok(rows.every(row => row.issue === 'Not read yet' && row.value === '' && row.needsCapture))
  assert.deepEqual(rows.map(row => row.id), ['mrp', 'netQuantity', 'packDate'])
})
test('review filtering never hides stale, unsupported absence or unreadable evidence', () => {
  const field = { id: 'mrp', detected: true, value: '40.00' }
  const meta = { fieldReviews: { mrp: { state: 'confirmed', value: '40.00', reason: 'Back panel visually checked' } } }
  assert.equal(fieldReviewComplete(field, meta), true)
  assert.equal(fieldReviewComplete({ ...field, value: '49.00' }, meta), false)
  assert.equal(fieldReviewComplete({ ...field, conflict: true }, meta), false)
  assert.equal(fieldReviewComplete(field, { fieldReviews: { mrp: { ...meta.fieldReviews.mrp, state: 'unreadable' } } }), false)
  const absent = { fieldReviews: { mrp: { state: 'absent', value: '', reason: 'Checked all sides of the physical package' } } }
  assert.equal(fieldReviewComplete({ id: 'mrp', value: '', detected: false }, absent), false)
  assert.equal(fieldReviewComplete({ id: 'mrp', value: '', detected: false }, { ...absent, allPanelsCaptured: true }), true)
})
test('whole-sync single flight shares concurrent work and permits recovery after failure', async () => {
  let calls = 0; let release
  const run = singleFlight(async () => { calls++; await new Promise(resolve => { release = resolve }); if (calls === 1) throw new Error('outage'); return 'ok' })
  const first = run(); const second = run()
  assert.equal(first, second)
  await Promise.resolve(); release()
  await assert.rejects(first, /outage/)
  const next = run(); await Promise.resolve(); release()
  assert.equal(await next, 'ok'); assert.equal(calls, 2)
})
