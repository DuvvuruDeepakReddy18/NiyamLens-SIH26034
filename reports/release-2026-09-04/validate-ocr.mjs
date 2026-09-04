// Release-only reproduction: reads historical OCR unchanged; performs no inference,
// browser automation, application mutation, or network requests.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { main as scoreRaw } from '../../tools/score-critical-fields.mjs'
import { extractDeclarations } from '../../src/lib/extraction.mjs'
import { CRITICAL_FIELDS, normalizeCriticalValue } from '../../src/lib/criticalFieldBenchmark.mjs'
import { mergeOcrPassTexts } from '../../src/lib/vision.mjs'
import { buildInspectionDocx } from '../../src/lib/reportDocument.mjs'

const output = 'reports/release-2026-09-04/'
const files = [
  'datasets/critical-fields.v1.json',
  'reports/recognition-2026-09-04/critical-baseline-raw-passes.jsonl',
  'reports/recognition-2026-09-04/rapidocr-default-raw.json',
  'reports/recognition-2026-09-04-pass2/english-strategies-raw.json',
  'src/lib/labelParser.mjs', 'src/lib/extraction.mjs',
  'src/lib/criticalFieldBenchmark.mjs', 'src/lib/vision.mjs',
  'src/lib/reportDocument.mjs',
]
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, sha(await readFile(path))])))
const sourceHashes = await hashes()
const rawScore = await scoreRaw(['--input', files[1], '--input', files[2], '--input', files[3], '--verify-images', '--output', `${output}frozen-raw-scores.json`])
assert.equal(rawScore.sourceVerification.count, 8)
assert.equal(rawScore.runs.length, 8)
const manifest = JSON.parse(await readFile(files[0], 'utf8'))
const baseline = (await readFile(files[1], 'utf8')).trim().split(/\r?\n/).map(JSON.parse).filter(row => row.type === 'result')
assert.equal(baseline.length, 24)
const mergedRows = manifest.samples.map(sample => {
  const rows = baseline.filter(row => row.sampleId === sample.id)
  assert.deepEqual(rows.map(row => row.variant), ['standard', 'full-gray', 'reverse-sparse'])
  for (const row of rows) {
    assert.equal(row.sourcePath, sample.sourcePath)
    assert.equal(row.imageSha256, sample.sha256)
    assert.ok(!row.error)
  }
  const transcript = mergeOcrPassTexts(rows.map(row => row.rawText))
  const extraction = extractDeclarations(transcript)
  return { sampleId: sample.id, transcriptKind: 'system-derived-production-pass-merge', transcript,
    fields: CRITICAL_FIELDS.map(id => {
      const field = extraction.byId[id], label = sample.fields[id]
      const eligible = label.status === 'readable' && label.metricEligible === true
      const valid = field.candidates.length === 1 && field.candidates[0].valid === true && field.validation?.status === 'format_valid' && !field.conflict
      return { field: id, eligible, expected: eligible ? label.value : null, value: field.value, valid,
        correct: eligible && valid && normalizeCriticalValue(id, field.value) === normalizeCriticalValue(id, label.value),
        conflict: field.conflict, candidates: field.candidates }
    }) }
})
const perField = CRITICAL_FIELDS.map(id => {
  const rows = mergedRows.flatMap(row => row.fields).filter(row => row.field === id)
  return { field: id, correct: rows.filter(row => row.correct).length, eligible: rows.filter(row => row.eligible).length }
})
const summary = { generatedAt: new Date().toISOString(), sourceHashes, rawRowsScored: 64,
  sourceImagesVerified: 8, inferenceRerun: false, manuallyCorrected: false,
  corpusRole: manifest.corpusRole, annotation: manifest.annotation,
  rawModes: rawScore.runs.map(run => ({ mode: run.mode, photos: run.attemptedPhotos, failedPhotos: run.failedPhotos,
    completeCorpusRun: run.completeCorpusRun, correct: run.exactMatchCorrect, eligible: run.exactMatchSamples, perField: run.perField })),
  derivedTesseractMerge: { photos: 8, failedPhotos: 0, correct: perField.reduce((sum, row) => sum + row.correct, 0),
    eligible: perField.reduce((sum, row) => sum + row.eligible, 0), perField, samples: mergedRows },
  limitations: ['Previously seen development photos and provisional AI visual labels are not independent ground truth.',
    'No actual Chrome Paddle result is part of this frozen historical denominator.',
    'No inference timing, recognition upgrade, legal validity, or real cloud acceptance is established.',
    'Tesseract preprocessing is the previously recorded Sharp approximation, not a new browser run.'] }
