import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { validateCriticalFieldManifest, normalizeCriticalValue, scoreCriticalFields, CRITICAL_FIELDS } from '../src/lib/criticalFieldBenchmark.mjs'
import { parsePaddleOutput } from '../src/lib/paddleOcr.mjs'
import { reconstructOcrReadingOrder, reviewableDeclarationProposals } from '../src/lib/ocrReadingOrder.mjs'
import { reviewableStackedDeclarationProposals } from '../src/lib/spatialOcr.mjs'
import { buildPaddleWorkingAddition } from '../src/lib/paddleWorkingText.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--input') throw new Error('Use --input ORIGINAL-EIGHT-PHOTO-GEOMETRY.json. Only development proposal potential is evaluated.')
const inputPath = resolve(args[1]); const inputBytes = await readFile(inputPath)
const input = JSON.parse(inputBytes)
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes))
if (input.kind !== 'actual-browser-development-paddle-geometry' || input.datasetId !== manifest.datasetId || input.isHoldout !== false || input.manifestSha256 !== hash(manifestBytes) || input.rows.length !== 8 || manifest.samples.length !== 8 || new Set(input.rows.map(row => row.sampleId)).size !== 8) throw new Error('Only the fixed complete eight-photo development geometry capture is accepted.')
const report = { kind: 'development-derived-layout-potential-NOT-RAW-ACCURACY', createdAt: new Date().toISOString(), isHoldout: false, humanReviewed: false, input: { path: inputPath, sha256: hash(inputBytes), originalAppModule: input.execution.appModule }, sources: Object.fromEntries(await Promise.all(['src/lib/spatialOcr.mjs', 'src/lib/ocrReadingOrder.mjs', 'src/lib/paddleWorkingText.mjs', 'src/lib/extraction.mjs'].map(async path => [path, hash(await readFile(resolve(root, path)))]))), rawScoring: null, modes: [], rows: [], limitations: ['AI-provisional references on eight previously used photos, not a holdout or independently measured accuracy.', 'All available noncompeting proposals are selected by an automated diagnostic policy. No human has confirmed them.', 'Derived potential replaces selected source fragments once in the NEW observation only. Raw text and source geometry are unchanged and separately scored.', 'No crops, reruns, digit/unit/heading corrections, catalogue knowledge or reference answers influence a proposal.', 'Matched field candidates are not legal-compliance clearances. Excluded labels are not counted as correct negatives.'] }
for (const source of input.rows) {
  const sample = manifest.samples.find(sample => sample.id === source.sampleId)
  if (!sample || source.sourceSha256 !== sample.sha256 || source.sourcePath !== sample.sourcePath) throw new Error('Geometry source does not match the frozen development image.')
  const row = { sampleId: sample.id, sourceSha256: sample.sha256, error: source.error, rawText: source.rawText, modes: [] }
  if (!source.error) {
    const parsed = parsePaddleOutput(source.originalOutput, sample.id, source.originalOutput.image)
    if (parsed.text !== source.rawText || JSON.stringify(parsed.lines) !== JSON.stringify(source.lines)) throw new Error('Captured worker output, visible raw text or source lines changed.')
    const item = { id: sample.id, text: parsed.text, lines: parsed.lines, width: source.originalOutput.image.width, height: source.originalOutput.image.height, crop: null }
    const existing = reviewableDeclarationProposals(reconstructOcrReadingOrder(parsed.lines))
    const stacked = reviewableStackedDeclarationProposals(parsed.lines)
    row.stacked = stacked
    for (const [mode, proposals] of [['existing-row-proposals-derived-potential', existing.proposals.map(proposal => ({ ...proposal, panelId: sample.id }))], ['row-plus-stacked-derived-potential', [...existing.proposals.map(proposal => ({ ...proposal, panelId: sample.id })), ...stacked.proposals]]]) {
      const { workingAddition, workingMappings, rawAddition } = buildPaddleWorkingAddition([item], proposals)
      if (!rawAddition.endsWith(source.rawText)) throw new Error('Diagnostic changed the raw observation.')
      const extraction = extractDeclarations(workingAddition)
      row.modes.push({ mode, transcriptKind: 'system-derived-layout-potential', officerReviewed: false, automatedSelectionPolicy: 'Select every available proposal without consulting reference labels; diagnostic only.', proposedRows: proposals, workingText: workingAddition, workingMappings, fields: Object.fromEntries(CRITICAL_FIELDS.map(field => [field, extraction.byId[field]])) })
    }
  }
  report.rows.push(row)
}
report.rawScoring = scoreCriticalFields(manifest, input.rows.map(row => ({ sampleId: row.sampleId, sourcePath: row.sourcePath, sourceSha256: row.sourceSha256, rawText: row.rawText, error: row.error, mode: 'browser-paddle', transcriptKind: 'raw-ocr-unedited', manuallyEdited: false })))
// Do not bypass the raw-only benchmark's transcript-kind guard. Derived
// potential has its own explicit field-only denominator and display label.
for (const mode of ['existing-row-proposals-derived-potential', 'row-plus-stacked-derived-potential']) {
  const perField = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { readableDenominator: 0, exactCandidateMatches: 0, wrongValidCandidates: 0, unresolvedReadable: 0, excludedLabels: 0, excludedWithValidCandidates: 0 }]))
  const comparisons = []
  for (const sample of manifest.samples) {
    const row = report.rows.find(row => row.sampleId === sample.id)
    for (const field of CRITICAL_FIELDS) {
      const label = sample.fields[field]; const actual = row.modes.find(item => item.mode === mode)?.fields[field]
      const valid = Boolean(actual && actual.candidates.length === 1 && actual.candidates[0].valid && !actual.conflict)
      const eligible = label.metricEligible === true
      const exact = eligible && valid && normalizeCriticalValue(field, actual.value) === normalizeCriticalValue(field, label.value)
      const metric = perField[field]
      if (eligible) { metric.readableDenominator += 1; if (exact) metric.exactCandidateMatches += 1; else if (valid) metric.wrongValidCandidates += 1; else metric.unresolvedReadable += 1 }
      else { metric.excludedLabels += 1; if (valid) metric.excludedWithValidCandidates += 1 }
      comparisons.push({ sampleId: sample.id, field, eligible, referenceStatus: label.status, referenceValue: label.value, proposedWorkingValue: valid ? actual.value : null, conflict: actual?.conflict ?? null, exactCandidateMatch: eligible ? exact : null })
    }
  }
  report.modes.push({ mode, corpusPhotos: 8, observedPhotos: report.rows.length, failedPhotos: report.rows.filter(row => row.error).length, proposedRows: report.rows.reduce((sum, row) => sum + (row.modes.find(item => item.mode === mode)?.proposedRows.length || 0), 0), exactCandidateMatches: Object.values(perField).reduce((sum, metric) => sum + metric.exactCandidateMatches, 0), readableDenominator: Object.values(perField).reduce((sum, metric) => sum + metric.readableDenominator, 0), perField, comparisons })
}
const directory = resolve(root, 'reports/readiness-2026-09-05'); await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `spatial-derived-${report.createdAt.replace(/[:.]/g, '-')}.json`)
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ outputPath, raw: report.rawScoring.runs.map(run => ({ correct: run.exactMatchCorrect, denominator: run.exactMatchSamples })), derivedPotential: report.modes.map(({ mode, corpusPhotos, failedPhotos, proposedRows, exactCandidateMatches, readableDenominator, perField }) => ({ mode, corpusPhotos, failedPhotos, proposedRows, exactCandidateMatches, readableDenominator, perField })) }, null, 2))
