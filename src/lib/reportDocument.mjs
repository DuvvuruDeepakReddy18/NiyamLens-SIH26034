import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun, PageBreak,
  PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType,
  TableRow, TextRun, WidthType,
} from 'docx'
import { auditPresentation } from './caseRecords.mjs'
import { ocrProvenance } from './inspectionWorkflow.mjs'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const REPORT_LIMITS = Object.freeze({ panels: 4, imageBytes: 15 * 1024 * 1024, totalImageBytes: 64 * 1024 * 1024, imagePixels: 40_000_000, textCharacters: 500_000 })
const PAGE_WIDTH = 11906
const CONTENT_WIDTH = PAGE_WIDTH - 2160
const INK = '163B43'
const MUTED = '52646A'
const GREEN = '008D76'
const plain = (value, fallback = 'Not recorded') => value === undefined || value === null || value === '' ? fallback : String(value)
const array = (value) => Array.isArray(value) ? value : []
const safeText = (value) => plain(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[\uD800-\uDFFF]/gu, '\uFFFD')
const status = (value) => plain(value).replace(/_/g, ' ').toUpperCase()
const actorName = (actor) => actor && typeof actor === 'object' ? plain(actor.name || actor.id) : plain(actor)
const lines = (value) => safeText(value).split(/\r?\n/)
const paragraph = (text, options = {}) => new Paragraph({ spacing: { after: 90, line: 270 }, ...options, children: [new TextRun({ text: safeText(text), color: INK, size: 21, ...options.run })] })
const paragraphs = (text, options = {}) => lines(text).map((line) => paragraph(line, options))
const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({ text: safeText(text), heading: level, spacing: { before: 260, after: 120 }, keepNext: true })
const pageBreak = () => new Paragraph({ children: [new PageBreak()] })
const note = (text) => paragraph(text, { run: { color: MUTED, size: 19 } })
const cell = (text, width, header = false) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  margins: { top: 95, bottom: 95, left: 120, right: 120 },
  shading: header ? { type: ShadingType.CLEAR, fill: INK } : undefined,
  children: paragraphs(text, { spacing: { after: 45, line: 245 }, run: { size: 19, bold: header, color: header ? 'FFFFFF' : INK } }),
})
const table = (headers, rows, widths) => new Table({
  width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
  borders: Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map((side) => [side, { style: BorderStyle.SINGLE, size: 3, color: 'DCE6E5' }])),
  rows: [new TableRow({ tableHeader: true, children: headers.map((value, index) => cell(value, widths[index], true)) }), ...rows.map((row) => new TableRow({ children: row.map((value, index) => cell(value, widths[index])) }))],
})
const keyValues = (rows) => table(['Item', 'Recorded value'], rows, [2550, CONTENT_WIDTH - 2550])

// Parse only raster data already supplied with the record. No fetch, external image
// relationship, filesystem access, or inferred scale/dimensions are used here.
function decodeImage(url, budget) {
  if (!url) return { omitted: 'No hydrated image bytes were supplied.' }
  if (typeof url !== 'string' || !url.startsWith('data:')) return { omitted: 'Remote or unresolved image omitted; hydrate the case before export. No URL was fetched or included.' }
  if (url.length > Math.ceil(REPORT_LIMITS.imageBytes / 3) * 4 + 80) return { omitted: 'Image exceeds the 15 MiB export limit.' }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(url)
  if (!match || !match[2] || match[2].length % 4 !== 0) return { omitted: 'Invalid or unsupported raster data URL.' }
  const type = match[1].toLowerCase()
  if (type === 'webp') return { omitted: 'Original WebP is not embedded in Word for compatibility. A separately supplied JPEG/PNG analysis image is included when available; it is not the original.' }
  let data
  try { data = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0)) } catch { return { omitted: 'Invalid base64 image bytes.' } }
  if (!data.length || data.length > REPORT_LIMITS.imageBytes) return { omitted: 'Empty image or image exceeds the 15 MiB export limit.' }
  if (budget.bytes + data.length > REPORT_LIMITS.totalImageBytes) return { omitted: 'Image omitted because the document reached its 64 MiB image-byte safety limit.' }
  let width = 0; let height = 0
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (type === 'png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (data.length < 45 || !signature.every((byte, index) => data[index] === byte) || view.getUint32(8) !== 13 || String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR' || String.fromCharCode(...data.subarray(data.length - 8, data.length - 4)) !== 'IEND') return { omitted: 'PNG signature, header or terminal chunk is invalid.' }
    width = view.getUint32(16); height = view.getUint32(20)
  } else {
    if (data.length < 12 || data[0] !== 255 || data[1] !== 216 || data.at(-2) !== 255 || data.at(-1) !== 217) return { omitted: 'JPEG signature or terminal marker is invalid.' }
    let offset = 2
    while (offset + 4 <= data.length) {
      if (data[offset] !== 255) break
      while (data[offset] === 255) offset++
      const marker = data[offset++]
      if (marker === 0xDA || marker === 0xD9) break
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue
      if (offset + 2 > data.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > data.length) break
      if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break
      }
      offset += length
    }
  }
  if (!width || !height || width * height > REPORT_LIMITS.imagePixels || width > 40000 || height > 40000) return { omitted: 'Image dimensions are invalid or exceed the 40-megapixel safety limit.' }
  budget.bytes += data.length
  const scale = Math.min(1, 570 / width, 315 / height)
  return { data, type: type === 'jpeg' ? 'jpg' : 'png', width: Math.round(width * scale), height: Math.round(height * scale) }
}

