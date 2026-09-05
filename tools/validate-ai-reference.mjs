#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPilotJson, safePilotPath } from '../src/lib/fieldPilot.mjs'
import { validateReviewSelection } from './import-field-review-evidence.mjs'

export const AI_REFERENCE_SCHEMA = 'niyamlens-ai-reference/v1'
export const AI_REFERENCE_PHOTO_COUNT = 24
export const AI_REFERENCE_FIELDS = Object.freeze(['mrp', 'netQuantity', 'date'])
export const AI_REFERENCE_STATUSES = Object.freeze(['readable', 'not-visible', 'illegible'])

const MAX_JSON_BYTES = 2_000_000
const TOP_LEVEL_KEYS = Object.freeze(['schema', 'datasetId', 'selectionSha256', 'authorType', 'reviewType', 'independentHumanReview', 'approvedForHumanBlindPilot', 'exposureRecordedAt', 'rows'])
const ROW_KEYS = Object.freeze(['itemId', 'sha256', 'fields', 'notes'])
const FIELD_KEYS = Object.freeze(['status', 'value', 'evidence'])
const PROHIBITED_HUMAN_NAMES = /\b(?:arif|tharun)\b/i
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = (code, detail) => { throw new Error(`${code}: ${detail}`) }

function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('AI_REFERENCE_HASH_INVALID', `${label} must be a lowercase SHA-256 digest.`)
  return value
}

function boundedText(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /\u0000/.test(value)) fail('AI_REFERENCE_TEXT_INVALID', `${label} must be ${allowEmpty ? '' : 'nonempty '}text of at most ${max} characters.`)
  return value
}

function utcTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) fail('AI_REFERENCE_TIMESTAMP_INVALID', `${label} must be a real UTC ISO timestamp.`)
  return value
}

function rejectHumanAttribution(value) {
  const visit = item => {
    if (typeof item === 'string') {
      if (PROHIBITED_HUMAN_NAMES.test(item)) fail('AI_REFERENCE_HUMAN_ATTRIBUTION_FORBIDDEN', 'The AI-only reference must not be attributed to Arif or Tharun.')
      return
    }
    if (Array.isArray(item)) return item.forEach(visit)
    if (plain(item)) Object.values(item).forEach(visit)
  }
  visit(value)
}

function validateField(value, label) {
  if (!exactKeys(value, FIELD_KEYS) || !AI_REFERENCE_STATUSES.includes(value.status)) fail('AI_REFERENCE_FIELD_INVALID', `${label} must contain exactly status, value and evidence with a supported status.`)
  boundedText(value.evidence, `${label}.evidence`, 2000)
  if (value.status === 'readable') boundedText(value.value, `${label}.value`, 500)
  else if (value.value !== null) fail('AI_REFERENCE_FIELD_INVALID', `${label}.value must be null when the field is ${value.status}.`)
}

/**
 * Validate a single-AI visual reference against the exact reserved-photo
 * selection. This is deliberately not compatible with the independent-human
 * review importer and never upgrades the reference into blind-pilot truth.
 */
