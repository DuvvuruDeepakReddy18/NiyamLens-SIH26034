import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPaddleWorkingAddition } from '../src/lib/paddleWorkingText.mjs'
import { comparePaddleFieldReadings } from '../src/lib/paddleReviewEvidence.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { collectPaddleLayoutProposals } from '../src/lib/paddleLayoutProposals.mjs'

const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const lines = [{ id: 'heading', panelId: 'p1', text: 'Net quantity:', box: box(100, 100, 200, 40) }, { id: 'note', panelId: 'p1', text: 'Other column', box: box(10, 170, 70, 20) }, { id: 'value', panelId: 'p1', text: '250 g', box: box(150, 150, 100, 40) }]
const item = { id: 'p1', width: 1000, height: 800, text: lines.map(line => line.text).join('\n'), lines }
const row = { panelId: 'p1', sourceIds: ['heading', 'value'], text: 'Net quantity: 250 g' }
test('reviewed layout occurs once in working text while raw strings and every source remain intact', () => {
  const saved = JSON.stringify(item)
  const result = buildPaddleWorkingAddition([item], [row])
  assert.ok(result.rawAddition.endsWith(item.text))
  assert.doesNotMatch(result.rawAddition, /Net quantity: 250 g/)
  assert.equal(result.workingAddition.match(/Net quantity:/g).length, 1)
  assert.equal(result.workingAddition.match(/250 g/g).length, 1)
  assert.match(result.workingAddition, /Other column/)
  assert.match(result.workingAddition, /NOT RAW OCR/)
  assert.equal(extractDeclarations(result.workingAddition).byId.netQuantity.value, '250 g')
  assert.deepEqual(result.workingMappings[0].rows.flatMap(part => part.sourceIds).sort(), lines.map(line => line.id).sort())
  assert.equal(JSON.stringify(item), saved)
})
test('no selection retains raw working text and prior contradictory observations remain conflicts', () => {
  const raw = buildPaddleWorkingAddition([item])
  assert.equal(raw.rawAddition, raw.workingAddition)
  const derived = buildPaddleWorkingAddition([item], [row])
  assert.equal(extractDeclarations('Net quantity: 500 g' + derived.workingAddition).byId.netQuantity.conflict, true)
  const compared = comparePaddleFieldReadings({ currentText: 'Net quantity: 500 g', items: [item], selectedRows: [row] })
  assert.equal(compared.fields.find(field => field.id === 'netQuantity').selected.conflict, true)
})
test('working derivation refuses source reuse, invented text, missing lines and raw disagreement', () => {
  assert.throws(() => buildPaddleWorkingAddition([item], [row, row]), /reused/)
  assert.throws(() => buildPaddleWorkingAddition([item], [{ ...row, text: 'Net quantity: 999 g' }]), /changed/)
  assert.throws(() => buildPaddleWorkingAddition([item], [{ ...row, sourceIds: ['heading', 'missing'] }]), /changed/)
  assert.throws(() => buildPaddleWorkingAddition([{ ...item, text: 'altered' }], [row]), /exactly/)
  assert.throws(() => buildPaddleWorkingAddition([{ ...item, lines: [...lines, lines[0]] }], [row]), /uniquely/)
})
test('combined collector offers a strictly mapped stacked suggestion, not an automatic verified value', () => {
  const result = collectPaddleLayoutProposals([item])
  assert.equal(result.proposals.length, 1)
  assert.equal(result.proposals[0].requiresOfficerReview, true)
  assert.equal(result.proposals[0].eligibleForAutomaticVerdict, false)
  assert.deepEqual(result.proposals[0].sourceIds, ['heading', 'value'])
  assert.throws(() => collectPaddleLayoutProposals(null))
})
