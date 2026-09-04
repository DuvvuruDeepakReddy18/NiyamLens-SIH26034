import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { buildInspectionDocx, DOCX_MIME, REPORT_LIMITS } from '../src/lib/reportDocument.mjs'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const DATA_URL = `data:image/png;base64,${PNG}`
const HASH = createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex')
const base = () => ({ id: 'CASE-DOCX-TEST', meta: { productName: 'Synthetic <A&B> label', ocrConfidence: 99, ocrEngineConfidence: 98 }, text: 'Manual transcript: MRP Rs. 100', createdAt: '2026-09-04T10:00:00Z', sealedAt: '2026-09-04T10:01:00Z', actor: { name: 'Test officer', role: 'officer' }, result: { status: 'manual_review', score: 99, context: { rulePack: 'TEST-PACK' }, checks: [{ id: 'manufacturer', status: 'review', label: 'Manufacturer', rule: 'Rule 6(1)(a)', reason: 'Name and address require verification', evidence: 'MANUFACTURED BY' }] } })

// Read the real ZIP central directory, not a renamed HTML document. No additional
// test-only ZIP dependency is needed; the generated reports are below ZIP64 limits.
function unzip(bytes) {
  const data = Buffer.from(bytes)
  const end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  assert.ok(end >= 0, 'A ZIP end-of-central-directory record must exist')
  let cursor = data.readUInt32LE(end + 16)
  const entries = new Map()
  for (let index = 0; index < data.readUInt16LE(end + 10); index++) {
    assert.equal(data.readUInt32LE(cursor), 0x02014b50)
    const method = data.readUInt16LE(cursor + 10)
    const size = data.readUInt32LE(cursor + 20)
    const nameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const local = data.readUInt32LE(cursor + 42)
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28)
    const content = data.subarray(start, start + size)
    entries.set(name, method === 8 ? inflateRawSync(content) : content)
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
const inspect = async (record) => {
  const blob = await buildInspectionDocx(record)
  assert.equal(blob.type, DOCX_MIME)
  const entries = unzip(await blob.arrayBuffer())
  return { entries, xml: entries.get('word/document.xml').toString('utf8') }
}
const media = (entries) => [...entries.keys()].filter((name) => name.startsWith('word/media/') && !name.endsWith('/'))

test('DOCX is editable OOXML with escaped text, explicit page/table widths, headings and footer', async () => {
  const { entries, xml } = await inspect(base())
  assert.ok(entries.has('[Content_Types].xml'))
  assert.ok(entries.has('word/styles.xml'))
  assert.match(xml, /Synthetic &lt;A&amp;B&gt; label/)
  assert.match(xml, /w:pgSz w:w="11906" w:h="16838"/)
  assert.match(xml, /w:tblW w:type="dxa" w:w="9746"/)
  assert.match(xml, /w:tcW w:type="dxa" w:w="2550"/)
  assert.match(xml, /w:pStyle w:val="Heading1"/)
  assert.match(entries.get('word/footer1.xml').toString(), /PAGE/)
  assert.doesNotMatch(xml, /<html|altChunk/)
  assert.doesNotMatch(entries.get('word/_rels/document.xml.rels').toString(), /TargetMode="External"/)
})

test('manual transcripts and default numeric metadata do not acquire OCR or reliability claims', async () => {
  const { xml } = await inspect(base())
  assert.match(xml, /No completed OCR run is recorded/)
  assert.match(xml, /No OCR confidence, reliability or accuracy score is asserted/)
  assert.doesNotMatch(xml, /99%|98%|99\/100|completed OCR run is recorded in/)
  assert.match(xml, /No original OCR transcript recorded/)
})

test('field values, conflicting readings, semantic validation and reviews remain separate', async () => {
  const record = base()
  record.extraction = { fields: [{ id: 'mrp', label: 'MRP', detected: true, value: '100.00', evidence: 'MRP Rs. 100.00', validation: { status: 'conflict', message: 'Multiple printed MRP values' } }] }
  record.meta.fieldReviews = { mrp: { state: 'confirmed', value: '100.00', reason: 'Compared with physical panel' } }
  record.meta.fieldCandidates = { mrp: [{ value: '100.00', sources: ['pass-1'] }, { value: '700.00', sources: ['pass-2'] }] }
  record.reviewHistory = [{ id: 'REVIEW-1', status: 'compliant', reason: 'Department reviewer disposition', actor: { name: 'Reviewer' }, at: '2026-09-04T12:00:00Z', automatedStatus: 'manual_review' }]
  const { xml } = await inspect(record)
  for (const text of ['Automated finding (preserved)', 'MANUAL REVIEW', 'Department reviewer disposition', 'Candidate 2: 700.00', 'Multiple printed MRP values', 'Rule 6(1)(a)', 'Compared with physical panel']) assert.ok(xml.includes(text), text)
  assert.equal(record.result.status, 'manual_review')
})

test('DOCX preserves every source-region panel, OCR line, geometry, rule and officer state', async () => {
  const record = base()
  record.evidenceItems = [{ id: 'PANEL-TRACE', name: 'trace-panel.png', sha256: 'a'.repeat(64) }]
  record.extraction = { fields: [{ id: 'mrp', label: 'Maximum Retail Price', detected: true, value: '40.00', evidence: 'MRP Rs 40.00' }] }
  record.regions = [{ id: 'mrp', label: 'Maximum Retail Price', panelId: 'PANEL-TRACE', text: 'M.R.P. Rs 40.00', bbox: { x0: 11, y0: 22, x1: 133, y1: 55 }, pageWidth: 900, pageHeight: 1120 }]
  record.meta.fieldReviews = { mrp: { state: 'confirmed', value: '40.00', reason: 'Compared with source pixels' } }
  record.result.checks = [{ id: 'mrp', status: 'pass', label: 'Maximum Retail Price', rule: 'Rule 6(1)(e)', reason: 'Present', evidence: 'MRP Rs 40.00' }]
  const { xml } = await inspect(record)
  for (const text of ['Source-region traceability', 'trace-panel.png', 'M.R.P. Rs 40.00', 'x 11–133; y 22–55 px', 'Frame 900 × 1120 px', 'Rule 6(1)(e)', 'Officer: CONFIRMED']) assert.ok(xml.includes(text), text)
})

test('completed-run history and raw transcript support OCR provenance, while corrections stay visible', async () => {
  const record = base()
  record.rawOcrText = 'MRP Rs. 1OO'
  record.auditChain = [{ type: 'ocr_completed', actor: 'test', at: '2026-09-04T10:00:01Z', index: 0, hash: 'ocr-hash', previousHash: 'GENESIS' }]
  const { xml } = await inspect(record)
  assert.match(xml, /A completed OCR run is recorded/)
  assert.match(xml, /working transcript differs/)
  assert.match(xml, /MRP Rs. 1OO/)
  assert.match(xml, /Manual transcript: MRP Rs. 100/)
  const incomplete = await inspect({ ...record, rawOcrText: '' })
  assert.match(incomplete.xml, /No completed OCR run is recorded/)
})

test('same-transcript candidate conflicts survive export even without an OCR pass-candidate map', async () => {
  const record = base()
  record.extraction = { fields: [{ id: 'mrp', label: 'MRP', detected: true, value: '', conflict: true, validation: { status: 'conflict', message: 'Conflicting declarations' }, candidates: [{ value: '100.00', evidence: 'MRP 100' }, { value: '200.00', evidence: 'MRP 200' }] }] }
  const { xml } = await inspect(record)
  assert.match(xml, /Candidate 1: 100.00/)
  assert.match(xml, /Candidate 2: 200.00/)
  assert.match(xml, /Conflicting declarations/)
})

test('hydrated original and analysis PNG evidence is actually embedded, with computed byte hashes', async () => {
  const record = base()
  record.evidenceItems = [{ id: 'PANEL-1', name: 'synthetic.png', originalUrl: DATA_URL, analysisUrl: DATA_URL, sha256: HASH }]
  const { entries, xml } = await inspect(record)
  assert.ok(media(entries).length >= 1)
  assert.deepEqual(entries.get(media(entries)[0]), Buffer.from(PNG, 'base64'))
  assert.match(xml, /ORIGINAL CAPTURE/)
  assert.match(xml, /ANALYSIS DERIVATIVE/)
  assert.equal((xml.match(/<w:drawing>/g) || []).length, 2)
  assert.ok(xml.includes(HASH))
})

test('remote URLs, unsupported WebP and malformed images are omitted explicitly without network access', async () => {
  const record = base()
  record.evidenceItems = [
    { id: 'remote', originalUrl: 'https://private.example/evidence?token=DO-NOT-EXPORT', analysisUrl: 'data:image/png;base64,YWJjZA==' },
    { id: 'webp', originalUrl: 'data:image/webp;base64,UklGRg==', analysisUrl: DATA_URL },
  ]
  const originalFetch = globalThis.fetch
  let fetched = false
  globalThis.fetch = () => { fetched = true; throw new Error('No network access allowed') }
  try {
    const { entries, xml } = await inspect(record)
    assert.match(xml, /Remote or unresolved image omitted/)
    assert.match(xml, /Original WebP is not embedded/)
    assert.match(xml, /PNG signature, header or terminal chunk is invalid/)
    assert.doesNotMatch(xml, /DO-NOT-EXPORT|private.example/)
    assert.equal(media(entries).length, 1)
    assert.equal(fetched, false)
  } finally { globalThis.fetch = originalFetch }
})

test('mismatched original image hash is explicitly omitted rather than silently trusted', async () => {
  const record = { ...base(), evidenceItems: [{ id: 'bad-hash', originalUrl: DATA_URL, sha256: '0'.repeat(64) }] }
  const { entries, xml } = await inspect(record)
  assert.equal(media(entries).length, 0)
  assert.match(xml, /bytes do not match the recorded SHA-256/)
})

test('unsafe image dimensions and oversized image text are bounded before packing', async () => {
  const huge = Buffer.from(PNG, 'base64')
  huge.writeUInt32BE(40001, 16)
  const record = { ...base(), evidenceItems: [{ id: 'huge', originalUrl: `data:image/png;base64,${huge.toString('base64')}`, analysisUrl: `data:image/png;base64,${'A'.repeat(Math.ceil(REPORT_LIMITS.imageBytes / 3) * 4 + 100)}` }] }
  const { entries, xml } = await inspect(record)
  assert.equal(media(entries).length, 0)
  assert.match(xml, /40-megapixel safety limit/)
  assert.match(xml, /15 MiB export limit/)
})

test('oversized record collections and transcripts fail honestly instead of truncating', async () => {
  await assert.rejects(buildInspectionDocx({ ...base(), evidenceItems: Array.from({ length: 5 }, (_, id) => ({ id })) }), /four captured evidence panels/)
  await assert.rejects(buildInspectionDocx({ ...base(), regions: Array.from({ length: 129 }, (_, id) => ({ id })) }), /bounded DOCX export size/)
  await assert.rejects(buildInspectionDocx({ ...base(), text: 'x'.repeat(REPORT_LIMITS.textCharacters + 1) }), /Nothing was truncated/)
  await assert.rejects(buildInspectionDocx(null), /inspection record is required/)
})

test('server receipt and officer-supplied timeline do not become independent certification', async () => {
  const record = { ...base(), serverVersion: 2, serverPayloadHash: 'server-hash', serverSealedAt: '2026-09-04', clientAuditUntrusted: true, clientAuditChain: [{ type: 'capture', index: 0, actor: 'Officer', hash: 'client-hash', previousHash: 'GENESIS', payload: { access_token: 'SECRET-IGNORED' } }] }
  const { xml } = await inspect(record)
  assert.match(xml, /Officer-supplied capture timeline/)
  assert.match(xml, /not an independently verified server audit/)
  assert.match(xml, /server-hash/)
  assert.match(xml, /client-hash/)
  assert.doesNotMatch(xml, /SECRET-IGNORED|Audit chain verified/)
})