export function validateAiReferenceDocument(input, selectionInput, selectionFileSha256) {
  assertPilotJson(input)
  const selection = validateReviewSelection(selectionInput)
  digest(selectionFileSha256, 'selection file SHA-256')
  if (selection.samples.length !== AI_REFERENCE_PHOTO_COUNT) fail('AI_REFERENCE_SELECTION_INVALID', `The AI reference requires exactly ${AI_REFERENCE_PHOTO_COUNT} selected photos.`)
  if (!exactKeys(input, TOP_LEVEL_KEYS) || input.schema !== AI_REFERENCE_SCHEMA) fail('AI_REFERENCE_FORMAT_INVALID', `Expected the exact ${AI_REFERENCE_SCHEMA} document shape.`)
  if (input.datasetId !== selection.datasetId || input.selectionSha256 !== selectionFileSha256) fail('AI_REFERENCE_SELECTION_MISMATCH', 'datasetId or selectionSha256 does not bind to the supplied selection file.')
  if (input.authorType !== 'ai' || input.reviewType !== 'single-ai-visual-review') fail('AI_REFERENCE_PROVENANCE_INVALID', 'The reference must identify a single AI visual review.')
  if (input.independentHumanReview !== false || input.approvedForHumanBlindPilot !== false) fail('AI_REFERENCE_HUMAN_ATTESTATION_FORBIDDEN', 'AI labels cannot claim independent human review or approval for the human blind pilot.')
  utcTimestamp(input.exposureRecordedAt, 'exposureRecordedAt')
  if (Date.parse(input.exposureRecordedAt) < Date.parse(selection.generatedAt)) fail('AI_REFERENCE_TIMESTAMP_INVALID', 'AI exposure cannot predate selection generation.')
  rejectHumanAttribution(input)

  if (!Array.isArray(input.rows) || input.rows.length !== AI_REFERENCE_PHOTO_COUNT) fail('AI_REFERENCE_ROW_SET_INVALID', `rows must contain exactly ${AI_REFERENCE_PHOTO_COUNT} entries.`)
  const selected = new Map(selection.samples.map(sample => [sample.id, sample]))
  const seen = new Set()
  for (const row of input.rows) {
    if (!exactKeys(row, ROW_KEYS)) fail('AI_REFERENCE_ROW_INVALID', 'Each row must contain exactly itemId, sha256, fields and notes.')
    const sample = selected.get(row.itemId)
    if (!sample) fail('AI_REFERENCE_ROW_SET_INVALID', `Unexpected itemId: ${String(row.itemId)}.`)
    if (seen.has(row.itemId)) fail('AI_REFERENCE_ROW_SET_INVALID', `Duplicate itemId: ${row.itemId}.`)
    seen.add(row.itemId)
    digest(row.sha256, `${row.itemId}.sha256`)
    if (row.sha256 !== sample.sha256) fail('AI_REFERENCE_ROW_HASH_MISMATCH', `${row.itemId} does not match the selected source SHA-256.`)
    if (!exactKeys(row.fields, AI_REFERENCE_FIELDS)) fail('AI_REFERENCE_FIELD_SET_INVALID', `${row.itemId}.fields must contain exactly mrp, netQuantity and date.`)
    for (const field of AI_REFERENCE_FIELDS) validateField(row.fields[field], `${row.itemId}.${field}`)
    boundedText(row.notes, `${row.itemId}.notes`, 2000, { allowEmpty: true })
  }
  const missing = selection.samples.filter(sample => !seen.has(sample.id)).map(sample => sample.id)
  if (missing.length) fail('AI_REFERENCE_ROW_SET_INVALID', `Missing selected item IDs: ${missing.join(', ')}.`)

  return {
    schema: AI_REFERENCE_SCHEMA,
    datasetId: selection.datasetId,
    selectionSha256: selectionFileSha256,
    photoCount: input.rows.length,
    authorType: 'ai',
    reviewType: 'single-ai-visual-review',
    independentHumanReview: false,
    approvedForHumanBlindPilot: false,
    exposureRecordedAt: input.exposureRecordedAt,
  }
}

async function readBoundedJson(path, label) {
  const bytes = await readFile(path)
  if (!bytes.length || bytes.length > MAX_JSON_BYTES) fail('AI_REFERENCE_FILE_SIZE_INVALID', `${label} must be between 1 byte and ${MAX_JSON_BYTES} bytes.`)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { fail('AI_REFERENCE_JSON_INVALID', `${label} is not valid UTF-8.`) }
  let value
  try { value = JSON.parse(text) } catch { fail('AI_REFERENCE_JSON_INVALID', `${label} is not valid JSON.`) }
  assertPilotJson(value)
  return { bytes, value }
}

function withinRoot(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../'))
}

async function digestFile(path) {
  const hash = createHash('sha256')
  let byteLength = 0
  for await (const chunk of createReadStream(path)) { byteLength += chunk.length; hash.update(chunk) }
  return { byteLength, sha256: hash.digest('hex') }
}

