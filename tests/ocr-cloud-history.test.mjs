import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanels } from '../server/caseSchema.mjs'

const base = () => ({ id: '12345678-1234-4234-8234-123456789abc', name: 'actual.jpg', originalPath: 'private/original', analysisPath: 'private/analysis', sha256: 'a'.repeat(64) })
test('cloud panel schema preserves exact raw alternatives and bounded provider provenance', () => {
  const source = { ...base(), ocrText: 'MRP 22.00\nMRP 2200', ocrProvider: 'mixed', ocrModel: 'bundled-fast', ocrStrategy: 'focused', ocrConfidence: null, ocrWords: [{ secretUnneededBox: true }], ocrPasses: [
    { id: 'local:1', text: '  MRP: ₹ 22.00\r\n', provider: 'tesseract.js', model: 'bundled-fast', strategy: 'focused', confidence: 61, unwanted: 'drop' },
    { id: 'connected:2', text: 'MRP 2200\n', provider: 'google-vision', strategy: 'connected', confidence: null },
  ] }
  const [result] = validatePanels([source])
  assert.equal(result.ocrText, source.ocrText)
  assert.equal(result.ocrPasses[0].text, source.ocrPasses[0].text)
  assert.equal(result.ocrPasses[1].text, source.ocrPasses[1].text)
  assert.equal(result.ocrPasses[0].provider, 'tesseract.js')
  assert.equal(result.ocrPasses[0].unwanted, undefined)
  assert.equal(result.ocrWords, undefined)
  assert.equal(result.ocrClientReported, true)
  assert.equal(result.ocrConfidence, null)
})
test('cloud OCR history rejects malformed, repeated and oversized raw alternatives', () => {
  for (const patch of [
    { ocrPasses: null }, { ocrPasses: [null] }, { ocrPasses: [{ id: 'a', text: 1 }] },
    { ocrPasses: [{ id: 'a', text: 'MRP40' }, { id: 'a', text: 'MRP48' }] },
    { ocrPasses: [{ id: 'a', text: 'x'.repeat(100001) }] },
    { ocrPasses: Array.from({ length: 33 }, (_, i) => ({ id: `${i}`, text: '' })) },
    { ocrPasses: [{ id: 'a', text: 'ok', confidence: Infinity }] },
    { ocrPasses: [{ id: 'a', text: 'ok', model: {} }] },
    { ocrProvider: 'x'.repeat(81) }, { ocrConfidence: '99' },
  ]) assert.throws(() => validatePanels([{ ...base(), ...patch }]), { status: 400 })
})
