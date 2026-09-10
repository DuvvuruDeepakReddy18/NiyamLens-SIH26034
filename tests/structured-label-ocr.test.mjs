import test from 'node:test'
import assert from 'node:assert/strict'
import { readLabelWithRecovery, prepareRecoveredLabelAppend, unresolvedRecoveryRegions } from '../src/lib/structuredLabelOcr.mjs'
import { parsePaddleOutput, paddleSourceBinding, PADDLE_MODEL } from '../src/lib/paddleOcr.mjs'
import { planPaddleFocus } from '../src/lib/ocrFocusGuidance.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const panel = { id: 'p1', name: 'fixture.jpg', analysisUrl: 'data:image/png;base64,AAAA', originalUrl: 'data:image/png;base64,AAAA' }
function output(text, crop = null) {
  const parsed = parsePaddleOutput({ image: { width: 240, height: 140 }, items: [{ text, score: .8, poly: [[10, 15], [120, 15], [120, 30], [10, 30]] }] }, 'p1', { width: 240, height: 140 })
  const item = { ...parsed, id: 'p1', imageUrl: panel.analysisUrl, sourceBinding: paddleSourceBinding(panel), source: crop ? 'automatic-heading-original' : 'original-resolution-bounded', width: 240, height: 140, crop, ocrWords: parsed.words, ocrPasses: [{ id: crop ? 'crop' : 'whole', text: parsed.text, confidence: 80 }] }
  item.focusGuidance = planPaddleFocus(item)
  return { items: [item], model: PADDLE_MODEL }
}
test('one unresolved literal heading triggers a bounded retry, retains both readings and exposes the new valid candidate', async () => {
  const primary = output('MRP')
  const targets = unresolvedRecoveryRegions(primary, [panel])
  assert.equal(targets.length, 1)
  let calls = 0; let seenFrame
  const result = await readLabelWithRecovery({ evidenceItems: [panel], runner: async options => {
    calls++
    if (calls === 1) return primary
    seenFrame = await options.inputFactory(panel)
    return output('MRP Rs 40.00', targets[0].rect)
  }, focusFactory: async (item, rect) => ({ source: 'officer-selected-original', crop: rect, sourceBinding: paddleSourceBinding(item) }) })
  assert.equal(calls, 2)
  assert.equal(seenFrame.automaticFocus, true)
  assert.equal(seenFrame.source, 'automatic-heading-original')
  const next = prepareRecoveredLabelAppend({ evidenceItems: [panel], text: '', rawOcrText: '', output: result, runId: 'test' })
  assert.equal(next.evidenceItems[0].ocrPasses.length, 2)
  assert.match(next.rawOcrText, /MRP\n/)
  assert.match(next.rawOcrText, /MRP Rs 40.00/)
  const field = extractDeclarations(next.text).byId.mrp
  assert.ok(field.candidates.some(candidate => candidate.valid && candidate.value === '40.00'))
  assert.equal(field.conflict, true, 'Earlier unresolved evidence is not silently erased to promote the new reading')
  assert.equal(result.recoveryNotes[0].method, 'automatic-heading-crop')
})
test('resolved fields and photos without local headings do not launch arbitrary retries', async () => {
  for (const text of ['MRP Rs 40.00', 'UNRELATED TITLE']) {
    let calls = 0
    const result = await readLabelWithRecovery({ evidenceItems: [panel], runner: async () => { calls++; return output(text) } })
    assert.equal(calls, 1)
    assert.equal(result.recoveries.length, 0)
  }
})
test('failed optional recovery preserves the primary output and reports the failure without invented values', async () => {
  let calls = 0
  const result = await readLabelWithRecovery({ evidenceItems: [panel], runner: async () => { if (++calls === 2) throw new Error('Fixture crop failed'); return output('MRP') } })
  assert.equal(result.items[0].text, 'MRP')
  assert.equal(result.recoveries.length, 0)
  assert.match(result.recoveryNotes[0].reason, /crop failed/)
  assert.equal(extractDeclarations(result.items[0].text).byId.mrp.value, '')
})
test('cancellation during automatic recovery rejects the entire unpublished reading', async () => {
  const controller = new AbortController(); let calls = 0
  await assert.rejects(readLabelWithRecovery({ evidenceItems: [panel], signal: controller.signal, runner: async () => { if (++calls === 2) controller.abort(); return output('MRP') } }), { name: 'AbortError' })
})
test('malformed recovery count and stale source binding are rejected before publication', () => {
  assert.throws(() => prepareRecoveredLabelAppend({ evidenceItems: [panel], text: '', rawOcrText: '', runId: 't', output: { ...output('MRP'), recoveries: [output('a'), output('b'), output('c')] } }), /bounded/)
  assert.throws(() => unresolvedRecoveryRegions(output('MRP'), [{ ...panel, analysisUrl: 'changed-image' }]), /image changed/i)
})
