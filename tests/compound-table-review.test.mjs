import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compoundTableReview } from '../src/lib/compoundTableReview.mjs'

function pngHeader(width, height) {
  // Synthetic framing fixture for pure/SSR checks; not an image-decoding or
  // visual recognition claim. Actual captured PNG display is checked in Chrome.
  const bytes = Buffer.alloc(33)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes)
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20)
  return `data:image/png;base64,${bytes.toString('base64')}`
}
const line = (id, text, x, y, width = 110, height = 20) => ({ id, text, panelId: 'p', box: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] })
function fixture() {
  const lines = [line('h1', 'LOT NO:', 10, 100), line('h2', 'PACKED ON:', 10, 140), line('h3', 'USE BY:', 10, 180), line('h4', 'MRP-USP:', 10, 220),
    line('v1', 'XK114A', 250, 100, 130, 24), line('v2', '11/05/2024', 250, 132, 130, 24), line('v3', '12/05/2025', 250, 164, 130, 24), line('v4', '48.50 USP ', 250, 196, 130, 24), line('usp', 'RS 0.49/9', 385, 196, 105, 24)]
  const previewUrl = pngHeader(600, 400)
  return { id: 'p', width: 600, height: 400, previewUrl, imageUrl: previewUrl, text: lines.map(line => line.text).join('\n'), lines,
    sourceBinding: { schemaVersion: 1, inputKind: 'original', originalUrl: previewUrl, analysisUrl: previewUrl, transform: '{"rotation":0}' } }
}
const withheld = item => { const result = compoundTableReview([item]); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.cards, []); assert.equal(result.verified, false) }

// The component is plain JavaScript. Resolve only its controlled imports for
// data-URL loading; no JSX transpiler process, output file or mocked view logic.
const require = createRequire(import.meta.url)
const componentUrl = new URL('../src/CompoundTableReview.jsx', import.meta.url)
const componentSource = (await readFile(componentUrl, 'utf8'))
  .replace("import './compound-table-review.css'", '')
  .replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier.startsWith('.') ? new URL(specifier, componentUrl).href : pathToFileURL(require.resolve(specifier)).href}'`)
const { default: CompoundTableReview } = await import(`data:text/javascript;base64,${Buffer.from(componentSource).toString('base64')}`)

test('projection retains one exact compound row, every supporting pair and bounded immutable source views', () => {
  const item = fixture(); const original = structuredClone(item)
  const result = compoundTableReview([item]); assert.equal(result.status, 'available')
  const card = result.cards[0]
  assert.equal(card.value, '48.50'); assert.equal(card.rowText, 'MRP-USP: 48.50 USP  RS 0.49/9')
  assert.equal(card.unitPriceFormatValid, false); assert.equal(card.all.length, 9); assert.equal(card.anchors.length, 3)
  assert.deepEqual(card.anchors.map(pair => [pair.heading.id, pair.value.id]), [['h1', 'v1'], ['h2', 'v2'], ['h3', 'v3']])
  assert.equal(card.sourceGeometryKind, 'OCR-line-boxes-not-glyph-measurements')
  for (const region of [card.rowRegion, card.tableRegion]) assert.ok(region.x >= 0 && region.y >= 0 && region.x + region.width <= item.width && region.y + region.height <= item.height)
  card.row[0].box[0][0] = 999
  assert.deepEqual(item, original)
})

test('mismatched PNG dimensions, malformed headers, remote images and unsupported retry frames are withheld', () => {
  for (const patch of [{ width: 601 }, { previewUrl: pngHeader(300, 200) }, { previewUrl: 'data:image/png;base64,YmFk' }, { previewUrl: 'https://example.com/image.png' }, { retryMode: { photometric: 'max-rgb-v1', rotation: 90 } }, { width: 10000, height: 10000 }]) withheld({ ...fixture(), ...patch })
})

