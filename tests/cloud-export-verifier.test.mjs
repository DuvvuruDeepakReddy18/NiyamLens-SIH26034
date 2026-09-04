import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendAuditEvent } from '../src/lib/audit.mjs'
import { main, readBoundedFile, verifyCloudExport } from '../tools/verify-cloud-export.mjs'

const org = '10000000-0000-4000-8000-000000000001'
const actor = '20000000-0000-4000-8000-000000000001'
const panelId = '30000000-0000-4000-8000-000000000001'
// Byte fixtures validate signatures/hashes; they are not OCR photographs.
const original = Buffer.from([255, 216, 255, 0, 1, 2, 3, 4])
const analysis = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const data = (bytes, mime) => `data:${mime};base64,${bytes.toString('base64')}`
const raw = '  Net Content:\n500ml\nMRP:22.00\r\n'
const transcript = `\n\n[PADDLE RAW OCR · PANEL 1]\n${raw}`
async function fixture() {
  const id = 'NLM-test-case-123'
  const chain = await appendAuditEvent([], 'inspection_sealed', { inspectionId: id, status: 'manual_review' }, 'fixture-officer')
  return {
    schemaVersion: 2, id, actor: { id: actor, name: 'PERSONAL-NOT-IN-SUMMARY' }, serverVersion: 1,
    serverSealedAt: '2026-09-04T12:00:00Z', serverPayloadHash: 'a'.repeat(64), syncState: 'synced',
    clientAuditChain: chain, clientAuditUntrusted: true, ocrProvenance: { clientReported: true, independentlyVerified: false },
    text: 'Officer working text', rawOcrText: transcript, imageUrl: data(analysis, 'image/png'),
    evidenceItems: [{ id: panelId, sha256: hash(original), originalPath: `${org}/${actor}/${id}/${panelId}/original-${hash(original)}`, analysisPath: `${org}/${actor}/${id}/${panelId}/analysis-${hash(analysis)}`, originalUrl: data(original, 'image/jpeg'), analysisUrl: data(analysis, 'image/png'),
      ocrText: raw, ocrPasses: [{ id: 'raw-pass-1', text: raw, provider: 'paddleocr-js', strategy: 'local-alternative-original', confidence: null }] }],
  }
}

test('managed export verifies image bytes, raw text inclusion, and client audit without claiming server authenticity', async () => {
  const record = await fixture(); const before = JSON.stringify(record)
  const result = await verifyCloudExport(record, { sourceOriginalBytes: original })
  assert.equal(result.passed, true); assert.equal(result.sourceOriginalMatched, true)
  assert.equal(result.images.length, 2); assert.equal(result.ocr.exactPaddlePassMatches, 1)
  assert.equal(result.ocr.rawAndWorkingFieldsSeparate, true); assert.equal(result.ocr.workingDiffersFromRaw, true)
  assert.equal(result.receipt.serverPayloadHashRecomputed, false); assert.equal(result.audit.independentlyAuthentic, false)
  assert.equal(JSON.stringify(record), before)
  const output = JSON.stringify(result)
  for (const privateText of ['PERSONAL-NOT-IN-SUMMARY', raw, org, actor, panelId, 'data:image/', 'originalPath']) assert.equal(output.includes(privateText), false)
})

test('raw and working transcripts may legitimately be equal; changed raw evidence is still rejected', async () => {
  const record = await fixture(); record.text = record.rawOcrText
  assert.equal((await verifyCloudExport(record)).ocr.workingDiffersFromRaw, false)
  record.rawOcrText = record.rawOcrText.replace('500ml', '900ml')
  await assert.rejects(verifyCloudExport(record), /PADDLE_RAW_TRANSCRIPT_MISMATCH/)
})

test('corrupted image bytes, MIME, base64, and a signed URL are rejected', async () => {
  const cases = [
    [p => { p.originalUrl = data(Buffer.from([255, 216, 255, 9, 1, 2, 3, 4]), 'image/jpeg') }, /IMAGE_HASH_MISMATCH/],
    [p => { p.originalUrl = data(original, 'image/png') }, /IMAGE_MIME_SIGNATURE_MISMATCH/],
    [p => { p.originalUrl = p.originalUrl.replace(',', ', ') }, /IMAGE_NOT_PORTABLE/],
    [p => { p.originalUrl = 'https://private.example/image?token=NEVER-PRINT' }, /IMAGE_NOT_PORTABLE/],
    [p => { p.originalUrl = 'data:image/jpeg;base64,/9j/AAECAwQ===' }, /IMAGE_NOT_PORTABLE/],
  ]
  for (const [change, expected] of cases) { const record = await fixture(); change(record.evidenceItems[0]); await assert.rejects(verifyCloudExport(record), expected) }
})

