// Deterministic, bounded local robustness sweep; no network, browser, or writes.
// Deliberately hostile cases measure contracts, NOT real-world label accuracy.
import { performance } from 'node:perf_hooks'
import { evaluateInspection } from '../../src/lib/inspectionSafety.mjs'
import { extractDeclarations } from '../../src/lib/extraction.mjs'

let seed = 260342026
const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296 }
const pick = values => values[Math.floor(random() * values.length)]
const baseBlocks = ['GENERIC NAME: TEST PRODUCT', 'MRP Rs. 40.00 inclusive of all taxes', 'NET QTY 100 g', 'PACKED 08/2026', 'MANUFACTURED BY: EXAMPLE FOODS, CHENNAI', 'CONSUMER CARE: EXAMPLE FOODS HELPDESK\n12 Market Road, Chennai 600001\nTelephone: 1800 111 2026 · care@example.in', 'UNIT SALE PRICE Rs. 0.40/g']
const base = baseBlocks.join('\n')
const metaFor = (text) => {
  const e = extractDeclarations(text)
  return { ...e.suggestions, ocrConfidence: 95, enforceEvidenceReview: true, classificationConfirmed: true, pdpConfirmed: true, measurementConfirmed: true, widthCharacterConfirmed: true, allPanelsCaptured: true, measurementSurface: 'flat', pdpArea: 75, pdpUncertainty: 2, referenceMm: 20, referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5, measurementUncertainty: 3,
    fieldReviews: Object.fromEntries(e.fields.filter(f => f.detected).map(f => [f.id, { state: 'confirmed', value: f.value, reason: 'Exact transcription of this synthetic label.' }])) }
}
const baseMeta = metaFor(base)
const groups = {}
const serialize = value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v))
const decisive = r => ['compliant', 'exempt'].includes(r.status)
function run(groupName, text, meta, check, inputSummary = {}) {
  const g = groups[groupName] ||= { cases: 0, expected: 0, unexpected: 0, exceptions: 0, statuses: {}, totalMs: 0, maximumMs: 0, examples: [] }
  const begin = performance.now()
  g.cases++
  try {
    const result = evaluateInspection({ text, meta })
    g.statuses[result.status] = (g.statuses[result.status] || 0) + 1
    if (check(result)) g.expected++
    else { g.unexpected++; if (g.examples.length < 5) g.examples.push(serialize({ inputSummary, status: result.status, counts: result.counts })) }
  } catch (error) {
    g.exceptions++
    if (g.examples.length < 5) g.examples.push(serialize({ inputSummary, error: `${error.name}: ${error.message}` }))
  }
  const elapsed = performance.now() - begin
  g.totalMs += elapsed
  g.maximumMs = Math.max(g.maximumMs, elapsed)
}
const start = performance.now()

// Randomized magnitudes + invalid types for physically positive dimensions.
// Expectations permit review OR rejection/noncompliance, but not positive clearance.
const lengthKeys = ['referenceMm', 'referencePx', 'glyphPx', 'glyphWidthPx', 'pdpArea']
for (let i = 0; i < 6000; i++) {
  const key = pick(lengthKeys)
  const value = pick([-random() * 10000 - .001, 0, NaN, Infinity, -Infinity, 'NaN', 'Infinity', 'invalid', null, '', false, {}, []])
  const meta = { ...baseMeta, [key]: value }
  if (i % 7 === 0) Object.assign(meta, { referencePx: -100 * (1 + random()), glyphPx: -9 * (1 + random()), glyphWidthPx: -5 * (1 + random()) })
  run('invalid-physical-dimensions', base, meta, r => !decisive(r), { key, originallySelectedValue: value, negativeTriple: i % 7 === 0, actualDimensions: Object.fromEntries(lengthKeys.map(k => [k, meta[k]])) })
}
for (let i = 0; i < 2000; i++) {
  const key = pick(['measurementUncertainty', 'pdpUncertainty'])
  const value = pick([-random() * 1000 - .01, NaN, Infinity, -Infinity, 'invalid', {}, []])
  run('invalid-uncertainty-domain', base, { ...baseMeta, [key]: value }, r => !decisive(r), { key, value })
}
for (let i = 0; i < 1000; i++) {
  const key = pick(['pdpConfirmed', 'measurementConfirmed', 'widthCharacterConfirmed'])
  const value = pick(['false', 'true', '0', 1, -1, {}, [], ['false']])
  run('nonboolean-confirmations', base, { ...baseMeta, [key]: value }, r => !decisive(r), { key, value })
}
for (let i = 0; i < 1000; i++) {
  const value = 1e200 * (1 + random() * 1e100)
  run('finite-arithmetic-overflow', base, { ...baseMeta, pdpArea: value, pdpUncertainty: value }, r => !decisive(r), { pdpArea: value, pdpUncertainty: value })
}
for (let i = 0; i < 1000; i++) {
  const badReason = pick([0, 17, true, false, {}, [], [1], { trim: 'not-a-function' }])
  const reviews = { ...baseMeta.fieldReviews, mrp: { ...baseMeta.fieldReviews.mrp, reason: badReason } }
  run('malformed-review-reason', base, { ...baseMeta, fieldReviews: reviews }, r => !decisive(r), { badReason })
}