test('missing and duplicate references, wrong-panel fragments and changed raw transcripts are withheld', () => {
  for (const mutate of [item => { item.lines[0].id = '' }, item => { item.lines[0].id = item.lines[1].id }, item => { item.lines[0].panelId = 'elsewhere' }, item => { item.lines[0].box[0][0] = -1 }, item => { item.text += '\nchanged' }, item => { item.lines[0].box[0][0] = 601 }, item => { item.sourceBinding.analysisUrl = 'changed' }]) { const item = fixture(); mutate(item); withheld(item) }
})

test('arbitrary caller candidates cannot override candidates computed from the actual source fragments', () => {
  const item = fixture(); item.candidates = [{ value: '9999.00', verified: true }]
  assert.equal(compoundTableReview([item]).cards[0].value, '48.50')
})

test('valid comma grouping stays literal in the display while its parsed numeric value is checked', () => {
  const item = fixture()
  item.lines.find(line => line.id === 'v4').text = '1,048.50 USP '
  item.text = item.lines.map(line => line.text).join('\n')
  const original = structuredClone(item)
  const result = compoundTableReview([item])
  assert.equal(result.status, 'available')
  assert.equal(result.cards[0].value, '1,048.50')
  assert.equal(result.cards[0].rowText, 'MRP-USP: 1,048.50 USP  RS 0.49/9')
  assert.deepEqual(item, original)
  const html = renderToStaticMarkup(createElement(CompoundTableReview, { items: [item] }))
  assert.match(html, /Unverified MRP candidate: 1,048\.50/)
  assert.doesNotMatch(html, /Unverified MRP candidate: 1048\.50/)
})

test('object/getter fields and sparse or oversized collections fail closed without invoking getters', () => {
  const item = fixture(); Object.defineProperty(item.lines[0], 'text', { get: () => { throw new Error('Getter must not run') } }); withheld(item)
  const point = fixture(); Object.defineProperty(point.lines[0].box[0], 0, { get: () => { throw new Error('Point getter must not run') } }); withheld(point)
  for (const items of [null, {}, new Array(1), [fixture(), fixture()], Array(5).fill(fixture())]) assert.equal(compoundTableReview(items).status, 'unavailable')
})

test('a valid panel without this narrowly supported compound table is a quiet none result', () => {
  const item = fixture(); item.lines = [line('other', 'Some unrelated label', 10, 10)]; item.text = item.lines[0].text
  assert.equal(compoundTableReview([item]).status, 'none')
  assert.equal(compoundTableReview([]).status, 'none')
})

test('actual React rendering discloses unverified MRP, unresolved USP, three anchors and no mutation controls', () => {
  const html = renderToStaticMarkup(createElement(CompoundTableReview, { items: [fixture()] }))
  assert.match(html, /Unverified MRP candidate: 48\.50/)
  assert.match(html, /MRP-USP: 48\.50 USP  RS 0\.49\/9/)
  assert.match(html, /USP remains unresolved/)
  assert.match(html, /Three supporting table rows/)
  assert.match(html, /LOT NO:/); assert.match(html, /XK114A/)
  assert.match(html, /11\/05\/2024/); assert.match(html, /12\/05\/2025/)
  assert.match(html, /not automatic extraction/)
  assert.match(html, /does not fill or confirm anything/)
  assert.doesNotMatch(html, /<(?:button|input|select|textarea)\b/)
  assert.equal((html.match(/<image /g) || []).length, 3)
  assert.equal((html.match(/<polygon /g) || []).length, 21)
})

test('actual React rendering withholds unsafe source values and stays empty for unrelated labels', () => {
  const invalid = fixture(); invalid.lines[0].panelId = 'unrelated'
  const html = renderToStaticMarkup(createElement(CompoundTableReview, { items: [invalid] }))
  assert.match(html, /Table aid withheld/)
  assert.doesNotMatch(html, /Unverified MRP candidate/)
  assert.doesNotMatch(html, /<image /)
  assert.equal(renderToStaticMarkup(createElement(CompoundTableReview, { items: [] })), '')
})
