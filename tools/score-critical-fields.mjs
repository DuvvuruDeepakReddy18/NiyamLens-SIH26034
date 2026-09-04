#!/usr/bin/env node
import { readFile, writeFile, stat, realpath } from 'node:fs/promises'
import { resolve, relative, dirname, basename, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { adaptCriticalOcrInput, scoreCriticalFields, validateCriticalFieldManifest, CRITICAL_BENCHMARK_LIMITS } from '../src/lib/criticalFieldBenchmark.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const usage = `Score frozen critical photo fields from UNEDITED raw OCR outputs. Does not run OCR.

node tools/score-critical-fields.mjs --input OCR.jsonl [--input OTHER.jsonl] [--manifest datasets/critical-fields.v1.json] [--verify-images] [--output REPORT.json]

Canonical JSON array rows: {sampleId, mode, rawText, error?:string|null, sourcePath?:string, sourceSha256?:string, manuallyEdited?:false}.
Also accepts {rows:[...]} or recognition experiment JSONL session/result rows with image, variant, psm and rawText.
Input filename prefixes each mode; experimental unmatched photos are listed and never inherit same-SKU labels.
Use --verify-images to check every local source image against the frozen manifest's SHA256. Output defaults to stdout.
Partial runs report coverage and attempted denominators; missing readable labels make full-corpus exactMatchRate null.
All results remain provisional development diagnostics, not holdout or legal accuracy.`

async function readBoundedJson(path) {
  const info = await stat(path)
  if (!info.isFile() || info.size > CRITICAL_BENCHMARK_LIMITS.totalCharacters) throw new Error(`Input must be a regular file of at most ${CRITICAL_BENCHMARK_LIMITS.totalCharacters} bytes: ${path}`)
  const bytes = await readFile(path)
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
  try { return { bytes, value: JSON.parse(text) } } catch (wholeError) {
    if (!/\.jsonl$/i.test(path)) throw new Error(`Invalid JSON in ${path}: ${wholeError.message}`)
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    if (lines.length > CRITICAL_BENCHMARK_LIMITS.rows) throw new Error('JSONL input exceeds the row limit.')
    return { bytes, value: lines.map((line, index) => { try { return JSON.parse(line) } catch { throw new Error(`Invalid JSONL at row ${index + 1}: ${path}`) } }) }
  }
}

export async function verifyCriticalSourceImages(manifest, root = repoRoot) {
  const realRoot = await realpath(root)
  for (const sample of manifest.samples) {
    const source = await realpath(resolve(realRoot, sample.sourcePath))
    const child = relative(realRoot, source)
    if (child.startsWith('..') || isAbsolute(child) || !child) throw new Error('Source image resolves outside the intended repository.')
    const info = await stat(source)
    if (!info.isFile() || info.size > 40_000_000) throw new Error('Source image is not a regular bounded image file.')
    if (hash(await readFile(source)) !== sample.sha256.toLowerCase()) throw new Error(`Image SHA256 mismatch: ${sample.sourcePath}`)
  }
  return { verified: true, count: manifest.samples.length, mechanism: 'SHA256 of exact local source bytes; not proof that the imported OCR rows used those bytes.' }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage}\n`); return }
  const inputs = []; let manifestPath = resolve(repoRoot, 'datasets/critical-fields.v1.json'); let outputPath = null; let verifyImages = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--verify-images') { verifyImages = true; continue }
    if (!['--input', '--manifest', '--output'].includes(arg) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Unsupported or incomplete argument: ${arg}\n${usage}`)
    const path = resolve(args[++index])
    if (arg === '--input') inputs.push(path)
    else if (arg === '--manifest') manifestPath = path
    else outputPath = path
  }
  if (!inputs.length) throw new Error(`At least one --input is required.\n${usage}`)
  if (new Set(inputs).size !== inputs.length) throw new Error('Duplicate input files are not allowed.')
  if (outputPath && [manifestPath, ...inputs].includes(outputPath)) throw new Error('Output must not overwrite a manifest or raw input file.')
  const prefixes = inputs.map(path => basename(path, extname(path)))
  if (new Set(prefixes).size !== prefixes.length) throw new Error('Input filenames need distinct stems to keep mode identities unambiguous.')
  const manifestFile = await readBoundedJson(manifestPath)
  const manifest = validateCriticalFieldManifest(manifestFile.value)
  const rows = []; const inputFiles = []; const unmatchedRows = []
  for (const [index, path] of inputs.entries()) {
    const input = await readBoundedJson(path)
    const adapted = adaptCriticalOcrInput(input.value, manifest, { modePrefix: prefixes[index] })
    rows.push(...adapted.rows)
    inputFiles.push({ path, sha256: hash(input.bytes), adaptedRows: adapted.rows.length, sessionRows: adapted.sessionRows, unmatchedRows: adapted.unmatched.length })
    unmatchedRows.push(...adapted.unmatched.map(row => ({ inputFile: path, ...row })))
  }
  const report = scoreCriticalFields(manifest, rows)
  report.generatedAt = new Date().toISOString()
  report.manifest = { path: manifestPath, sha256: hash(manifestFile.bytes) }
  report.inputFiles = inputFiles
  report.unmatchedRows = unmatchedRows
  report.sourceVerification = verifyImages ? await verifyCriticalSourceImages(manifest) : { verified: false, count: 0, reason: 'Image verification was not requested; use --verify-images.' }
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) { await writeFile(outputPath, json, { flag: 'wx' }); process.stdout.write(`Created ${outputPath}\nModes: ${report.runs.length}; matched raw rows: ${rows.length}; unlabelled-photo rows: ${unmatchedRows.length}. Provisional development diagnostics only.\n`) }
  else process.stdout.write(json)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`Critical-field benchmark failed: ${error.message}\n`); process.exitCode = 1 })
}
