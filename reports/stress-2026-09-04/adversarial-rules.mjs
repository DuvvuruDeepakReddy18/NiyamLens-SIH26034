// Read-only deterministic audit. Synthetic transcripts isolate rule behavior;
// this is NOT an image-OCR accuracy test and does not contact any live service.
import { evaluateCompliance, inferQuantity, isSmallPack, getFontRequirement } from '../../src/lib/rules.mjs'
import { extractDeclarations } from '../../src/lib/extraction.mjs'
import { evaluateInspection, fieldCandidates } from '../../src/lib/inspectionSafety.mjs'
import { validateCase } from '../../server/caseService.mjs'
import { RULE_PACK } from '../../src/lib/rules.mjs'
import { readFileSync } from 'node:fs'

const base = `GENERIC NAME: TEST PRODUCT
MRP Rs. 40.00 inclusive of all taxes
NET QTY 100 g
PACKED 08/2026
MANUFACTURED BY: EXAMPLE FOODS, CHENNAI
CONSUMER CARE: EXAMPLE FOODS HELPDESK
12 Market Road, Chennai 600001
Telephone: 1800 111 2026 · care@example.in
UNIT SALE PRICE Rs. 0.40/g`
const geometry = { pdpArea: 75, pdpUncertainty: 2, referenceMm: 20, referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5, measurementUncertainty: 3 }
const verifiedMeta = (text, patch = {}) => {
  const extraction = extractDeclarations(text)
  return {
    ...geometry, ...extraction.suggestions, ocrConfidence: 95,
    enforceEvidenceReview: true, classificationConfirmed: true,
    allPanelsCaptured: true, pdpConfirmed: true, measurementConfirmed: true,
    widthCharacterConfirmed: true, measurementSurface: 'flat',
    fieldReviews: Object.fromEntries(extraction.fields.filter(f => f.detected).map(f => [f.id, { state: 'confirmed', value: f.value, reason: 'Transcribed exactly from the test label.' }])),
    ...patch,
  }
}
const inspection = (text = base, patch = {}) => evaluateInspection({ text, meta: verifiedMeta(text, patch) })
const results = []
function check(id, expectation, run, accepts) {
  try {
    const actual = run()
    results.push({ id, expectation, passed: Boolean(accepts(actual)), actual })
  } catch (error) {
    results.push({ id, expectation, passed: false, thrown: `${error.name}: ${error.message}` })
  }
}
const summary = r => ({ status: r.status, counts: r.counts, context: r.context, checks: r.checks.filter(c => c.status !== 'pass' && c.status !== 'info') })
const detail = (r, id) => ({ status: r.status, check: r.checks.find(c => c.id === id) })
const notDecisive = a => !['compliant', 'exempt'].includes(a.status)

