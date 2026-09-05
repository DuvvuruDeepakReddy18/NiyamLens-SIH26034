import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePackingDates } from '../src/lib/labelParser.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from '../src/lib/ocrReadingOrder.mjs'

test('a clipped third date component never falls back to a shorter month/year', () => {
  for (const value of ['02/08/2', '02/08/', '02/08/202', '02/08/20266', '02 / 08 / 2', '02-08-2', '02.08.2', '08/2026/2', '08/2026 /', 'Aug 2026/2']) {
    const result = parsePackingDates(`PACKED ON: ${value}`)
    assert.equal(result.length, 1, value)
    assert.equal(result[0].valid, false, value)
    assert.equal(result[0].value, value, 'Keep the full invalid evidence, not a repaired prefix')
    assert.equal(extractDeclarations(`PACKED ON: ${value}`).byId.packDate.confidence, 0)
  }
})

test('complete full dates and month/year declarations still parse without changing raw evidence', () => {
  for (const value of ['02/08/2026', '02/08/26', '08/2026', '08/26', '02 - 08 - 2026', 'Aug 2026', '2 August 2026']) {
    const result = parsePackingDates(`PACKED ON: ${value}`)
    assert.equal(result[0].valid, true, value)
    assert.equal(result[0].evidence, `PACKED ON: ${value}`)
  }
  assert.equal(parsePackingDates('PACKED ON: 02/08/2026 BATCH: A20')[0].valid, true)
  assert.equal(parsePackingDates('PACKED ON: 31/02/2026')[0].valid, false)
})

test('clipped OCR cannot become a mapped review suggestion or clear a complete conflicting reading', () => {
  const lines = [
    { id: 'heading', panelId: 'p1', text: 'PACKED ON:', box: [[10, 10], [110, 10], [110, 30], [10, 30]] },
    { id: 'value', panelId: 'p1', text: '02/08/2', box: [[130, 10], [230, 10], [230, 30], [130, 30]] },
  ]
  const before = structuredClone(lines)
  const order = reconstructOcrReadingOrder(lines)
  assert.equal(reviewableDeclarationProposals(order).proposals.length, 0)
  assert.equal(order.rawText, 'PACKED ON:\n02/08/2')
  assert.deepEqual(lines, before)
  const field = extractDeclarations('PACKED ON: 02/08/2\nPACKED ON: 02/08/2026').byId.packDate
  assert.equal(field.conflict, true)
  assert.equal(field.confidence, 0)
  assert.equal(field.candidates.some(candidate => !candidate.valid), true)
})
