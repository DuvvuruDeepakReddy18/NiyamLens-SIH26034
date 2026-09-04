import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { planPaddleFocus } from '../src/lib/ocrFocusGuidance.mjs'

const sourcePath = 'reports/recognition-2026-09-04/rapidocr-default-raw.json'
const outputPath = 'reports/release-fixes-2026-09-04/focus-guidance-diagnostics.json'
const sourceBytes = await readFile(sourcePath)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const source = JSON.parse(sourceBytes)
assert.equal(source.rows.length, 8)
const rows = []
for (const row of source.rows) {
  assert.equal(row.transcriptKind, 'raw-ocr-unedited')
  assert.equal(row.manuallyEdited, false)
  const image = await readFile(row.sourcePath)
  assert.equal(digest(image), row.sourceSha256)
  const dimensions = await sharp(image).metadata()
  assert.equal(row.metadata.texts.length, row.metadata.boxes.length)
  const item = { id: row.sampleId, imageUrl: row.sourcePath, width: dimensions.width, height: dimensions.height, source: 'frozen-offline-raw-original-frame', lines: row.metadata.texts.map((text, i) => ({ id: `${row.sampleId}:line-${i}`, panelId: row.sampleId, text, box: row.metadata.boxes[i] })) }
  const guidance = planPaddleFocus(item)
  rows.push({ sampleId: row.sampleId, sourcePath: row.sourcePath, sourceSha256: row.sourceSha256, frame: { width: item.width, height: item.height }, ...guidance })
}
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), source: { path: sourcePath, sha256: digest(sourceBytes), rows: 8 }, plannerSha256: digest(await readFile('src/lib/ocrFocusGuidance.mjs')), method: 'Pure geometric acquisition-planner replay over previously recorded original-frame OCR polygons; no new inference.', imageHashesVerified: rows.length, photosWithSuggestedRegions: rows.filter(row => row.suggestions.length).length, regionsSuggested: rows.reduce((sum, row) => sum + row.suggestions.length, 0), handCorrection: false, inferenceRerun: false, extractedFieldAccuracy: null, accuracyReason: 'Suggested crop coverage is not recognition or field accuracy. No crop was recognized or selected by this diagnostic.', limitations: ['Previously used eight-photo development corpus, not a holdout.', 'Original raw OCR source remains unchanged.', 'Suggestions request bounded adjacent pixels and may still omit an undetected distant value; the officer must inspect the rectangle before retrying.', 'Absent/cropped headings, rotated print and composite MRP/USP headings cause abstention or require manual selection.', 'All original and additional raw readings must remain available after an officer selects a working transcript.'], rows }
await mkdir('reports/release-fixes-2026-09-04', { recursive: true })
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ outputPath, sourceSha256: result.source.sha256, imageHashesVerified: result.imageHashesVerified, photosWithSuggestedRegions: result.photosWithSuggestedRegions, regionsSuggested: result.regionsSuggested, inferenceRerun: false, extractedFieldAccuracy: null }))
