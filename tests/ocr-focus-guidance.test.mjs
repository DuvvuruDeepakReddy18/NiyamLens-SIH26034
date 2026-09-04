import test from 'node:test'
import assert from 'node:assert/strict'
import { planPaddleFocus, resolvePaddleFocusSuggestion, OCR_FOCUS_POLICY } from '../src/lib/ocrFocusGuidance.mjs'

const line = (id, text, x, y, width = 180, height = 25) => ({ id, panelId: 'p1', text, box: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] })
const frame = lines => ({ id: 'p1', imageUrl: 'original-analysis-url', width: 1000, height: 800, source: 'original-resolution-bounded', lines })
const contains = (suggestion, item) => {
  const rect = suggestion.rect
  return item.box.every(([x, y]) => x / 1000 >= rect.x0 && x / 1000 <= rect.x1 && y / 800 >= rect.y0 && y / 800 <= rect.y1)
}

test('focus guidance isolates a split declaration column without changing a single OCR token', () => {
  const heading = line('head', 'Net Content:', 600, 100)
  const quantity = line('quantity', '500m', 640, 140, 100, 30)
  const unrelated = line('address', 'SHOP 12345', 20, 135)
  const mrp = line('mrp', 'MRP:22.00', 600, 210)
  const input = frame([heading, unrelated, quantity, mrp]); const original = structuredClone(input)
  const result = planPaddleFocus(input)
  assert.equal(result.suggestions.length, 1)
  const suggestion = result.suggestions[0]
  assert.equal(suggestion.label, 'Retry net quantity region')
  assert.ok(contains(suggestion, heading)); assert.ok(contains(suggestion, quantity))
  assert.equal(contains(suggestion, unrelated), false); assert.equal(contains(suggestion, mrp), false)
  assert.deepEqual(suggestion.contextLineIds, ['quantity'])
  assert.deepEqual(input, original)
  assert.equal('value' in suggestion, false)
  assert.equal('text' in suggestion, false)
  assert.equal(suggestion.imageUrl, input.imageUrl)
})

test('same-row date crop includes original right-hand box but stops before the expiry row', () => {
  const heading = line('head', 'PACKED ON:', 120, 200)
  const date = line('date', '02/08/2026', 390, 198)
  const expiry = line('expiry', 'USE BY:', 120, 250)
  const expiryDate = line('expiryDate', '01/08/2027', 390, 250)
  const result = planPaddleFocus(frame([date, heading, expiryDate, expiry]))
  assert.equal(result.suggestions.length, 1)
  assert.ok(contains(result.suggestions[0], date))
  assert.equal(contains(result.suggestions[0], expiryDate), false)
  assert.deepEqual(result.suggestions[0].headingTexts, ['PACKED ON:'])
})

test('tall directly-below characters stay inside the retry instead of being clipped', () => {
  const heading = line('head', 'NET QUANTITY:', 600, 400, 200, 25)
  const quantity = line('quantity', '1l', 660, 450, 70, 90)
  const result = planPaddleFocus(frame([heading, quantity]))
  assert.ok(contains(result.suggestions[0], quantity))
})

test('no unseen headings, serving values, retailer descriptions or unit price become targets', () => {
  const input = ['500 ml', 'Rs/Qty 5.00', 'FROOTI MAN 125ML TPK', 'USP 99/L', 'NTENTS at 30 C: 910 g', 'Packed by: ACME', 'MFD BY ACME', 'MRP: SEE CAP', 'Use By:31.05.23', 'FOR NET QUANTITY SEE OTHER SIDE', 'Serving size 100g', 'MRP-USP:']
  const result = planPaddleFocus(frame(input.map((text, index) => line(String(index), text, 100, 20 + index * 40))))
  assert.equal(result.suggestions.length, 0)
  assert.match(result.withheld[0].reason, /no_literal/)
})

test('already-valid values are not claimed correct and nested automatic crop plans are withheld', () => {
  const input = frame([line('mrp', 'MRP:22.00', 100, 100)])
  const result = planPaddleFocus(input)
  assert.equal(result.suggestions.length, 0)
  assert.match(result.withheld[0].reason, /not_a_verified_value/)
  assert.match(planPaddleFocus({ ...input, crop: { x0: .1, y0: .1, x1: .8, y1: .8 } }).withheld[0].reason, /already_focused/)
})

test('missing value still gets bounded real adjacent pixels but not a fabricated candidate', () => {
  const result = planPaddleFocus(frame([line('quantity', 'Net Quantity:', 100, 100)]))
  assert.equal(result.suggestions.length, 1)
  assert.ok(result.suggestions[0].rect.y1 > 125 / 800)
  assert.deepEqual(result.suggestions[0].contextLineIds, [])
})

