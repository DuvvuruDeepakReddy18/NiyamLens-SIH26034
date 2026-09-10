import test from 'node:test'
import assert from 'node:assert/strict'
import { labelLocationHints, captureTargets } from '../src/lib/captureCoach.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { buildInspectionAnalysis } from '../src/lib/inspectionAnalysis.mjs'

const pointer = 'FOR DATE OF MANUFACTURE,\nBATCH NO. & M.R.P. (INCL. OF\nALL TAXES): SEE CAP/NECK.'
test('printed location pointers guide capture without creating price or date answers', () => {
  const extraction = extractDeclarations(pointer)
  const hints = labelLocationHints(extraction)
  assert.deepEqual(hints.map(hint => hint.id).sort(), ['mrp', 'packDate'])
  assert.equal(hints[0].location, 'cap/neck')
  assert.equal(extraction.byId.mrp.value, '')
  assert.equal(extraction.byId.packDate.value, '')
  assert.match(captureTargets(extraction)[0].recovery, /cap\/neck/)
  const analysis = buildInspectionAnalysis({ text: 'WATER', rawOcrText: pointer, evidenceItems: [{ id: 'p1' }] })
  assert.match(analysis.fields.find(field => field.id === 'mrp').reason, /cap\/neck/)
  assert.equal(analysis.verified, 0)
})
test('location guidance cannot cross panels, blank blocks or supply unrelated values', () => {
  for (const divider of ['\n\n', '\n[PANEL 2]\n']) {
    assert.deepEqual(labelLocationHints(extractDeclarations('MRP' + divider + 'SEE CAP/NECK')), [])
  }
  assert.deepEqual(labelLocationHints(extractDeclarations('Ingredients: SEE BACK')), [])
  assert.deepEqual(labelLocationHints(extractDeclarations('MRP Rs 20\nSEE BOTTOM')), [])
})
