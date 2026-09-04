#!/usr/bin/env node
import { writeFile, realpath, stat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative, isAbsolute, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { readBoundedFile } from './verify-cloud-export.mjs'
import { FIELD_PILOT_LIMITS, assertPilotJson, canonicalPilotJson, safePilotPath, validatePilotManifest, resolvedPilotLabels, pilotSealPayload, checkPilotExclusions, validatePilotRuns, scoreFieldPilot } from '../src/lib/fieldPilot.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const pilotHash = value => createHash('sha256').update(value).digest('hex')
const defaultExclusions = ['datasets/critical-fields.v1.json', 'datasets/critical-fields.checkset.v1.json', 'datasets/openfoodfacts-india/real-labels.manifest.json']
const usage = `Prospective 20–30-photo field pilot. Does not run OCR, invent labels or publish photos.

node tools/field-pilot.mjs init --dataset-id TEAM-PILOT-v1 --owner LEAD --output DRAFT.json
node tools/field-pilot.mjs import --manifest DRAFT.json --input INTAKE.json --output IMPORTED.json
node tools/field-pilot.mjs validate --manifest LABELLED.json
node tools/field-pilot.mjs freeze --manifest LABELLED.json --by LEAD --output FROZEN.json
node tools/field-pilot.mjs record --manifest FROZEN.json --input OBSERVATION.json [--runs PREVIOUS.json] --output RAW-RUNS.json
node tools/field-pilot.mjs score --manifest FROZEN.json --input RAW-RUNS.json --output SCORE.json

Optional --root DIRECTORY (exclusion inventory; defaults to repository root),
--photo-root DIRECTORY (original photos; defaults to --root), repeatable --exclude ROOT-RELATIVE.json.
Import accepts an array of photo records; it computes source SHA256, never labels a photo.
Two independent human annotations (third adjudicator on disagreement) and pre-registered
OCR modes are required before freeze. Score verifies source files, exclusion inventory,
manifest seal and raw text hashes; corrections remain a separate assisted-result channel.
Outputs are create-only; an existing artifact is never overwritten.`

async function readJson(path) {
  const bytes = await readBoundedFile(path, FIELD_PILOT_LIMITS.bytes)
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('Invalid pilot JSON/UTF-8; use a JSON object/array, not JSONL.') }
  assertPilotJson(value)
  return { value, bytes }
}

async function rootedFile(root, path) {
  const realRoot = await realpath(root); const realFile = await realpath(resolve(realRoot, safePilotPath(path)))
  const rel = relative(realRoot, realFile)
  if (!rel || isAbsolute(rel) || rel.startsWith('..')) throw new Error('Source resolves outside the chosen photo root.')
  return realFile
}

export async function readPilotPhoto(root, sourcePath) {
  const path = await rootedFile(root, sourcePath); const info = await stat(path)
  if (!info.isFile() || info.size > 15 * 1024 * 1024 || !['.jpg', '.jpeg', '.png', '.webp'].includes(extname(sourcePath).toLowerCase())) throw new Error('Pilot photos must be JPEG/PNG/WebP regular files no larger than 15 MiB.')
  const bytes = await readBoundedFile(path, 15 * 1024 * 1024)
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata()
  const expectedFormat = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' }[extname(sourcePath).toLowerCase()]
  if (metadata.format !== expectedFormat || metadata.pages > 1 || metadata.width < 300 || metadata.height < 300) throw new Error('Pilot source must be a static correctly named JPEG/PNG/WebP of at least 300×300 pixels.')
  // Metadata alone can accept truncated compressed data; actually decode once.
  await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).resize(1, 1).raw().toBuffer()
  return { sha256: pilotHash(bytes), byteLength: bytes.length, width: metadata.width, height: metadata.height }
}

