// Read-only diagnosis of a fixed, previously exposed development run.
// This does NOT run OCR or manufacture new accuracy measurements.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const root = resolve(import.meta.dirname, '..')
const paths = {
  reference: 'datasets/critical-fields.v1.json',
  browser: 'reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T14-32-37-364Z.json',
  geometry: 'reports/readiness-2026-09-05/paddle-resolution-focus960-2026-09-05T14-13-39-915Z.json',
}
const sha = value => createHash('sha256').update(value).digest('hex')
const files = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
  const bytes = await readFile(resolve(root, path))
  return [key, { path, sha256: sha(bytes), data: JSON.parse(bytes) }]
}))
const input = Object.fromEntries(files)
const browser = input.browser.data
const geometry = input.geometry.data
const reference = input.reference.data
assert.equal(browser.rawScoring.runs[0].exactMatchCorrect, 1)
assert.equal(browser.selectedWorkingScoring.exactCandidateMatches, 6)
assert.equal(reference.annotation.humanReviewed, false)
const field = (id, key, stage, indexes, explanation, perfectRecognizerAlone, remedy) => ({ id, key, stage, indexes, explanation, perfectRecognizerAlone, remedy })
const cases = [
  field('CF-001', 'mrp', 'already-recovered', [9], 'The complete declaration MRP:22.00 is already emitted as one line.', 'No change needed.', 'Preserve this success while testing changes.'),
  field('CF-001', 'netQuantity', 'serialization-association', [3, 4, 5], 'Both Net Content: and 500mL are recognized correctly. An unrelated address line PO BALARAM is serialized between them. The existing mapped stacked suggestion recovers the quantity.', 'No. The relevant characters are already correct; retain coordinates and associate the declaration.', 'Use explicit source-mapped layout association; do not join arbitrary adjacent global lines.'),
  field('CF-002', 'mrp', 'not-emitted-at-stamp', [16, 20, 23], 'The visible black MRP27 stamp is absent from retained OCR lines; nearby blue text and the separate UseBy and USP stamps are emitted. No current text parser can recover a missing MRP value.', 'A recognizer only improves detected crops, not missing stamp localization. The image-to-text stage must emit the complete stamp.', 'Field-local crop and color/orientation acquisition. Keep the already available dark-ink recovery optional and preserve competing observations.'),
  field('CF-003', 'mrp', 'combined-heading-and-staggered-table', [10, 11, 12], '90.00 is recognized exactly in 90.00 USP. The separate combined MRP-USP: heading is lower and left of the stamp row. The current strict heading grammar and geometric row proposal do not resolve this compound table structure.', 'No. Merely changing RS 0.18/9 to RS 0.18/g does not establish the combined heading/value mapping or make its grammar supported.', 'A review-only compound-declaration table association or an officer-selected heading/value link, with exact source spans and explicit USP separation.'),
  field('CF-003', 'packDate', 'serialization-association', [6, 7, 8, 9], '02/08/2026 and PACKED ON: are recognized exactly but serialized value-before-heading; the following USE BY date must not be mistaken for packing. Existing mapped row selection recovers the correct date.', 'No. The required characters are already correct.', 'Use coordinate-based row association with separate packing and expiry headings.'),
  field('CF-004', 'netQuantity', 'cropped-heading-and-supported-grammar-gap', [25], 'The emitted line NTENTS at 30° C: 910 g contains the correct quantity. The leading contents letters are actually outside the photograph. Current grammar does not accept this clipped heading; even a complete CONTENTS at 30° C qualifier is outside its present quantity forms.', 'No. Pixels outside the photo cannot be recognized. Supporting a full temperature-qualified contents declaration also requires parser work.', 'Request a wider capture for a complete heading. If adding a review-only numeric candidate, retain the visibly clipped context and require explicit field attribution; never silently invent NET CONTENTS.'),
  field('CF-005', 'netQuantity', 'serialization-association', [25, 26, 27], '1Litre and Net Quantity are recognized exactly but serialized in reverse order with KEEP YOUR between them. The lines lie on a sloping label row. Existing mapped row selection recovers the quantity.', 'No. The relevant characters are already correct.', 'Preserve sloped-row source mapping and human review.'),
  field('CF-005', 'packDate', 'rotation-localization-recognition', [1, 2, 3], 'The source has a readable sideways PKD:19/10/25 stamp. Original-color whole-image OCR emits isolated low-quality vertical fragments (845.0, 号, C) instead of the complete date/heading.', 'Not a parser-only fix. The image-to-text stage needs a correctly oriented complete stamp crop.', 'Orientation-aware regional OCR; compare exact transformed pixels to the original and retain conflicting readings. The existing dark-ink90 option reads this date but loses other fields.'),
  field('CF-006', 'netQuantity', 'serialization-association', [28, 29, 30, 31, 32], 'NET QUANTITY: and 1L are recognized correctly; unrelated BIS certification text is serialized between the stacked pair. The existing mapped stacked suggestion recovers it.', 'No. The required characters are already correct.', 'Use bounded column/stack association, not global next-line inference.'),
  field('CF-007', 'netQuantity', 'serialization-association', [35, 36, 37], 'NET QUANTITY: and 1l are recognized correctly; AFTER USE is interleaved. Their font sizes differ. The existing guarded stacked suggestion recovers the quantity.', 'No. The relevant characters are already correct (unit spelling is normalized).', 'Preserve review-only stacked geometry and competing-value safeguards.'),
]
const brief = value => ({ value: value.value, detected: value.detected, validation: value.validation, conflict: value.conflict })
const rows = []
for (const spec of cases) {
  const sample = reference.samples.find(row => row.id === spec.id)
  const app = browser.rows.find(row => row.sampleId === spec.id)
  const observation = geometry.rows.find(row => row.sampleId === spec.id).observations[0]
  assert.equal(sha(await readFile(resolve(root, sample.sourcePath))), sample.sha256)
  assert.equal(observation.text, app.rawText, 'Only identical full-image raw observations may supply diagnostic geometry')
  assert.equal(observation.lines.map(line => line.text).join('\n'), app.rawText)
  const rawScore = browser.rawScoring.runs[0].sampleResults.find(row => row.sampleId === spec.id).fields[spec.key]
  assert.equal(rawScore.eligible, true)
  const replay = extractDeclarations(app.rawText).byId[spec.key]
  rows.push({
    sampleId: spec.id, field: spec.key, expected: sample.fields[spec.key].value,
    sourcePath: sample.sourcePath, sourceSha256: sample.sha256,
    diagnosis: spec.stage, explanation: spec.explanation, perfectRecognizerAlone: spec.perfectRecognizerAlone, remedy: spec.remedy,
    historicalRawOutcome: rawScore.outcome,
    currentParserReplay: brief(replay), historicalSelectedCandidate: brief(app.workingFields[spec.key]),
    sourceFrame: observation.sourceFrame,
    exactOcrLines: spec.indexes.map(index => ({ sourceIndex: index, ...observation.lines[index] })),
  })
}
const probes = [
  ['compound-heading-exact-text', 'mrp', 'MRP ₹ - USP ₹: 90.00 USP RS 0.18/g'],
  ['cropped-contents-exact-visible-text', 'netQuantity', 'NTENTS at 30° C: 910 g'],
  ['uncropped-temperature-qualified-contents', 'netQuantity', 'CONTENTS at 30° C: 910 g'],
  ['ordinary-net-quantity-control', 'netQuantity', 'NET CONTENTS: 910 g'],
].map(([name, key, text]) => ({ name, text, kind: 'CONSTRUCTED-PARSER-DIAGNOSTIC-NOT-OCR-OUTPUT', field: key, result: brief(extractDeclarations(text).byId[key]) }))
const report = {
  schemaVersion: 1, kind: 'AI-assisted-known-development-field-root-cause-audit', createdAt: new Date().toISOString(),
  isHoldout: false, humanReviewed: false, newOcrRun: false,
  inputs: Object.fromEntries(files.map(([key, entry]) => [key, { path: entry.path, sha256: entry.sha256 }])),
  codeHashes: Object.fromEntries(await Promise.all(['src/lib/labelParser.mjs', 'src/lib/extraction.mjs'].map(async path => [path, sha(await readFile(resolve(root, path)))]))),
  totals: { eligibleFields: 10, historicalRawExact: 1, historicalSelectedExact: 6, characterCorrectButInterleavedRecoveredBySelection: 5, remainingMisses: { missingOrFragmentedStampOutput: 2, combinedHeadingTable: 1, physicallyCroppedHeadingAndGrammar: 1 }, historicalEligibleConflictFields: 0 },
  rows, constructedParserProbes: probes,
  limitations: [
    'The fixed eight photographs and labels were exposed during development. This is failure isolation, not blind or general accuracy.',
    'Coordinates come from a separate full-image observation whose emitted text exactly matches the RC7 browser run. They are not invented pixel annotations.',
    'Absence from retained OCR boxes does not by itself distinguish detector thresholding from every downstream recognition filter; raw detector probability maps were not recorded.',
    'A score of 1/10 measures exact field extraction from serialized raw text, not OCR character accuracy. These quantities must not be described interchangeably.',
    'No independent human labels, physical capture timing, qualified legal review or measurement validation were performed by this diagnostic.',
  ],
}
const out = resolve(root, 'reports/root-cause-2026-09-05/field-failure-audit.json')
await mkdir(resolve(root, 'reports/root-cause-2026-09-05'), { recursive: true })
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ out, totals: report.totals, parserProbes: probes }, null, 2))