test('an invalid value already on its heading line gets a tight retry without following unrelated text', () => {
  const heading = line('heading', 'Net Content: 500m', 600, 200)
  const unrelated = line('unrelated', 'KEEP REFRIGERATED', 600, 260)
  const result = planPaddleFocus(frame([heading, unrelated]))
  assert.ok(contains(result.suggestions[0], heading))
  assert.deepEqual(result.suggestions[0].contextLineIds, [])
  assert.equal(contains(result.suggestions[0], unrelated), false)
})

test('guidance enforces three retries and keeps a reason for other candidates', () => {
  const result = planPaddleFocus(frame([line('a', 'MRP:', 50, 50), line('b', 'NET QTY:', 600, 50), line('c', 'PKD:', 50, 400), line('d', 'MFG:', 600, 400)]))
  assert.equal(result.suggestions.length, OCR_FOCUS_POLICY.maxSuggestions)
  assert.ok(result.withheld.some(item => item.reason.includes('bounded_retry_limit')))
})

test('unsupported orientation abstains and out-of-image/malformed geometry is rejected', () => {
  const vertical = line('head', 'NET QUANTITY:', 100, 100, 20, 200)
  assert.match(planPaddleFocus(frame([vertical])).withheld[0].reason, /unsupported_rotation/)
  const malformed = [frame([line('head', 'NET QTY:', -1, 0)]), frame([line('head', 'NET QTY:', 990, 0)]), frame([line('head', 'x'.repeat(513), 0, 0)]), frame([line('same', 'NET QTY:', 0, 0), line('same', 'MRP:', 0, 100)]), frame(new Array(2)), { ...frame([]), width: Infinity }, frame([{ ...line('head', 'NET QTY:', 0, 0), panelId: 'different' }])]
  for (const item of malformed) assert.throws(() => planPaddleFocus(item))
})

test('no rectangle exceeds its frame at any corner and source geometry remains traceable', () => {
  for (const [x, y] of [[0, 0], [800, 0], [0, 770], [800, 770]]) {
    const result = planPaddleFocus(frame([line('head', 'NET QUANTITY:', x, y)]))
    assert.equal(result.suggestions.length, 1)
    const suggestion = result.suggestions[0]
    for (const coordinate of Object.values(suggestion.rect)) assert.ok(coordinate >= 0 && coordinate <= 1)
    assert.deepEqual(suggestion.sourceFrame, { width: 1000, height: 800, source: 'original-resolution-bounded' })
    assert.deepEqual(suggestion.headingIds, ['head'])
  }
})

test('mutating unrelated columns or numerical values cannot tune a region toward a desired reading', () => {
  const build = value => frame([line('head', 'NET CONTENT:', 600, 100), line('value', value, 630, 140, 120, 30), line('other', 'PHONE 99999', 10, 140)])
  const first = planPaddleFocus(build('500m'))
  for (const value of ['500ml', '900kg', '12Oml', 'not readable']) {
    const second = planPaddleFocus(build(value))
    assert.deepEqual(second.suggestions[0].rect, first.suggestions[0].rect)
  }
})

test('selection resolves current displayed guidance and rejects stale photos, duplicate IDs or bad rectangles', () => {
  const suggestions = planPaddleFocus(frame([line('head', 'NET QUANTITY:', 600, 100)])).suggestions
  const evidenceItems = [{ id: 'p1', analysisUrl: 'original-analysis-url' }]
  const request = { suggestions, suggestionId: suggestions[0].id, evidenceItems }
  const resolved = resolvePaddleFocusSuggestion(request)
  assert.equal(resolved.panel, evidenceItems[0]); assert.deepEqual(resolved.rect, suggestions[0].rect)
  resolved.rect.x0 = 0
  assert.notEqual(suggestions[0].rect.x0, 0)
  assert.throws(() => resolvePaddleFocusSuggestion({ ...request, suggestions: [] }), /no longer available/)
  assert.throws(() => resolvePaddleFocusSuggestion({ ...request, suggestions: [suggestions[0], suggestions[0]] }), /no longer available/)
  assert.throws(() => resolvePaddleFocusSuggestion({ ...request, evidenceItems: [{ id: 'p1', analysisUrl: 'new' }] }), /image changed/)
  assert.throws(() => resolvePaddleFocusSuggestion({ ...request, evidenceItems: [...evidenceItems, ...evidenceItems] }), /image changed/)
  for (const rect of [{ x0: -.01, y0: 0, x1: .5, y1: .5 }, { x0: .8, y0: 0, x1: .2, y1: .5 }, { x0: 0, y0: 0, x1: .001, y1: .001 }, { x0: 0, y0: NaN, x1: 1, y1: 1 }]) {
    assert.throws(() => resolvePaddleFocusSuggestion({ ...request, suggestions: [{ ...suggestions[0], rect }] }))
  }
})