check('baseline-verified-complete', 'Valid synthetic baseline remains compliant.', () => summary(inspection()), a => a.status === 'compliant')
check('zero-quantity', 'A zero-quantity transcription cannot establish a physically valid small-pack exemption.', () => summary(inspection('NET QTY 0 g')), notDecisive)
check('negative-quantity-direct-helper', 'Negative mass is invalid, not a small pack.', () => ({ smallPack: isSmallPack(-5, 'g') }), a => !a.smallPack)
check('zero-quantity-kg', 'Zero kg cannot establish a small-pack exemption.', () => summary(inspection('NET QTY 0 kg')), notDecisive)
check('quantity-underflow', 'A nonzero decimal that underflows Number must not silently become zero/exempt.', () => summary(inspection(`NET QTY 0.${'0'.repeat(330)}1 g`)), notDecisive)
check('missing-quantity', 'Missing quantity must not infer zero.', () => summary(inspection('SHAMPOO', { quantity: '', unit: 'g' })), notDecisive)
check('mismatched-quantity-review', 'Metadata cannot silently shrink a 100g label to 5g.', () => summary(inspection('NET QTY 100 g', { quantity: 5 })), notDecisive)
check('recognized-tobacco', 'Recognized tobacco cannot use small-pack exemption.', () => summary(inspection('TOBACCO PRODUCT\nNET QTY 8 g')), notDecisive)
check('recognized-pan-masala', 'Recognized pan masala cannot use small-pack exemption.', () => summary(inspection('PAN MASALA\nNET QTY 8 g')), notDecisive)
check('smallpack-unknown-class', 'Unknown commodity enum must not silently receive the standard exemption.', () => summary(inspection('TOBACCO PRODUCT\nNET QTY 8 g', { commodityClass: 'typo_tobacco' })), notDecisive)
check('conflicting-label-quantity-small-first', 'Contradictory net quantities in one transcript must be unresolved, not silently exempt.', () => summary(inspection('NET QTY 5 g\nNET QTY 100 g')), notDecisive)
check('conflicting-label-quantity-large-first', 'Reversing contradictory quantities must still require resolution.', () => summary(inspection('NET QTY 100 g\nNET QTY 5 g')), notDecisive)
check('single-pass-conflict-preservation', 'Both conflicting readings inside a single pass should be represented.', () => fieldCandidates([{ id: 'single', text: 'NET QTY 5 g\nNET QTY 100 g' }]), a => a.netQuantity?.length === 2)
check('cross-pass-conflict-preservation', 'Conflicting readings across separate passes are represented.', () => fieldCandidates([{ id: 'one', text: 'NET QTY 5 g' }, { id: 'two', text: 'NET QTY 100 g' }]), a => a.netQuantity?.length === 2)
check('impossible-calendar-date', '31 February must not be accepted as a valid calendar date simply by confirming its transcription.', () => detail(inspection(base.replace('PACKED 08/2026', 'PACKED 31/02/2026')), 'packDate'), a => a.check.status !== 'pass')
check('mrp-thousands-comma', 'Rs. 1,000.00 must parse as 1000, or abstain, never silently truncate to 1.', () => ({ mrp: extractDeclarations('MRP Rs. 1,000.00').byId.mrp }), a => a.mrp.value === '1000.00' || !a.mrp.detected)
check('mrp-negative', 'A negative price must be rejected/uncertain rather than losing its sign.', () => ({ mrp: extractDeclarations('MRP Rs. -40.00').byId.mrp }), a => !a.mrp.detected || a.mrp.value.startsWith('-'))
check('mrp-overprecision', 'Price 40.999 must not silently truncate to 40.99.', () => ({ mrp: extractDeclarations('MRP Rs. 40.999').byId.mrp }), a => !a.mrp.detected || a.mrp.value === '40.999')
check('punctuated-mrp-consistency', 'Equivalent M.R.P. text should not conflict between extraction and rule detection.', () => detail(inspection(base.replace('MRP Rs.', 'M.R.P. Rs.')), 'mrp'), a => a.check.status === 'pass')
check('pieces-unit-consistency', 'Supported extraction unit PIECES should be recognized by the rule evaluator.', () => detail(inspection(base.replace('NET QTY 100 g', 'NET QTY 100 PIECES')), 'netQuantity'), a => a.check.status === 'pass')
check('unit-alias-inference', 'Equivalent 8 GRAMS must be inferred consistently with normalized 8 g.', () => ({ raw: inferQuantity('NET QTY 8 GRAMS'), normalized: inferQuantity('NET QTY 8 g') }), a => a.raw.quantity === a.normalized.quantity)
check('manufacturer-heading-only', 'Responsible entity cannot be established by an empty MANUFACTURED BY heading.', () => detail(inspection(base.replace('MANUFACTURED BY: EXAMPLE FOODS, CHENNAI', 'MANUFACTURED BY:')), 'manufacturer'), a => a.check.status !== 'pass')
check('origin-empty-value', 'An imported country declaration cannot be established by an empty heading.', () => detail(inspection(`${base}\nCOUNTRY OF ORIGIN:`, { category: 'imported' }), 'countryOrigin'), a => a.check.status !== 'pass')
check('origin-bogus-value', 'A placeholder country value should not be accepted as validated country-of-origin.', () => detail(inspection(`${base}\nCOUNTRY OF ORIGIN: UNKNOWN`, { category: 'imported' }), 'countryOrigin'), a => a.check.status !== 'pass')
check('unit-price-heading-only', 'Unit sale price cannot be established by the heading without a value.', () => detail(inspection(base.replace('UNIT SALE PRICE Rs. 0.40/g', 'UNIT SALE PRICE')), 'unitSalePrice'), a => a.check.status !== 'pass')
check('unit-price-arithmetic', 'USP Rs99/g contradicts MRP Rs40 / 100g and must not be called validated arithmetic.', () => detail(inspection(base.replace('UNIT SALE PRICE Rs. 0.40/g', 'UNIT SALE PRICE Rs. 99.00/g')), 'unitSalePrice'), a => a.check.status !== 'pass')
check('negative-physical-lengths', 'Negative reference/glyph lengths must not combine into a passing positive ratio.', () => summary(inspection(base, { referencePx: -100, glyphPx: -9, glyphWidthPx: -3.5 })), notDecisive)
check('numeric-string-physical-lengths', 'Ordinary finite numeric strings remain supported.', () => summary(inspection(base, { referencePx: '100', glyphPx: '9', glyphWidthPx: '3.5' })), a => a.status === 'compliant')
check('nan-measurement', 'Non-finite glyphs do not produce a decisive pass.', () => summary(inspection(base, { glyphPx: NaN })), notDecisive)
check('infinity-measurement', 'Infinite glyphs do not produce a decisive pass.', () => summary(inspection(base, { glyphPx: Infinity })), notDecisive)
check('negative-uncertainty', 'A negative uncertainty must be rejected/uncertain, not clamped to exact measurement.', () => summary(inspection(base, { measurementUncertainty: -20, pdpUncertainty: -10 })), notDecisive)
check('nonfinite-uncertainty', 'Invalid uncertainty must not be silently treated as zero.', () => summary(inspection(base, { measurementUncertainty: NaN, pdpUncertainty: Infinity })), notDecisive)
check('finite-overflow-area', 'Large finite area/uncertainty must never crash evaluation.', () => summary(inspection(base, { pdpArea: 1e308, pdpUncertainty: 1e308 })), a => !['compliant', 'exempt'].includes(a.status))
check('boolean-string-confirmations', 'String false is not a confirmed checkbox value.', () => summary(inspection(base, { pdpConfirmed: 'false', measurementConfirmed: 'false', widthCharacterConfirmed: 'false' })), notDecisive)
check('area-boundary-crossing', 'PDP uncertainty crossing a tier must abstain.', () => summary(inspection(base, { pdpArea: 99, pdpUncertainty: 5 })), notDecisive)
check('flat-plane-required', 'Curved measurements must abstain.', () => summary(inspection(base, { measurementSurface: 'curved' })), notDecisive)
check('second-panel-uncalibrated', 'A known second panel must not reuse the first calibration.', () => summary(inspection(base, { evidencePanelIds: ['front', 'back'], panelMeasurements: { front: { referencePx: 100, glyphPx: 9, glyphWidthPx: 3.5 } } })), notDecisive)
check('unreviewed-safe', 'Unreviewed readings stay in manual review.', () => summary(inspection(base, { fieldReviews: {}, pdpConfirmed: false, measurementConfirmed: false })), notDecisive)
check('review-input-shape', 'Malformed review reason should produce controlled invalid-input handling, not TypeError.', () => summary(inspection(base, { fieldReviews: { mrp: { state: 'confirmed', value: '40.00', reason: 17 } } })), notDecisive)
check('unicode-high-confidence-safe', 'Unsupported Indic-only text must abstain.', () => summary(inspection('नियम पैकेज पर उत्पाद विवरण ग्राहक उपभोक्ता सेवा')), notDecisive)