test('path digest, actor, workspace, primary image, and supplied source file cannot silently disagree', async () => {
  for (const change of [
    r => { r.evidenceItems[0].sha256 = 'b'.repeat(64) },
    r => { r.evidenceItems[0].analysisPath = r.evidenceItems[0].analysisPath.replace(/analysis-.+$/, `analysis-${'c'.repeat(64)}`) },
    r => { r.actor.id = org },
    r => { r.evidenceItems[0].analysisPath = r.evidenceItems[0].analysisPath.replace(org, panelId) },
    r => { r.imageUrl = r.evidenceItems[0].originalUrl },
  ]) { const record = await fixture(); change(record); await assert.rejects(verifyCloudExport(record)) }
  await assert.rejects(verifyCloudExport(await fixture(), { sourceOriginalBytes: analysis }), /SOURCE_ORIGINAL_HASH_MISMATCH/)
})

test('missing or malformed managed receipt and trust boundary are rejected', async () => {
  for (const change of [
    r => { delete r.serverVersion }, r => { r.serverVersion = 0 }, r => { r.serverVersion = 1.5 },
    r => { r.serverPayloadHash = 'https://secret.example?token=DO-NOT-PRINT' },
    r => { r.serverPayloadHash = ['a'.repeat(64)] },
    r => { r.serverSealedAt = 'not-a-date' }, r => { r.syncState = 'queued' },
    r => { r.clientAuditUntrusted = false }, r => { r.ocrProvenance.independentlyVerified = true },
  ]) { const record = await fixture(); change(record); await assert.rejects(verifyCloudExport(record)) }
})

test('same-length raw pass edits, malformed pass history, and audit edits fail validation', async () => {
  for (const change of [
    r => { r.evidenceItems[0].ocrPasses[0].text = raw.replace('500ml', '900ml') },
    r => { r.evidenceItems[0].ocrPasses[0].text = null },
    r => { r.evidenceItems[0].ocrPasses.push({ ...r.evidenceItems[0].ocrPasses[0] }) },
    r => { r.clientAuditChain[0].payload.status = 'compliant' },
    r => { r.clientAuditChain = [] },
    r => { delete r.rawOcrText },
  ]) { const record = await fixture(); change(record); await assert.rejects(verifyCloudExport(record)) }
})

test('other provider raw pass strings are bounded but not falsely compared to merged transcripts', async () => {
  const record = await fixture(); record.evidenceItems[0].ocrPasses[0].provider = 'tesseract.js'
  record.rawOcrText = '[PANEL 1]\nMerged OCR may differ from individual alternatives'
  const result = await verifyCloudExport(record)
  assert.equal(result.ocr.exactPaddlePassMatches, 0)
  assert.equal(result.ocr.otherProviderPassContentsNotCrossChecked, 1)
  assert.equal(result.ocr.recognitionAccuracyVerified, false)
})

test('bounded named-file CLI input accepts JSON and original image without modifying either', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'niyamlens-export-verifier-'))
  const jsonPath = join(directory, 'managed.json'); const imagePath = join(directory, 'source.jpg')
  try {
    const bytes = Buffer.from(JSON.stringify(await fixture()))
    await writeFile(jsonPath, bytes); await writeFile(imagePath, original)
    const result = await main([jsonPath, '--original', imagePath])
    assert.equal(result.artifactSha256, hash(bytes)); assert.equal(result.artifactBytes, bytes.length)
    assert.deepEqual(await readBoundedFile(jsonPath), bytes); assert.deepEqual(await readBoundedFile(imagePath), original)
    await assert.rejects(readBoundedFile(jsonPath, 1), /INPUT_FILE_EMPTY_OR_TOO_LARGE/)
    await assert.rejects(main([jsonPath, '--unexpected']), /USAGE/)
    await writeFile(jsonPath, '{"bad":')
    await assert.rejects(main([jsonPath]), /EXPORT_JSON_INVALID/)
  } finally {
    for (const path of [jsonPath, imagePath]) {
      try { await unlink(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    await rmdir(directory)
  }
})

test('metadata depth and reserved keys are rejected before recursive hashing', async () => {
  const record = await fixture(); let node = record
  for (let i = 0; i < 20; i++) { node.extra = {}; node = node.extra }
  await assert.rejects(verifyCloudExport(record), /EXPORT_SHAPE_LIMIT/)
  const reserved = await fixture(); Object.defineProperty(reserved, '__proto__', { value: {}, enumerable: true })
  await assert.rejects(verifyCloudExport(reserved), /EXPORT_RESERVED_KEY/)
})
