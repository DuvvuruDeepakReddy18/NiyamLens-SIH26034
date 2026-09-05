// Reparse frozen OCR observations after a parser fix. This is NOT a new OCR run.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { collectPaddleLayoutProposals } from '../src/lib/paddleLayoutProposals.mjs'
import { buildPaddleWorkingAddition } from '../src/lib/paddleWorkingText.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'
import { normalizeCriticalValue, CRITICAL_FIELDS, validateCriticalFieldManifest } from '../src/lib/criticalFieldBenchmark.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const base = 'reports/readiness-2026-09-05'
const manifestBytes = await readFile('datasets/critical-fields.v1.json')
const manifest = validateCriticalFieldManifest(JSON.parse(manifestBytes))
if (manifest.samples.length !== 8 || manifest.isHoldout !== false) throw new Error('Development set only.')
const report = { kind: 'retained-development-OCR-parser-replay-NOT-NEW-RECOGNITION', createdAt: new Date().toISOString(), manifestSha256: hash(manifestBytes), sourceHashes: {}, runs: [], limitations: ['These known development images and AI-provisional references do not establish general accuracy.', 'No image is re-recognized here; no raw OCR strings or source polygons are edited.', 'The two initial experimental reports omitted the parser and layout-helper hashes. Their raw observations are retained as evidence, not a completely reproducible historical build.', 'All available proposals are selected by fixed test policy, not a person. The tiled strategy is not shipped.'] }
for (const path of ['tools/replay-development-ocr.mjs', 'src/lib/labelParser.mjs', 'src/lib/extraction.mjs', 'src/lib/paddleLayoutProposals.mjs', 'src/lib/paddleWorkingText.mjs', 'src/lib/spatialOcr.mjs', 'src/lib/ocrReadingOrder.mjs']) report.sourceHashes[path] = hash(await readFile(path))
for (const path of ['paddle-resolution-det1536-2026-09-05T07-05-53-663Z.json', 'paddle-resolution-quad960-2026-09-05T07-12-32-012Z.json']) {
  const bytes = await readFile(`${base}/${path}`)
  const original = JSON.parse(bytes)
  if (original.rows.length !== 8 || !original.finishedAt || original.rows.some(row => row.error) || original.manifestSha256 !== hash(manifestBytes)) throw new Error('Complete bound observations required.')
  const run = { originalPath: path, originalSha256: hash(bytes), profile: original.profile, originalMetrics: original.derivedPotential, rows: [], metrics: Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { denominator: 0, exact: 0, wrongValid: 0, unresolved: 0 }])) }
  for (const sample of manifest.samples) {
    const originalRow = original.rows.find(row => row.sampleId === sample.id && row.sourceSha256 === sample.sha256)
    if (!originalRow) throw new Error('Missing fixed sample.')
    const additions = []; const proposals = []
    for (const observation of originalRow.observations) {
      const reading = { id: sample.id, text: observation.text, lines: observation.lines, width: observation.originalOutput.image.width, height: observation.originalOutput.image.height, crop: observation.region }
      const collected = collectPaddleLayoutProposals([reading])
      const addition = buildPaddleWorkingAddition([reading], collected.proposals)
      if (!addition.rawAddition.endsWith(observation.text)) throw new Error('Raw OCR changed.')
      additions.push(addition.workingAddition); proposals.push(collected.proposals)
    }
    const workingText = additions.join('\n\n')
    const fields = extractDeclarations(workingText).byId
    run.rows.push({ sampleId: sample.id, originalRawSha256: hash(originalRow.rawText), workingText, proposals, fields: Object.fromEntries(CRITICAL_FIELDS.map(field => [field, fields[field]])) })
    for (const field of CRITICAL_FIELDS) {
      if (!sample.fields[field].metricEligible) continue
      const count = run.metrics[field]; count.denominator++
      const actual = fields[field]; const valid = actual.candidates.length === 1 && actual.candidates[0].valid && !actual.conflict
      if (!valid) count.unresolved++
      else if (normalizeCriticalValue(field, actual.value) === normalizeCriticalValue(field, sample.fields[field].value)) count.exact++
      else count.wrongValid++
    }
  }
  report.runs.push(run)
}
const path = `${base}/parser-replay-${report.createdAt.replace(/[:.]/g, '-')}.json`
await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ path, runs: report.runs.map(run => ({ profile: run.profile, metrics: run.metrics })) }))