function validateRecordSize(record, panels, fields, checks, reviews, events) {
  if (panels.length > REPORT_LIMITS.panels) throw new Error('DOCX export supports up to four captured evidence panels; no panels were silently dropped.')
  if (fields.length > 128 || checks.length > 256 || reviews.length > 500 || events.length > 1000) throw new Error('This record exceeds the bounded DOCX export size. Export smaller records or the complete JSON instead.')
  const selected = [record.id, record.text, record.rawOcrText, record.meta, fields, checks, reviews, events.map(({ payload, ...event }) => event)]
  let length
  try { length = JSON.stringify(selected).length } catch { throw new Error('The report contains cyclic or unsupported metadata.') }
  if (length > REPORT_LIMITS.textCharacters) throw new Error('Report text exceeds the 500,000-character DOCX safety limit. Nothing was truncated.')
}

/** Build a real editable OOXML document. Caller hydrates cloud evidence first.
 * Returns a Blob; no record mutation, remote fetches, or authentication access.
 */
export async function buildInspectionDocx(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('An inspection record is required for DOCX export.')
  const meta = record.meta || {}
  const result = record.automatedResult || record.result || {}
  const panels = array(record.evidenceItems).length ? record.evidenceItems : record.imageUrl ? [{ id: 'legacy', name: record.fileName, analysisUrl: record.imageUrl }] : []
  const fields = array(record.extraction?.fields)
  const checks = array(result.checks)
  const reviews = array(record.reviewHistory).length ? record.reviewHistory : record.supervisorReview ? [record.supervisorReview] : []
  const audit = auditPresentation(record)
  validateRecordSize(record, panels, fields, checks, reviews, audit.events)
  const provenance = ocrProvenance(record)
  const recordedRun = provenance.hasRun
  const latestReview = reviews.at(-1)
  const children = [
    paragraph('NIYAMLENS', { spacing: { before: 80, after: 90 }, run: { size: 42, bold: true, color: INK } }),
    paragraph('EDITABLE INSPECTION REPORT', { run: { size: 21, bold: true, color: GREEN } }),
    heading(meta.productName || 'Unnamed packaged commodity', HeadingLevel.TITLE),
    note('Decision support only. This editable document is not a statutory determination or independently certified evidence. Edits made in Word do not update the sealed application record.'),
    keyValues([
      ['Case ID', plain(record.id)], ['Created / sealed', `${plain(record.createdAt)} / ${plain(record.sealedAt)}`],
      ['Officer', `${actorName(record.actor)} · ${plain(record.actor?.role)}`],
      ['Automated finding (preserved)', status(result.status)],
      ['Latest officer disposition', latestReview ? `${status(latestReview.status)} — ${plain(latestReview.reason)}` : 'No officer disposition recorded.'],
      ['Rule-pack version', plain(record.rulePack || result.context?.rulePack)],
      ['Capture provenance', record.controlledFixture ? 'CONTROLLED / SYNTHETIC FIXTURE — not field validation.' : record.challenge?.id ? `Blind challenge ${plain(record.challenge.code || record.challenge.id)}; challenge flag is not independent proof of an unseen package.` : 'Standard capture; provenance remains officer supplied.'],
    ]),
    heading('Recognition and human review'),
    note(recordedRun ? 'A completed OCR run is recorded in the supplied case history. OCR output and any engine scores are client/provider observations, not independently certified accuracy.' : 'No completed OCR run is recorded. Text is manual or its provenance is unverified. No OCR confidence, reliability or accuracy score is asserted.'),
    ...((record.rawOcrText && !recordedRun) ? [note('An original-transcript string exists, but no completed-run record accompanies it; the string alone does not prove OCR execution.')] : []),
    note(record.rawOcrText === record.text && record.rawOcrText ? 'The working transcript matches the stored original transcript exactly.' : record.rawOcrText ? 'The working transcript differs from the stored original. Both versions are preserved later in this document.' : 'No original OCR transcript is available for comparison.'),
    heading('Recorded inspection context'),
    keyValues([
      ['Category / commodity class', `${plain(meta.category)} / ${plain(meta.commodityClass)}`],
      ['Net quantity / barcode', `${plain(meta.quantity)} ${plain(meta.unit, '')} / ${plain(meta.barcode)}`],
      ['All declaration panels captured', meta.allPanelsCaptured === true ? 'Officer assertion: yes' : 'Not confirmed'],
      ['Physical PDP', `${plain(meta.pdpArea)} cm²; supplied uncertainty ${plain(meta.pdpUncertainty)}%; confirmation: ${meta.pdpConfirmed === true ? 'officer asserted' : 'not confirmed'}`],
      ['Measurement', `${plain(meta.measurementSurface)} surface; reference ${plain(meta.referenceMm)} mm; supplied uncertainty ${plain(meta.measurementUncertainty)}%; calibration: ${meta.measurementConfirmed === true ? 'officer asserted, not laboratory certification' : 'not confirmed'}`],
      ['Classification', meta.classificationConfirmed === true ? 'Officer asserted; applicability still requires legal review.' : 'Not confirmed'],
    ]),
  ]
  if (recordedRun) {
    children.push(note(`Recorded OCR source: ${plain(provenance.source)}; language: ${plain(meta.ocrLanguage)}; completed: ${plain(provenance.completedAt)}. No numeric score is treated as a field-accuracy measure.`))
  }
  children.push(heading('Structured declarations and verification'))
  if (fields.length) children.push(table(['Field', 'Extracted value', 'Officer review', 'Source evidence / validation / conflicting readings'], fields.map((field) => {
    const review = meta.fieldReviews?.[field.id]
    const conflict = [...array(field.candidates), ...array(meta.fieldCandidates?.[field.id])].filter((candidate, index, candidates) => candidates.findIndex((other) => plain(other.value, '') === plain(candidate.value, '') && plain(other.evidence, '') === plain(candidate.evidence, '')) === index)
    return [plain(field.label || field.id), field.detected ? plain(field.value, '(detected without an extracted value)') : 'Not detected', `${status(review?.state || 'unreviewed')}\n${plain(review?.reason, 'No review reason recorded.')}\nConfirmed text: ${plain(review?.value, 'Not supplied')}`, [plain(field.evidence, 'No source region text recorded.'), `Validation: ${plain(field.validation?.status, 'Not recorded')} — ${plain(field.validation?.message, 'No semantic validation statement recorded.')}`, ...conflict.map((candidate, index) => `Candidate ${index + 1}: ${plain(candidate.value)}; source passes: ${array(candidate.sources).join(', ') || 'not recorded'}`)].join('\n')]
  }), [1500, 1800, 2150, CONTENT_WIDTH - 5450]))
  else children.push(note('No structured declaration fields were stored. This export does not silently rerun OCR or regenerate a historical result.'))

  children.push(heading('Rule-by-rule automated findings'))
  if (checks.length) children.push(table(['Finding', 'Check and authority', 'Reason and recorded evidence'], checks.map((check) => [status(check.status), `${plain(check.label || check.id)}\n${plain(check.rule, 'Authority not recorded')}`, `${plain(check.reason)}\nEvidence: ${plain(check.evidence)}${check.measured !== undefined ? `\nMeasured: ${plain(check.measured)}; minimum: ${plain(check.minimum)}` : ''}`]), [1500, 2950, CONTENT_WIDTH - 4450]))
  else children.push(note('No automated rule findings were stored.'))

  children.push(heading('Officer disposition history'))
  if (reviews.length) reviews.forEach((review, index) => children.push(heading(`${index + 1}. ${status(review.status)}`, HeadingLevel.HEADING_2), ...paragraphs(review.reason), note(`${actorName(review.actor)} · ${plain(review.at)} · review ID ${plain(review.id)} · preserved automated status ${status(review.automatedStatus || result.status)}`)))
  else children.push(note('No disposition has been recorded. Automated findings have not been replaced by an officer decision.'))

  children.push(heading('Server receipt and trust boundary'))
  if (record.serverVersion) children.push(keyValues([['Version / received', `${record.serverVersion} / ${plain(record.serverSealedAt)}`], ['Server payload SHA-256', plain(record.serverPayloadHash)]]))
  else children.push(note('No server receipt is present. This record must not be represented as server-sealed.'))
  children.push(note('A server receipt records persistence, not truth of a photograph or legal approval. Database administrators remain privileged. Internal hashes and client observations are not independent tamper-proof certification.'))

  const budget = { bytes: 0 }
  children.push(pageBreak(), heading('Captured-panel image evidence'))
  if (!panels.length) children.push(note('No captured-panel images are present in this record.'))
  for (const [index, panel] of panels.entries()) {
    if (index) children.push(pageBreak())
    children.push(heading(`Panel ${index + 1} / ${panels.length} — ${plain(panel.name || panel.id, 'Unnamed panel')}`, HeadingLevel.HEADING_2), note(`Role: ${plain(panel.panelRole)} · captured: ${plain(panel.capturedAt)} · panel ID: ${plain(panel.id)}`), note(`Recorded original SHA-256: ${plain(panel.sha256, 'No original digest recorded')}`))
    for (const kind of ['original', 'analysis']) {
      const decoded = decodeImage(panel[`${kind}Url`], budget)
      children.push(paragraph(kind === 'original' ? 'ORIGINAL CAPTURE' : 'ANALYSIS DERIVATIVE — may be transformed', { keepNext: true, run: { bold: true, size: 19, color: GREEN } }))
      if (decoded.omitted) children.push(note(`Image omitted: ${decoded.omitted}`))
      else {
        const digest = globalThis.crypto?.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', decoded.data)), (byte) => byte.toString(16).padStart(2, '0')).join('') : ''
        const expected = kind === 'original' ? panel.sha256 : panel.analysisSha256 || panel.analysisPath?.match(/analysis-([a-f0-9]{64})$/)?.[1]
        if (digest && /^[a-f0-9]{64}$/i.test(expected || '') && digest !== expected.toLowerCase()) {
          children.push(note('Image omitted: embedded bytes do not match the recorded SHA-256. Reopen the verified case before exporting.'))
        } else {
          children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 110 }, children: [new ImageRun({ type: decoded.type, data: decoded.data, transformation: { width: decoded.width, height: decoded.height }, altText: { title: `Panel ${index + 1} ${kind}`, description: `${kind} image; visual evidence supplied by the case, not independent certification.`, name: `${plain(panel.id, 'panel')}-${kind}` } })] }))
          const comparison = !expected ? 'No stored digest is available for this image.' : !/^[a-f0-9]{64}$/i.test(expected) ? 'The stored digest is invalid; comparison was not possible.' : digest ? 'Embedded bytes match the stored digest; this does not certify the photographed product.' : 'The stored digest could not be compared in this environment.'
          children.push(note(`Embedded ${kind} byte SHA-256: ${digest || 'Hash computation unavailable'}. ${comparison}`))
        }
      }
    }
    const measurement = meta.panelMeasurements?.[panel.id]
    if (measurement) children.push(note(`Recorded panel measurement: reference ${plain(measurement.referencePx)} px; glyph height ${plain(measurement.glyphPx)} px; glyph width ${plain(measurement.glyphWidthPx)} px. These values do not establish laboratory calibration.`))
  }

  children.push(pageBreak(), heading('Original OCR transcript — before corrections'), ...paragraphs(record.rawOcrText || 'No original OCR transcript recorded. Text may be manual or legacy evidence.'), heading('Working / officer-reviewed transcript'), ...paragraphs(record.text || 'No working transcript recorded.'), heading(audit.untrusted ? 'Officer-supplied capture timeline' : 'Local capture timeline'), note(audit.untrusted ? 'Preserved client observations. These events are not an independently verified server audit.' : 'Local event hashes are supplied with the record. This export does not independently certify the event chain or physical package.'))
  if (audit.events.length) children.push(table(['Event / actor / time', 'Recorded hashes'], audit.events.map((event) => [`${plain(event.index)}. ${plain(event.type)}\n${actorName(event.actor)}\n${plain(event.at)}`, `Hash: ${plain(event.hash)}\nPrevious: ${plain(event.previousHash)}`]), [3800, CONTENT_WIDTH - 3800]))
  else children.push(note('No capture timeline was stored.'))
  children.push(heading('Scope and use'), note('Verify the applicable amendment dates, package classification, physical declarations and measurement method with an authorised Legal Metrology officer. This report preserves recorded findings; it does not assert nationwide validation, regulator approval, authenticity of a manufacturer, or an enforcement-grade determination.'))

  const document = new Document({
    creator: 'NiyamLens', title: `NiyamLens inspection ${plain(record.id)}`, description: 'Editable decision-support inspection report; no independent certification.',
    styles: { default: { document: { run: { font: 'Calibri', size: 21, color: INK }, paragraph: { spacing: { after: 90, line: 270 } } } }, paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { size: 34, bold: true, color: INK }, paragraph: { spacing: { before: 130, after: 180 }, keepNext: true } },
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', run: { size: 27, bold: true, color: INK }, paragraph: { outlineLevel: 0, keepNext: true } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', run: { size: 23, bold: true, color: GREEN }, paragraph: { outlineLevel: 1, keepNext: true } },
    ] },
    sections: [{ properties: { page: { size: { width: PAGE_WIDTH, height: 16838 }, margin: { top: 960, bottom: 960, left: 1080, right: 1080 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'NIYAMLENS · DECISION SUPPORT  |  ', size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED })] })] }) }, children }],
  })
  return Packer.toBlob(document)
}
