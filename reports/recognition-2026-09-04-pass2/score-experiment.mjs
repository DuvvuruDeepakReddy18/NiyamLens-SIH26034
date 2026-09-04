import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { main as score } from '../../tools/score-critical-fields.mjs'

const here = new URL('./', import.meta.url)
const root = new URL('../../', here)
const files = ['src/lib/labelParser.mjs', 'src/lib/extraction.mjs', 'src/lib/criticalFieldBenchmark.mjs', 'tools/score-critical-fields.mjs', 'datasets/critical-fields.v1.json']
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(new URL(path, root))).digest('hex')])))
const before = await hashes()
const report = await score([
  '--input', fileURLToPath(new URL('english-strategies-raw.json', here)),
  '--input', fileURLToPath(new URL('../recognition-2026-09-04/rapidocr-default-raw.json', here)),
  '--verify-images', '--output', fileURLToPath(new URL('paired-extraction-score.json', here)),
])
const after = await hashes()
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Parser/scorer changed during paired evaluation; do not use this result')
await writeFile(new URL('scoring-provenance.json', here), `${JSON.stringify({ generatedAt: new Date().toISOString(), sourceHashes: before, parserStableDuringScoring: true, note: 'All four new configurations and the prior RapidOCR default were rescored using exactly the same current extraction implementation. Prior report scores may use an older parser.' }, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify(report.runs.map(run => ({ mode: run.mode, correct: run.exactMatchCorrect, eligible: run.exactMatchSamples, failedPhotos: run.failedPhotos, perField: Object.fromEntries(Object.entries(run.perField).map(([key, value]) => [key, `${value.exactMatchCorrect}/${value.exactMatchSamples}`])) })), null, 2))