export async function verifyAiReferenceSourceBytes(selectionInput, photoRoot) {
  const selection = validateReviewSelection(selectionInput)
  if (selection.samples.length !== AI_REFERENCE_PHOTO_COUNT) fail('AI_REFERENCE_SELECTION_INVALID', `The AI reference requires exactly ${AI_REFERENCE_PHOTO_COUNT} selected photos.`)
  const root = await realpath(resolve(photoRoot))
  if (!(await stat(root)).isDirectory()) fail('AI_REFERENCE_PHOTO_ROOT_INVALID', 'photoRoot must be a directory.')
  for (const sample of selection.samples) {
    const safe = safePilotPath(sample.sourcePath)
    const candidate = resolve(root, ...safe.split('/'))
    if (!withinRoot(root, candidate)) fail('AI_REFERENCE_SOURCE_PATH_INVALID', `${sample.id} escapes photoRoot.`)
    const source = await realpath(candidate)
    if (!withinRoot(root, source)) fail('AI_REFERENCE_SOURCE_PATH_INVALID', `${sample.id} resolves outside photoRoot.`)
    const info = await lstat(source)
    if (!info.isFile()) fail('AI_REFERENCE_SOURCE_INVALID', `${sample.id} is not a regular source file.`)
    const actual = await digestFile(source)
    if (actual.byteLength !== sample.byteLength || actual.sha256 !== sample.sha256) fail('AI_REFERENCE_SOURCE_HASH_MISMATCH', `${sample.id} source bytes do not match the canonical selection manifest.`)
  }
  return { sourceBytesVerified: true, verifiedPhotoCount: selection.samples.length }
}

export async function validateAiReferenceFiles({ labelsPath, selectionPath, photoRoot, freezePath }) {
  const labels = await readBoundedJson(resolve(labelsPath), 'AI reference labels')
  const selection = await readBoundedJson(resolve(selectionPath), 'selection manifest')
  const selectionFileSha256 = sha256(selection.bytes)
  const summary = validateAiReferenceDocument(labels.value, selection.value, selectionFileSha256)
  if (freezePath) {
    const freeze = (await readBoundedJson(resolve(freezePath), 'AI reference freeze')).value
    if (freeze.kind !== 'frozen-single-AI-visual-reference-NOT-HUMAN-GROUND-TRUTH'
      || freeze.labelsSha256 !== sha256(labels.bytes)
      || freeze.validation?.selectionSha256 !== selectionFileSha256) {
      fail('AI_REFERENCE_FREEZE_MISMATCH', 'Labels or canonical selection do not match the supplied AI reference freeze. This digest check is not a human signature.')
    }
  }
  const sources = await verifyAiReferenceSourceBytes(selection.value, photoRoot)
  return {
    valid: true,
    ...summary,
    ...sources,
    frozenDigestVerified: Boolean(freezePath),
    claimBoundary: 'Single-AI visual reference only; not independent human ground truth and not approved for the human blind pilot.',
  }
}

const usage = 'Usage: node tools/validate-ai-reference.mjs --labels <labels.json> --selection <selection-manifest.json> --photo-root <directory> [--freeze <freeze.json>]'

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage}\n`); return }
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1]
    if (!['--labels', '--selection', '--photo-root', '--freeze'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options, key)) fail('AI_REFERENCE_CLI_INVALID', `Unsupported, duplicate or incomplete option: ${key || '(missing)'}.`)
    options[key] = value
  }
  for (const key of ['--labels', '--selection', '--photo-root']) if (!options[key]) fail('AI_REFERENCE_CLI_INVALID', `${key} is required. ${usage}`)
  const result = await validateAiReferenceFiles({ labelsPath: options['--labels'], selectionPath: options['--selection'], photoRoot: options['--photo-root'], freezePath: options['--freeze'] })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`AI reference validation failed: ${error.message}\n`); process.exitCode = 1 })
