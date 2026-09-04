import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extractDeclarations } from '../../src/lib/extraction.mjs'
import { CRITICAL_FIELDS, normalizeCriticalValue, scoreCriticalFields, validateCriticalFieldManifest } from '../../src/lib/criticalFieldBenchmark.mjs'
import { mergeOcrPassTexts } from '../../src/lib/vision.mjs'

const prefix = 'reports/recognition-2026-09-04-pass2/'
const inputs = [
  'datasets/critical-fields.v1.json',
  'reports/recognition-2026-09-04/critical-baseline-raw-passes.jsonl',
  'reports/recognition-2026-09-04/rapidocr-default-raw.json',
  `${prefix}english-strategies-raw.json`,
  'src/lib/labelParser.mjs', 'src/lib/extraction.mjs',
  'src/lib/criticalFieldBenchmark.mjs', 'src/lib/vision.mjs',
]
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const hashFiles = async () => Object.fromEntries(await Promise.all(inputs.map(async path => [path, digest(await readFile(path))])))
const sourceHashes = await hashFiles()
const manifest = validateCriticalFieldManifest(JSON.parse(await readFile(inputs[0], 'utf8')))
const baseline = (await readFile(inputs[1], 'utf8')).trim().split(/\r?\n/).map(JSON.parse).filter(row => row.type === 'result')
const rapid = JSON.parse(await readFile(inputs[2], 'utf8')).rows
const english = JSON.parse(await readFile(inputs[3], 'utf8')).rows
assert.equal(baseline.length, 24)
assert.equal(rapid.length, 8)
assert.equal(english.length, 32)
const rawRows = [...rapid, ...english]
const mergedRows = []
for (const sample of manifest.samples) {
  assert.equal(digest(await readFile(sample.sourcePath)), sample.sha256)
  const passes = baseline.filter(row => row.sampleId === sample.id)
  assert.deepEqual(passes.map(row => row.variant), ['standard', 'full-gray', 'reverse-sparse'])
  for (const row of passes) {
    assert.equal(row.sourcePath, sample.sourcePath)
    assert.equal(row.imageSha256, sample.sha256)
    assert.ok(!row.error)
  }
  const samePhoto = rawRows.filter(row => row.sampleId === sample.id)
  assert.equal(samePhoto.length, 5)
  for (const row of samePhoto) {
    assert.equal(row.sourcePath, sample.sourcePath)
    assert.equal(row.sourceSha256, sample.sha256)
    assert.equal(row.transcriptKind, 'raw-ocr-unedited')
    assert.equal(row.manuallyEdited, false)
    assert.ok(!row.error)
  }
  const transcript = mergeOcrPassTexts(passes.map(row => row.rawText))
  const parsed = extractDeclarations(transcript)
  mergedRows.push({ sampleId: sample.id, sourcePath: sample.sourcePath, sourceSha256: sample.sha256,
    transcriptKind: 'system-derived-production-pass-merge', transcript,
    fields: CRITICAL_FIELDS.map(id => {
      const field = parsed.byId[id]; const label = sample.fields[id]
      const eligible = label.status === 'readable' && label.metricEligible === true
      const valid = field.candidates.length === 1 && field.candidates[0].valid === true && field.validation?.status === 'format_valid' && !field.conflict
      return { field: id, eligible, expected: eligible ? label.value : null, value: field.value, valid,
        correct: eligible && valid && normalizeCriticalValue(id, field.value) === normalizeCriticalValue(id, label.value),
        candidates: field.candidates, conflict: field.conflict, evidence: field.evidence }
    }),
  })
}

// The official raw-only scorer is never passed a system-derived transcript.
const rawScore = scoreCriticalFields(manifest, rawRows)
assert.equal(rawScore.runs.length, 5)
for (const run of rawScore.runs) {
  assert.equal(run.attemptedPhotos, 8)
  assert.equal(run.failedPhotos, 0)
  assert.equal(run.completeCorpusRun, true)
}
const mergedPerField = CRITICAL_FIELDS.map(id => {
  const fields = mergedRows.flatMap(row => row.fields).filter(field => field.field === id)
  return { field: id, correct: fields.filter(field => field.correct).length, eligible: fields.filter(field => field.eligible).length }
})
const summaries = [
  { mode: 'tesseract-production-merge-on-sharp-approximation', photos: 8, failedPhotos: 0,
    correct: mergedPerField.reduce((sum, field) => sum + field.correct, 0), eligible: mergedPerField.reduce((sum, field) => sum + field.eligible, 0), perField: mergedPerField },
  ...rawScore.runs.map(run => ({ mode: run.mode, photos: run.attemptedPhotos, failedPhotos: run.failedPhotos,
    correct: run.exactMatchCorrect, eligible: run.exactMatchSamples,
    perField: Object.entries(run.perField).map(([field, item]) => ({ field, correct: item.exactMatchCorrect, eligible: item.exactMatchSamples })) })),
]
const acceptedCriticalValues = rawRows.flatMap(row => {
  const sample = manifest.samples.find(sample => sample.id === row.sampleId)
  const parsed = extractDeclarations(row.rawText)
  return CRITICAL_FIELDS.flatMap(id => {
    const field = parsed.byId[id]; const label = sample.fields[id]
    const correct = label.metricEligible === true && field.candidates.length === 1 && field.candidates[0].valid === true && field.validation?.status === 'format_valid' && !field.conflict && normalizeCriticalValue(id, field.value) === normalizeCriticalValue(id, label.value)
    return correct ? [{ mode: row.mode, sampleId: row.sampleId, field: id, value: field.value, evidence: field.evidence }] : []
  })
})
assert.deepEqual(await hashFiles(), sourceHashes, 'Parser or input changed during paired comparison')
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceHashes, parserStableDuringScoring: true,
  imageHashesVerified: 8, originalOcrRowsReused: 64, inferenceRerun: false, handCorrection: false, proposalApplied: false,
  corpusRole: manifest.corpusRole, annotation: manifest.annotation,
  limitations: ['Previously used development corpus with provisional AI labels, not a holdout or legal-verdict benchmark.', 'All prior OCR bytes reused unchanged; only parser behavior changed.', 'Tesseract uses the actual merge helper on the recorded Sharp-approximated browser preprocessing baseline, not an exact Chrome E2E run.', 'Raw-only scorer is used only for the untouched Rapid/English transcripts; derived Tesseract output uses the same explicit matching criterion with separate provenance.', 'No new Chrome photo or focus result was added to this eight-photo denominator.'],
  summaries, acceptedCriticalValues, rawScore,
  tesseractDerivedScore: { mode: summaries[0].mode, scoringCriterion: 'Exactly one valid candidate, format_valid status, no conflict, frozen normalized value exact match on eligible reference only.', sampleResults: mergedRows },
}
await writeFile(`${prefix}final-parser-comparison.json`, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ sourceHashes, summaries, acceptedCriticalValues }, null, 2))