assert.equal(summary.derivedTesseractMerge.correct, 0)
assert.equal(summary.derivedTesseractMerge.eligible, 10)
for (const run of summary.rawModes) {
  assert.equal(run.photos, 8)
  assert.equal(run.failedPhotos, 0)
  assert.equal(run.completeCorpusRun, true)
  assert.equal(run.eligible, 10)
  assert.equal(run.correct, run.mode.includes('critical-baseline') ? 0 : 1)
}

// Exact same crop text observed previously, not a new recognition measurement.
const crop = extractDeclarations('[PADDLE FOCUSED RAW OCR · PANEL 1]\nNet Content:\n500ml\nMRP:22.00\nlinclusive all taxes')
assert.equal(crop.byId.productName.detected, false)
assert.equal(crop.byId.netQuantity.value, '500 ml')
assert.equal(crop.byId.mrp.value, '22.00')
assert.equal(crop.raw.endsWith('linclusive all taxes'), true)
summary.titleRegression = { productNameDetected: false, quantity: crop.byId.netQuantity.value, mrp: crop.byId.mrp.value,
  interpretation: 'Parser replay only; the incorrect raw tax wording remains unchanged. Not an OCR rerun.' }

// Exercise the real DOCX generator with an explicitly synthetic record and no
// external images. Target is new/exclusive; earlier evidence is not overwritten.
const fixture = { id: 'SYNTHETIC-RELEASE-20260904', createdAt: '2026-09-04T10:00:00Z', sealedAt: '2026-09-04T10:01:00Z',
  actor: { name: 'Synthetic validation officer', role: 'officer' }, meta: { productName: 'Synthetic release check <A&B>' },
  text: 'Synthetic reviewed text: MRP Rs. 100.00', rawOcrText: 'Synthetic original text: MRP Rs. 1OO.OO',
  result: { status: 'manual_review', checks: [{ id: 'manufacturer', label: 'Manufacturer', status: 'review', rule: 'SYNTHETIC TEST RULE', reason: 'Synthetic fixture; not a real inspection.' }] },
  clientAuditUntrusted: true, clientAuditChain: [{ index: 0, type: 'ocr_completed', at: '2026-09-04T10:00:30Z', actor: 'synthetic', hash: 'synthetic-not-real', previousHash: 'GENESIS' }] }
const blob = await buildInspectionDocx(fixture)
const bytes = Buffer.from(await blob.arrayBuffer())
const entries = new Map()
const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
assert.ok(end >= 0)
let cursor = bytes.readUInt32LE(end + 16)
for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
  assert.equal(bytes.readUInt32LE(cursor), 0x02014b50)
  const method = bytes.readUInt16LE(cursor + 10), length = bytes.readUInt32LE(cursor + 20)
  const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32)
  const local = bytes.readUInt32LE(cursor + 42), name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
  entries.set(name, method === 8 ? inflateRawSync(bytes.subarray(start, start + length)) : bytes.subarray(start, start + length))
  cursor += 46 + nameLength + extraLength + commentLength
}
const xml = entries.get('word/document.xml')?.toString('utf8') || ''
assert.ok(entries.has('[Content_Types].xml'))
for (const phrase of ['Synthetic release check &lt;A&amp;B&gt;', 'MRP Rs. 1OO.OO', 'MRP Rs. 100.00', 'MANUAL REVIEW', 'not an independently verified server audit']) assert.ok(xml.includes(phrase), phrase)
assert.doesNotMatch(xml, /<html|altChunk/)
const docxPath = `${output}synthetic-export-validation.docx`
await writeFile(docxPath, bytes, { flag: 'wx' })
summary.syntheticDocx = { path: docxPath, bytes: bytes.length, sha256: sha(bytes), zipEntries: entries.size, mime: blob.type,
  rawAndReviewedTextVerified: true, escapedTextVerified: true, manualReviewVerified: true,
  independentAuditDisclaimerVerified: true, nativeDocxStructureVerified: true,
  limitations: 'Synthetic pure-generator check only; no Word rendering, browser download, real-case export or file-open acceptance is claimed.' }
assert.deepEqual(await hashes(), sourceHashes, 'An input or tested source changed during validation')
summary.sourceHashesStableDuringValidation = true
await writeFile(`${output}ocr-validation.json`, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ rawModes: summary.rawModes, derivedTesseractMerge: { ...summary.derivedTesseractMerge, samples: undefined }, titleRegression: summary.titleRegression, syntheticDocx: summary.syntheticDocx, sourceHashes }, null, 2))