const context = { user: { id: 'audit-user', email: 'audit@example.invalid' }, member: { role: 'officer', display_name: 'Local audit' } }
const makeRecord = (patch = {}) => ({ id: 'audit-case-20260904', text: base, rawOcrText: base, meta: verifiedMeta(base), evidenceItems: ['front', 'back'].map(id => ({ id, name: `${id}.png`, originalPath: `${id}/original.png`, analysisPath: `${id}/analysis.png`, sha256: 'a'.repeat(64) })), createdAt: '2026-09-04T00:00:00.000Z', sealedAt: '2026-09-04T00:01:00.000Z', rulePack: RULE_PACK.id, ...patch })
check('server-actual-panels-bound', 'Server must derive panel calibration scope from evidenceItems, not omit the second panel.', () => summary(validateCase(makeRecord(), context).result), notDecisive)
check('server-malformed-numeric-metadata', 'Server validator must reject malformed geometry or force review before sealing.', () => summary(validateCase(makeRecord({ meta: verifiedMeta(base, { referencePx: -100, glyphPx: -9, glyphWidthPx: -3.5 }) }), context).result), notDecisive)
check('server-controlled-fixture', 'Controlled fixture marker is rejected.', () => { try { validateCase(makeRecord({ controlledFixture: true }), context); return { rejected: false } } catch (e) { return { rejected: e.status === 422, error: e.message, status: e.status } } }, a => a.rejected)

const boundaryResults = []
for (const boundary of [50, 100, 500, 2500]) {
  for (const delta of [-0.000001, 0, 0.000001]) {
    const area = boundary + delta
    const expected = area <= 50 ? 1 : area <= 100 ? 1.5 : area <= 500 ? 2.5 : area <= 2500 ? 4 : 6
    boundaryResults.push({ area, expected, actual: getFontRequirement(area).minimum, passed: getFontRequirement(area).minimum === expected })
  }
}
const benchmark = JSON.parse(readFileSync(new URL('../ocr-real-label-benchmark-deep.json', import.meta.url), 'utf8'))
const realReplay = benchmark.results.map(row => {
  const extraction = extractDeclarations(row.recognizedText)
  const result = evaluateInspection({ text: row.recognizedText, meta: { ...geometry, ...extraction.suggestions, enforceEvidenceReview: true, ocrConfidence: row.reliability, fieldReviews: {} } })
  return { id: row.id, status: result.status, passed: result.status === 'manual_review', tokenRecall: row.tokenRecall }
})

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: 'Read-only pure-function stress audit; synthetic transcriptions + replay of existing stored OCR, not newly captured images; no live cloud calls. All confirmations are synthetic fixtures, not independent verification of label truth.',
  summary: { adversarialAndControlCases: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, exceptions: results.filter(r => r.thrown).length, boundaryCases: boundaryResults.length, boundaryPassed: boundaryResults.filter(r => r.passed).length, storedOcrReplays: realReplay.length, storedOcrSafeAbstentions: realReplay.filter(r => r.passed).length },
  results, boundaryResults, realReplay,
}, null, 2))
