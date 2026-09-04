// Generate a clearly synthetic DOCX fixture for visual acceptance. No live case,
// browser session, secret, or network resource is read by this tool.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { buildInspectionDocx } from '../src/lib/reportDocument.mjs'

const crc32 = (bytes) => {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0) }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
const chunk = (type, data) => {
  const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(type, 4)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])))
  return Buffer.concat([header, data, checksum])
}
const sampleImage = () => {
  const width = 640; const height = 320
  const pixels = Buffer.alloc((1 + width * 3) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 3) + 1 + x * 3
    const dark = x < 12 || y < 12 || x > width - 13 || y > height - 13 || (y > 65 && y < 110) || (y > 170 && y < 185 && x > 55 && x < 585)
    pixels.set(dark ? [22, 59, 67] : [236, 247, 242], offset)
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
const png = sampleImage()
const dataUrl = `data:image/png;base64,${png.toString('base64')}`
const record = {
  id: 'SYNTHETIC-DOCX-ACCEPTANCE', controlledFixture: true,
  createdAt: '2026-09-04T10:00:00Z', sealedAt: '2026-09-04T10:03:00Z',
  actor: { id: 'synthetic-officer', name: 'Synthetic test officer', role: 'officer' },
  meta: { productName: 'Synthetic inspection — document layout test', category: 'general', commodityClass: 'standard', quantity: 100, unit: 'g', pdpArea: 160, pdpUncertainty: 5, measurementSurface: 'flat', referenceMm: 20, measurementUncertainty: 5, ocrSource: 'synthetic-test', ocrLanguage: 'eng', fieldReviews: { mrp: { state: 'confirmed', value: '100.00', reason: 'Synthetic reviewer compared the stored test panel.' } }, fieldCandidates: { mrp: [{ value: '100.00', sources: ['test-pass-a'] }, { value: '700.00', sources: ['test-pass-b'] }] } },
  rawOcrText: 'SYNTHETIC OCR\nMRP Rs. 1OO.OO\nMANUFACTURED BY',
  text: 'SYNTHETIC REVIEWED TEXT\nMRP Rs. 100.00\nMANUFACTURED BY',
  rulePack: 'SYNTHETIC-TEST-ONLY',
  extraction: { fields: [{ id: 'mrp', label: 'Maximum Retail Price', value: '100.00', detected: true, evidence: 'MRP Rs. 100.00', validation: { status: 'review', message: 'Conflicting OCR pass needs physical comparison.' } }, { id: 'responsibleEntity', label: 'Manufacturer', detected: false, value: '', evidence: 'MANUFACTURED BY', validation: { status: 'incomplete', message: 'Heading alone is not an identity/address.' } }] },
  automatedResult: { status: 'manual_review', checks: [{ id: 'manufacturer', label: 'Manufacturer name and address', status: 'review', rule: 'Rule 6(1)(a) — source attribution example', reason: 'No complete entity declaration supplied in the synthetic test.', evidence: 'MANUFACTURED BY' }, { id: 'fontHeight', label: 'Physical font height', status: 'review', rule: 'Rule 7 / Table I — source attribution example', reason: 'No verified physical calibration in this synthetic fixture.', evidence: 'Unverified sample image' }] },
  reviewHistory: [{ id: 'SYNTHETIC-REVIEW-1', status: 'non_compliant', reason: 'Synthetic disposition for layout validation only; no real package was inspected.', actor: { name: 'Synthetic supervisor' }, at: '2026-09-04T10:05:00Z', automatedStatus: 'manual_review' }],
  evidenceItems: [{ id: 'SYNTHETIC-PANEL-A', name: 'Synthetic geometric test card — NOT a real label', panelRole: 'price_date', capturedAt: '2026-09-04T10:00:05Z', originalUrl: dataUrl, analysisUrl: dataUrl, sha256: createHash('sha256').update(png).digest('hex') }],
  clientAuditUntrusted: true, clientAuditChain: [{ index: 0, type: 'synthetic_fixture_created', actor: 'test-tool', at: '2026-09-04T10:00:00Z', hash: 'SYNTHETIC-NOT-A-REAL-HASH', previousHash: 'GENESIS' }, { index: 1, type: 'ocr_completed', actor: 'test-tool', at: '2026-09-04T10:01:00Z', hash: 'SYNTHETIC-OCR-EVENT', previousHash: 'SYNTHETIC-NOT-A-REAL-HASH' }],
}
const target = resolve('reports/fixes-2026-09-04/synthetic-inspection-report.docx')
await mkdir(dirname(target), { recursive: true })
const blob = await buildInspectionDocx(record)
await writeFile(target, new Uint8Array(await blob.arrayBuffer()))
console.log(JSON.stringify({ artifact: target, bytes: blob.size, type: blob.type, synthetic: true, visualReviewRequired: true }))