// Quantity ambiguity is tested as a required abstention independent of final legal scope.
for (let i = 0; i < 1000; i++) {
  const small = 1 + Math.floor(random() * 10)
  const large = 11 + Math.floor(random() * 1000)
  const smallFirst = i % 2 === 0
  const text = `NET QTY ${smallFirst ? small : large} g\nNET QTY ${smallFirst ? large : small} g`
  run('conflicting-quantity-order', text, metaFor(text), r => !decisive(r), { small, large, smallFirst })
}
for (let i = 0; i < 1000; i++) {
  const blocks = [...baseBlocks]
  for (let j = blocks.length - 1; j > 0; j--) { const k = Math.floor(random() * (j + 1)); [blocks[j], blocks[k]] = [blocks[k], blocks[j]] }
  const text = blocks.join('\n')
  run('valid-field-block-order-invariance', text, metaFor(text), r => r.status === 'compliant', { permutation: blocks.map(b => baseBlocks.indexOf(b)) })
}

// Text-only latency, within validateCase's 100000-character limit; no regex exhaustion.
const latencyProfiles = [
  ['ordinary-ascii', 'ordinary package information without declaration markers '],
  ['almost-declarations', 'MAXIMUM RETAIL PRIC M R P NET QUANTIT MANUFACTURE PACKED 31/02/202 '],
  ['long-line', 'A'],
  ['indic', 'पैकेज उपभोक्ता जानकारी विवरण '],
]
const latency = []
for (const [name, piece] of latencyProfiles) {
  for (const size of [1000, 10000, 50000, 99000]) {
    const text = piece.repeat(Math.ceil(size / piece.length)).slice(0, size - base.length - 1) + '\n' + base
    const meta = metaFor(text)
    const samples = []
    for (let j = 0; j < 5; j++) {
      const begin = performance.now()
      run('bounded-large-text-robustness', text, meta, () => true, { name, characters: text.length })
      samples.push(performance.now() - begin)
    }
    samples.sort((a, b) => a - b)
    latency.push({ name, characters: text.length, runs: samples.length, medianMs: samples[2], maximumMs: samples.at(-1) })
  }
}
const elapsedMs = performance.now() - start
const totals = Object.values(groups).reduce((acc, g) => ({ cases: acc.cases + g.cases, expected: acc.expected + g.expected, unexpected: acc.unexpected + g.unexpected, exceptions: acc.exceptions + g.exceptions }), { cases: 0, expected: 0, unexpected: 0, exceptions: 0 })
for (const g of Object.values(groups)) { g.totalMs = +g.totalMs.toFixed(3); g.maximumMs = +g.maximumMs.toFixed(3) }
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), seed: 260342026, node: process.version, scope: 'Local deterministic pure-function robustness only; synthetic exact-transcription confirmations; no network/cloud writes. Hand-selected malformed inputs do not measure real-world failure rate. Numeric NaN/Infinity are direct function inputs; string representations also test malformed serialized forms. Unknown case shapes are expected to return review/reject, not throw.', totals, elapsedMs: +elapsedMs.toFixed(3), groups, latency }, null, 2))