export async function readPilotExclusions(root = repoRoot, extras = []) {
  const files = []; const hashes = new Set(); const products = new Set()
  const datasetEntries = await readdir(await rootedFile(root, 'datasets'), { withFileTypes: true })
  if (datasetEntries.length > 5000) throw new Error('Dataset exclusion directory exceeds its entry bound.')
  const smokeMarkers = datasetEntries.filter(entry => /^field-smoke-[a-zA-Z0-9._-]+\.json$/.test(entry.name))
  if (smokeMarkers.length > 100 || smokeMarkers.some(entry => !entry.isFile() || entry.isSymbolicLink())) throw new Error('Exploratory smoke exclusion markers must be at most 100 regular JSON files.')
  const automaticExclusions = smokeMarkers.map(entry => `datasets/${entry.name}`)
  for (const path of [...new Set([...defaultExclusions, ...automaticExclusions, ...extras])].sort()) {
    const file = await readJson(await rootedFile(root, path)); files.push({ path: safePilotPath(path), sha256: pilotHash(canonicalPilotJson(file.value)), hashKind: 'canonical-json-sha256' })
    for (const sample of file.value.samples ?? []) {
      if (sample.sha256) hashes.add(sample.sha256.toLowerCase())
      if (sample.productCode || sample.productKey) products.add(String(sample.productCode ?? sample.productKey).trim().toLowerCase())
    }
    for (const product of file.value.products ?? []) if (product.code) products.add(String(product.code).trim().toLowerCase())
  }
  // Include all previously downloaded source/candidate photographs, not only the
  // eight manually labelled development cases. No file is changed or uploaded.
  let scanned = 0
  for (const base of ['datasets/openfoodfacts-india/real-labels', 'datasets/openfoodfacts-india/candidates']) {
    const queue = [base]
    while (queue.length) {
      const directory = queue.shift(); let entries
      try { entries = await readdir(await rootedFile(root, directory), { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      for (const entry of entries) {
        if (++scanned > 10_000) throw new Error('Development exclusion inventory exceeds the 10,000-entry scan limit.')
        const source = `${directory}/${entry.name}`
        if (entry.isSymbolicLink()) throw new Error('Development inventory must not contain symbolic links.')
        if (entry.isDirectory()) { queue.push(source); if (/^\d{8,14}$/.test(entry.name)) products.add(entry.name); continue }
        if (!entry.isFile() || !/\.(?:jpe?g|png|webp)$/i.test(entry.name)) continue
        const path = await rootedFile(root, source); const info = await stat(path)
        if (info.size > 40_000_000) throw new Error('Development photograph exceeds the hash inventory bound.')
        const sha256 = pilotHash(await readBoundedFile(path, 40_000_000)); hashes.add(sha256); files.push({ path: source, sha256, hashKind: 'original-image-bytes-sha256' })
      }
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const inventory = { files, hashes: [...hashes].sort(), products: [...products].sort() }
  return { ...inventory, sha256: pilotHash(canonicalPilotJson(inventory)) }
}

export function createPilotDraft(datasetId, ownerId) {
  return validatePilotManifest({ schemaVersion: 1, kind: 'prospective-field-pilot', datasetId, ownerId, state: 'draft', isHoldout: false, freshnessClaim: 'team-attested-new-sku-not-independently-verified', samplingPlan: 'Collect 20–30 previously unused SKUs before viewing OCR results; cover flat and curved packages, glare, tiny print, blur/skew and English/regional-language labels. Record every attempted capture, including failures; no success-based exclusions. This pilot does not establish representative field accuracy.', modes: [], samples: [] })
}

export async function importPilotPhotos(manifest, intake, { root = repoRoot, photoRoot = root, inventory } = {}) {
  validatePilotManifest(manifest); assertPilotJson(intake)
  if (manifest.state !== 'draft') throw new Error('Cannot import into a frozen pilot. Start a new dataset version.')
  if (!Array.isArray(intake) || !intake.length || intake.length + manifest.samples.length > FIELD_PILOT_LIMITS.maxPhotos) throw new Error('Import requires photo records and at most 30 total photos.')
  const copy = structuredClone(manifest)
  for (const input of intake) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Each intake record must be a photo object.')
    if (input.sha256 !== undefined || input.groundTruth != null || input.expectedValues !== undefined) throw new Error('Intake must not supply a hash or ground truth; hash original files and label independently after import.')
    const sourcePath = safePilotPath(input.sourcePath)
    copy.samples.push({ ...input, sourcePath, ...await readPilotPhoto(photoRoot, sourcePath), groundTruth: null })
  }
  validatePilotManifest(copy)
  checkPilotExclusions(copy, inventory ?? await readPilotExclusions(root))
  return copy
}

export async function verifyPilotFiles(manifest, { root = repoRoot, photoRoot = root, inventory } = {}) {
  validatePilotManifest(manifest)
  const currentInventory = inventory ?? await readPilotExclusions(root)
  checkPilotExclusions(manifest, currentInventory)
  if (manifest.state === 'frozen') {
    if (pilotHash(pilotSealPayload(manifest)) !== manifest.freeze.payloadSha256) throw new Error('Frozen manifest SHA256 mismatch.')
    if (manifest.exclusionInventory.sha256 !== currentInventory.sha256) throw new Error('Development exclusion inventory changed since freeze. Review the change; do not silently reseal the same pilot.')
  }
  for (const sample of manifest.samples) if ((await readPilotPhoto(photoRoot, sample.sourcePath)).sha256 !== sample.sha256) throw new Error(`Original photograph hash mismatch: ${sample.id}`)
  return { verified: true, photoCount: manifest.samples.length, exclusionFiles: currentInventory.files.length, exclusionInventorySha256: currentInventory.sha256, caveat: 'Local bytes and recorded inventory checked; source provenance and prior model exposure are not independently attested.' }
}

export async function freezePilot(manifest, { by, at = new Date().toISOString(), root = repoRoot, photoRoot = root, inventory } = {}) {
  validatePilotManifest(manifest)
  if (manifest.state !== 'draft') throw new Error('Already frozen: never reseal a pilot in place.')
  const currentInventory = inventory ?? await readPilotExclusions(root)
  await verifyPilotFiles(manifest, { root, photoRoot, inventory: currentInventory })
  for (const sample of manifest.samples) resolvedPilotLabels(sample, at)
  const frozen = { ...structuredClone(manifest), state: 'frozen', exclusionInventory: { files: currentInventory.files, sha256: currentInventory.sha256 }, freeze: { at, by, payloadSha256: '0'.repeat(64) } }
  frozen.freeze.payloadSha256 = pilotHash(pilotSealPayload(frozen))
  return validatePilotManifest(frozen, { requireFrozen: true })
}

export function recordPilotObservation(manifest, observation, previous = null) {
  validatePilotManifest(manifest, { requireFrozen: true }); assertPilotJson(observation)
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('Observation must be an object containing one unchanged raw OCR result.')
  const sample = manifest.samples.find(item => item.id === observation.sampleId)
  if (!sample) throw new Error('Observation references an unknown sample ID.')
  // Input provenance must be explicit. Hashing supplied text is a consistency
  // operation, not an assertion that the machine actually produced that text.
  if (observation.sourceSha256 !== sample.sha256 || observation.manuallyEdited !== false || observation.transcriptKind !== 'raw-ocr-unedited') throw new Error('Observation must explicitly attest unedited OCR and match the source image hash.')
  if (typeof observation.rawText !== 'string' || observation.rawText.length > 100000) throw new Error('Observation rawText requires at most 100,000 unchanged characters.')
  const row = { ...observation, sourcePath: sample.sourcePath, rawTextSha256: pilotHash(observation.rawText) }
  if (observation.rawTextSha256 !== undefined && observation.rawTextSha256 !== row.rawTextSha256) throw new Error('Supplied raw OCR hash does not match observation text.')
  const result = previous ? structuredClone(previous) : { schemaVersion: 1, kind: 'field-pilot-ocr-runs', datasetId: manifest.datasetId, freezeSha256: manifest.freeze.payloadSha256, rows: [] }
  validatePilotRuns(result, manifest, pilotHash)
  result.rows.push(row)
  validatePilotRuns(result, manifest, pilotHash)
  return result
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage}\n`); return }
  const [command, ...rest] = args; const options = { exclude: [] }
  if (!['init', 'import', 'validate', 'freeze', 'record', 'score'].includes(command)) throw new Error(`Unknown command.\n${usage}`)
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    if (!['--manifest', '--input', '--output', '--dataset-id', '--owner', '--by', '--root', '--photo-root', '--exclude', '--runs'].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Unsupported/incomplete option ${key}.`)
    if (key === '--exclude') options.exclude.push(safePilotPath(rest[i + 1]))
    else { if (options[key] !== undefined) throw new Error(`Duplicate option ${key}.`); options[key] = rest[i + 1] }
  }
  const root = resolve(options['--root'] ?? repoRoot); const photoRoot = resolve(options['--photo-root'] ?? root); let output
  if (command === 'init') output = createPilotDraft(options['--dataset-id'], options['--owner'])
  else {
    if (!options['--manifest']) throw new Error('--manifest is required.')
    const file = await readJson(resolve(options['--manifest'])); const manifest = validatePilotManifest(file.value)
    const inventory = await readPilotExclusions(root, options.exclude)
    if (command === 'import') {
      if (!options['--input']) throw new Error('--input intake JSON is required.')
      output = await importPilotPhotos(manifest, (await readJson(resolve(options['--input']))).value, { root, photoRoot, inventory })
    } else if (command === 'freeze') output = await freezePilot(manifest, { by: options['--by'], root, photoRoot, inventory })
    else if (command === 'validate') output = { datasetId: manifest.datasetId, state: manifest.state, readyToFreeze: manifest.state === 'draft' && manifest.samples.length >= 20 && manifest.modes.length > 0 && manifest.samples.every(sample => sample.groundTruth != null), ...await verifyPilotFiles(manifest, { root, photoRoot, inventory }) }
    else if (command === 'record') {
      if (!options['--input']) throw new Error('--input observation JSON is required.')
      await verifyPilotFiles(manifest, { root, photoRoot, inventory })
      output = recordPilotObservation(manifest, (await readJson(resolve(options['--input']))).value, options['--runs'] ? (await readJson(resolve(options['--runs']))).value : null)
    } else {
      if (!options['--input']) throw new Error('--input raw OCR run JSON is required.')
      const sourceVerification = await verifyPilotFiles(manifest, { root, photoRoot, inventory }); const input = await readJson(resolve(options['--input']))
      validatePilotRuns(input.value, manifest, pilotHash)
      output = { ...scoreFieldPilot(manifest, input.value, pilotHash), generatedAt: new Date().toISOString(), manifestFileSha256: pilotHash(file.bytes), rawInputFileSha256: pilotHash(input.bytes), sourceVerification }
    }
  }
  if (options['--output']) {
    const target = resolve(options['--output'])
    if ([options['--manifest'], options['--input'], options['--runs']].filter(Boolean).some(path => resolve(path) === target)) throw new Error('Output cannot overwrite input or manifest.')
    await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' })
    process.stdout.write(`Created ${target}\n${command === 'score' ? 'Raw and officer-assisted metrics are separate; read all limitations.' : 'Pilot tooling only: no field-accuracy result is implied.'}\n`)
  } else if (command === 'validate' || command === 'score') process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  else throw new Error('--output is required for init, import, record and freeze (create-only).')
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Field pilot failed: ${error.message}\n`); process.exitCode = 1 })
