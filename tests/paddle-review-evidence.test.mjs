import test from 'node:test'
import assert from 'node:assert/strict'
import { comparePaddleFieldReadings, proposalSourceView } from '../src/lib/paddleReviewEvidence.mjs'
const box = (x, y, w = 70, h = 20) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const item = { id: 'p1', width: 1000, height: 800, text: 'Net quantity:\nUnrelated note\n250 g', lines: [{ id: 'h', text: 'Net quantity:', box: box(100, 100) }, { id: 'n', text: 'Unrelated note', box: box(10, 300) }, { id: 'v', text: '250 g', box: box(200, 100) }] }
const proposal = { id: 'one', panelId: 'p1', text: 'Net quantity: 250 g', sourceIds: ['h', 'v'], parts: item.lines.filter(line => line.id !== 'n').map(line => ({ sourceId: line.id, text: line.text, box: line.box })) }
test('preview distinguishes raw from selected derivation, never verifies or mutates the input', () => {
  const saved = JSON.stringify(item)
  const empty = comparePaddleFieldReadings({ items: [item] })
  assert.deepEqual(empty.fields.map(field => field.raw), empty.fields.map(field => field.selected))
  const result = comparePaddleFieldReadings({ items: [item], selectedRows: [proposal] })
  assert.equal(result.fields.find(field => field.id === 'netQuantity').selected.value, '250 g')
  assert.equal(result.selectedCount, 1)
  assert.match(result.limitation, /nothing is verified/)
  assert.equal(JSON.stringify(item), saved)
})
test('old conflicting readings remain visible when a valid new suggestion is selected', () => {
  const result = comparePaddleFieldReadings({ currentText: 'Net quantity: 500 g', items: [item], selectedRows: [proposal] })
  assert.equal(result.fields.find(field => field.id === 'netQuantity').selected.conflict, true)
})
test('preview rejects altered characters, unknown sources, duplicates and oversized input', () => {
  for (const row of [{ ...proposal, text: 'Net quantity: 999 g' }, { ...proposal, sourceIds: ['h', 'missing'] }, { ...proposal, sourceIds: ['h', 'h'] }]) assert.throws(() => comparePaddleFieldReadings({ items: [item], selectedRows: [row] }))
  assert.throws(() => comparePaddleFieldReadings({ items: [item], selectedRows: [proposal, proposal] }))
  assert.throws(() => comparePaddleFieldReadings({ currentText: 'x'.repeat(100001), items: [item] }))
})
test('source close-up includes exact mapped fragments, clips padding and never edits polygons', () => {
  const original = JSON.stringify(proposal)
  const view = proposalSourceView(item, proposal)
  assert.ok(view.x < 100 && view.x + view.width > 270 && view.y < 100 && view.y + view.height > 120)
  assert.ok(view.x >= 0 && view.x + view.width <= item.width && view.y >= 0 && view.y + view.height <= item.height)
  assert.equal(JSON.stringify(proposal), original)
  assert.throws(() => proposalSourceView(item, { ...proposal, parts: proposal.parts.map(part => ({ ...part, text: 'forged' })) }))
  assert.throws(() => proposalSourceView({ ...item, width: 50 }, proposal))
})
