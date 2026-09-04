import test from 'node:test'
import assert from 'node:assert/strict'
import { appendOcrHistory, validateOcrHistory, OCR_OUTPUT_LIMITS } from '../src/lib/ocrHistory.mjs'

const word = { text: 'MRP', lineText: 'MRP 40', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 }, pageWidth: 100, pageHeight: 100 }
const panel = { id: 'panel', ocrText: 'MRP 40', ocrPasses: [{ id: 'old', text: 'MRP 40' }], ocrWords: [word] }
test('OCR history append is immutable and retains every raw reading', () => {
  const next = appendOcrHistory(panel, { passes: [{ id: 'new', text: 'MRP 48' }], words: [word], text: 'MRP 40\nMRP 48' })
  assert.deepEqual(next.ocrPasses.map(pass => pass.text), ['MRP 40', 'MRP 48'])
  assert.equal(panel.ocrPasses.length, 1)
  assert.equal(next.ocrWords.length, 2)
  assert.equal(validateOcrHistory([next]), true)
})
test('repeated pass IDs and oversized text are rejected, never silently trimmed', () => {
  assert.throws(() => appendOcrHistory(panel, { passes: [{ id: 'old', text: 'MRP 48' }] }), /duplicate/i)
  assert.throws(() => appendOcrHistory(panel, { passes: [{ id: 'new', text: 'x'.repeat(OCR_OUTPUT_LIMITS.textPerPass + 1) }] }), /text/i)
  assert.throws(() => appendOcrHistory(panel, { text: 'x'.repeat(100001) }), /text/i)
})
test('panel and inspection OCR history resource limits cannot be bypassed by small merged text', () => {
  assert.throws(() => validateOcrHistory([{ id: 'p', ocrText: 'small', ocrPasses: Array.from({ length: 33 }, (_, i) => ({ id: `${i}`, text: 'small' })) }]), /pass/i)
  assert.throws(() => validateOcrHistory([{ id: 'p', ocrPasses: Array.from({ length: 3 }, (_, i) => ({ id: `${i}`, text: 'x'.repeat(90000) })) }]), /raw text/i)
  assert.throws(() => validateOcrHistory(Array.from({ length: 3 }, (_, p) => ({ id: `p${p}`, ocrPasses: [{ id: 'a', text: 'x'.repeat(90000) }, { id: 'b', text: 'x'.repeat(90000) }] }))), /raw text/i)
  assert.throws(() => appendOcrHistory(panel, { words: Array(OCR_OUTPUT_LIMITS.wordsPerPanel).fill(word) }), /word/i)
  assert.throws(() => validateOcrHistory(Array.from({ length: 3 }, (_, p) => ({ id: `p${p}`, ocrWords: Array(9000).fill(word) }))), /word/i)
})
test('nonfinite and malformed OCR geometry is rejected before becoming evidence', () => {
  for (const bad of [{ ...word, bbox: { ...word.bbox, x1: Infinity } }, { ...word, pageHeight: 0 }, { ...word, text: 'x'.repeat(513) }, { ...word, bbox: null }]) {
    assert.throws(() => appendOcrHistory(panel, { words: [bad] }), /word/i)
  }
})
