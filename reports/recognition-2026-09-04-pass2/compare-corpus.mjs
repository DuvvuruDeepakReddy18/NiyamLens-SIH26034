import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extractDeclarations } from '../../src/lib/extraction.mjs'
import { normalizeCriticalValue, validateCriticalFieldManifest } from '../../src/lib/criticalFieldBenchmark.mjs'
import { mergeOcrPassTexts } from '../../src/lib/vision.mjs'
import { rapidOcrLines } from '../../src/lib/spatialOcr.mjs'
import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from '../../src/lib/ocrReadingOrder.mjs'

// Development diagnostics only. No transcript is corrected, no proposal applied,
// and no field is chosen because it matches a reference label.
const prefix = 'reports/recognition-2026-09-04-pass2/'
const inputs = [
  'datasets/critical-fields.v1.json',
  'reports/recognition-2026-09-04/critical-baseline-raw-passes.jsonl',
  'reports/recognition-2026-09-04/rapidocr-default-raw.json',
  'src/lib/labelParser.mjs', 'src/lib/extraction.mjs',
  'src/lib/criticalFieldBenchmark.mjs', 'src/lib/vision.mjs',
  'src/lib/spatialOcr.mjs', 'src/lib/ocrReadingOrder.mjs',
]
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const hashFiles = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, digest(await readFile(path))])))
const sourceHashes = await hashFiles()
const manifest = validateCriticalFieldManifest(JSON.parse(await readFile(inputs[0], 'utf8')))
const baseline = (await readFile(inputs[1], 'utf8')).trim().split(/\r?\n/).map(JSON.parse).filter(row => row.type === 'result')
const rapid = JSON.parse(await readFile(inputs[2], 'utf8')).rows
assert.equal(baseline.length, 24)
assert.equal(rapid.length, 8)
const criticalIds = ['mrp', 'netQuantity', 'packDate']
const otherIds = extractDeclarations('').fields.map(field => field.id).filter(id => !criticalIds.includes(id))
const rows = []
const proposalRows = []
for (const sample of manifest.samples) {
  assert.equal(digest(await readFile(sample.sourcePath)), sample.sha256)
  const passes = baseline.filter(row => row.sampleId === sample.id)
  assert.deepEqual(passes.map(row => row.variant), ['standard', 'full-gray', 'reverse-sparse'])
  for (const row of passes) {
    assert.equal(row.sourcePath, sample.sourcePath)
    assert.equal(row.imageSha256, sample.sha256)
    assert.ok(!row.error)
  }
  const modern = rapid.filter(row => row.sampleId === sample.id)
  assert.equal(modern.length, 1)
  const raw = modern[0]
  assert.equal(raw.sourcePath, sample.sourcePath)
  assert.equal(raw.sourceSha256, sample.sha256)
  assert.equal(raw.rawText, raw.metadata.texts.join('\n'))
  assert.equal(raw.transcriptKind, 'raw-ocr-unedited')
  assert.equal(raw.manuallyEdited, false)
  assert.ok(!raw.error)
  const modes = [
    { mode: 'tesseract-production-merge-on-sharp-approximation', transcriptKind: 'system-derived-production-pass-merge', text: mergeOcrPassTexts(passes.map(row => row.rawText)), elapsedMs: passes.reduce((sum, row) => sum + row.elapsedMs, 0) },
    { mode: 'rapidocr-default-whole-image', transcriptKind: raw.transcriptKind, text: raw.rawText, elapsedMs: raw.metadata.elapsedMs },
  ]
  for (const mode of modes) {
    const parsed = extractDeclarations(mode.text)
    const critical = criticalIds.map(id => {
      const field = parsed.byId[id]
      const label = sample.fields[id]
      const eligible = label.status === 'readable' && label.metricEligible === true
      const valid = field.candidates.length === 1 && field.candidates[0].valid === true && field.validation?.status === 'format_valid' && !field.conflict
      return { field: id, eligible, expected: eligible ? label.value : null, value: field.value, valid, correct: eligible && valid && normalizeCriticalValue(id, field.value) === normalizeCriticalValue(id, label.value), conflict: field.conflict, candidates: field.candidates }
    })
    rows.push({ sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, ...mode, critical, otherFields: otherIds.map(id => {
      const field = parsed.byId[id]
      return { field: id, nonempty: Boolean(field.value.trim()), detected: field.detected, value: field.value, evidence: field.evidence, validation: field.validation, candidates: field.candidates ?? null }
    }) })
  }
  const review = reviewableDeclarationProposals(reconstructOcrReadingOrder(rapidOcrLines(raw.metadata, { panelId: sample.id })))
  for (const proposal of review.proposals) {
    assert.equal(proposal.requiresOfficerReview, true)
    assert.equal(proposal.eligibleForAutomaticVerdict, false)
    const label = sample.fields[proposal.field]
    const eligible = label?.status === 'readable' && label.metricEligible === true
    proposalRows.push({ sampleId: sample.id, ...proposal, eligibleReference: eligible, provisionalReferenceMatch: eligible && normalizeCriticalValue(proposal.field, proposal.value) === normalizeCriticalValue(proposal.field, label.value), applied: false, officerReviewed: false })
  }
}
const summaries = [...new Set(rows.map(row => row.mode))].map(mode => {
  const selected = rows.filter(row => row.mode === mode)
  return { mode, photos: selected.length, elapsedMs: selected.reduce((sum, row) => sum + row.elapsedMs, 0),
    critical: criticalIds.map(id => { const fields = selected.flatMap(row => row.critical).filter(field => field.field === id); return { field: id, correct: fields.filter(field => field.correct).length, eligible: fields.filter(field => field.eligible).length } }),
    otherCandidatePresenceNotAccuracy: otherIds.map(id => { const fields = selected.flatMap(row => row.otherFields).filter(field => field.field === id); return { field: id, nonemptyValuePhotos: fields.filter(field => field.nonempty).length, detectedValueOrEvidencePhotos: fields.filter(field => field.detected).length, photos: selected.length } }),
  }
})
assert.deepEqual(await hashFiles(), sourceHashes, 'Source changed during diagnostic')
const output = { schemaVersion: 1, sourceHashes, imageHashesVerified: 8, isHoldout: false, humanReviewed: false,
  limitations: ['Eight previously used development photos; ten provisional readable critical values, not a representative accuracy estimate.', 'Tesseract source images are Sharp approximations of browser preparation, not exact Chrome end-to-end measurements.', 'Tesseract uses the actual production pass-merge helper in recorded pass order; its transcript is explicitly system-derived, not raw OCR.', 'Other-field counts measure parser output presence only. Wrong strings, fallbacks and incomplete values can count; no accuracy labels exist for them.', 'Proposals are unaccepted officer-review suggestions, not new automatic correct fields, edited transcripts, or legal decisions.'],
  summaries, proposalSummary: { proposed: proposalRows.length, provisionalReferenceMatches: proposalRows.filter(row => row.provisionalReferenceMatch).length, applied: 0, officerReviewed: 0 }, rows, proposalRows,
}
await writeFile(`${prefix}corpus-comparison.json`, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ summaries, proposalSummary: output.proposalSummary, proposalRows }, null, 2))
