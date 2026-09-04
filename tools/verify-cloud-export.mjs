// Read-only validation of a portable, hydrated managed JSON export. No network,
// browser session, environment credentials, or evidence rewriting is involved.
import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { verifyAuditChain } from '../src/lib/audit.mjs'
import { validateOcrHistory } from '../src/lib/ocrHistory.mjs'
import { EXPORT_LIMIT_BYTES } from '../src/lib/reportExport.mjs'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const HASH = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const requireValid = (condition, code) => { if (!condition) throw new Error(code) }
const validDate = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))

function checkShape(value, depth = 0, budget = { nodes: 0 }) {
  requireValid(++budget.nodes <= 50000 && depth <= 16, 'EXPORT_SHAPE_LIMIT')
  if (value === null || ['string', 'boolean'].includes(typeof value)) return
  if (typeof value === 'number') { requireValid(Number.isFinite(value), 'EXPORT_NONFINITE_NUMBER'); return }
  requireValid(Array.isArray(value) || plain(value), 'EXPORT_NOT_PLAIN_JSON')
  for (const [key, child] of Object.entries(value)) {
    requireValid(!['__proto__', 'prototype', 'constructor'].includes(key), 'EXPORT_RESERVED_KEY')
    checkShape(child, depth + 1, budget)
  }
}

function imageBytes(url) {
  requireValid(typeof url === 'string' && url.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40, 'IMAGE_MISSING_OR_TOO_LARGE')
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
  requireValid(match && match[2].length % 4 === 0, 'IMAGE_NOT_PORTABLE_CANONICAL_BASE64')
  const bytes = Buffer.from(match[2], 'base64')
  requireValid(bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES && bytes.toString('base64') === match[2], 'IMAGE_INVALID_BASE64_OR_SIZE')
  const mime = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
      : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp' : null
  requireValid(mime === match[1], 'IMAGE_MIME_SIGNATURE_MISMATCH')
  return bytes
}

// Validate only fields whose semantics exist in the current export contract.
// A local JSON file cannot establish that a receipt was issued by Supabase.
export async function verifyCloudExport(record, { sourceOriginalBytes } = {}) {
  requireValid(plain(record), 'EXPORT_NOT_RECORD')
  checkShape(record)
  requireValid(record.schemaVersion === 2 && /^[A-Za-z0-9_-]{8,100}$/.test(record.id || ''), 'MANAGED_SCHEMA_MISSING')
  requireValid(Number.isSafeInteger(record.serverVersion) && record.serverVersion >= 1 && typeof record.serverPayloadHash === 'string' && HASH.test(record.serverPayloadHash) && validDate(record.serverSealedAt) && record.syncState === 'synced', 'SERVER_RECEIPT_MISSING_OR_INVALID')
  requireValid(record.clientAuditUntrusted === true && record.ocrProvenance?.clientReported === true && record.ocrProvenance?.independentlyVerified === false, 'CLIENT_TRUST_BOUNDARY_MISSING')
  requireValid(plain(record.actor) && UUID.test(record.actor.id || ''), 'MANAGED_ACTOR_INVALID')
  requireValid(typeof record.text === 'string' && record.text.length <= 100000 && typeof record.rawOcrText === 'string' && record.rawOcrText.length <= 100000, 'RAW_WORKING_TRANSCRIPT_FIELDS_INVALID')
  requireValid(Array.isArray(record.evidenceItems) && record.evidenceItems.length >= 1 && record.evidenceItems.length <= 4, 'EVIDENCE_PANEL_COUNT_INVALID')
  try { validateOcrHistory(record.evidenceItems) } catch { throw new Error('OCR_HISTORY_INVALID') }
  const chain = record.clientAuditChain
  requireValid(Array.isArray(chain) && chain.length > 0 && chain.length <= 1000, 'CLIENT_AUDIT_MISSING_OR_TOO_LARGE')
  for (const [index, event] of chain.entries()) {
    requireValid(plain(event) && event.index === index && typeof event.type === 'string' && event.type.length > 0 && event.type.length <= 100 && typeof event.actor === 'string' && event.actor.length > 0 && event.actor.length <= 200 && validDate(event.at) && plain(event.payload) && HASH.test(event.hash || '') && (event.previousHash === 'GENESIS' || HASH.test(event.previousHash || '')), 'CLIENT_AUDIT_STRUCTURE_INVALID')
  }
  requireValid(await verifyAuditChain(chain), 'CLIENT_AUDIT_HASH_MISMATCH')
  requireValid(chain.some(event => event.type === 'inspection_sealed' && event.payload.inspectionId === record.id), 'CLIENT_SEAL_EVENT_MISSING')

  let totalImageBytes = 0; let rawPassCount = 0; let exactPaddlePassMatches = 0; let workspaceId
  const originals = []; const images = []
  record.evidenceItems.forEach((panel, index) => {
    requireValid(UUID.test(panel.id) && HASH.test(panel.sha256 || ''), 'PANEL_ID_OR_DIGEST_INVALID')
    for (const kind of ['original', 'analysis']) {
      const path = panel[`${kind}Path`]
      const parts = typeof path === 'string' && path.length <= 1024 ? path.split('/') : []
      const suffix = new RegExp(`^${kind}-([a-f0-9]{64})$`).exec(parts[4] || '')
      requireValid(parts.length === 5 && UUID.test(parts[0]) && parts[1] === record.actor.id && parts[2] === record.id && parts[3] === panel.id && suffix, 'PRIVATE_EVIDENCE_PATH_INVALID')
      workspaceId ??= parts[0]
      requireValid(parts[0] === workspaceId, 'MIXED_WORKSPACE_EVIDENCE')
      const expected = kind === 'original' ? panel.sha256 : suffix[1]
      requireValid(suffix[1] === expected, 'REGISTERED_IMAGE_DIGEST_MISMATCH')
      const bytes = imageBytes(panel[`${kind}Url`]); const sha256 = digest(bytes)
      requireValid(sha256 === expected, 'IMAGE_HASH_MISMATCH')
      totalImageBytes += bytes.length
      if (kind === 'original') originals.push(sha256)
      images.push({ panel: index + 1, kind, bytes: bytes.length, sha256, hashMatchesRegisteredMetadata: true })
    }
    for (const pass of panel.ocrPasses || []) {
      rawPassCount++
      if (pass.provider !== 'paddleocr-js') continue
      requireValid(['local-alternative-original', 'local-alternative-officer-focus'].includes(pass.strategy), 'PADDLE_PASS_STRATEGY_UNSUPPORTED')
      const marker = `\n\n[PADDLE ${pass.strategy === 'local-alternative-officer-focus' ? 'FOCUSED ' : ''}RAW OCR · PANEL ${index + 1}]\n`
      // Exact inclusion, not fuzzy OCR correction or a claim of independent
      // authenticity. Other providers use merged transcripts and are not
      // forced into Paddle's append format.
      requireValid(record.rawOcrText.includes(marker + pass.text), 'PADDLE_RAW_TRANSCRIPT_MISMATCH')
      exactPaddlePassMatches++
    }
  })
  if (rawPassCount) requireValid(record.rawOcrText.length > 0, 'RAW_TRANSCRIPT_MISSING')
  if (record.imageUrl !== undefined) requireValid(record.imageUrl === record.evidenceItems[0].analysisUrl, 'PRIMARY_ANALYSIS_IMAGE_MISMATCH')
  let sourceOriginalMatched = null
  if (sourceOriginalBytes !== undefined) {
    requireValid(Buffer.isBuffer(sourceOriginalBytes) && sourceOriginalBytes.length > 0 && sourceOriginalBytes.length <= MAX_IMAGE_BYTES, 'SOURCE_IMAGE_SIZE_INVALID')
    sourceOriginalMatched = originals.includes(digest(sourceOriginalBytes))
    requireValid(sourceOriginalMatched, 'SOURCE_ORIGINAL_HASH_MISMATCH')
  }
  return {
    passed: true, mode: 'read-only-offline-managed-export', panels: record.evidenceItems.length, images, totalImageBytes,
    receipt: { presentAndWellFormed: true, version: record.serverVersion, authenticityIndependentlyVerified: false, serverPayloadHashRecomputed: false },
    audit: { events: chain.length, internallyHashLinked: true, independentlyAuthentic: false },
    ocr: { rawPassCount, exactPaddlePassMatches, otherProviderPassContentsNotCrossChecked: rawPassCount - exactPaddlePassMatches, rawAndWorkingFieldsSeparate: true, workingDiffersFromRaw: record.text !== record.rawOcrText, recognitionAccuracyVerified: false },
    sourceOriginalMatched,
    limitations: [
      'The hydrated export contains image bytes and review fields absent from the stored payload; serverPayloadHash is not recomputed or authenticated here.',
      'Image hashes and client audit linkage prove internal consistency only. A coordinated rewrite can recompute client hashes.',
      'Raw Paddle strings are checked for exact inclusion in the raw transcript. This is not proof of OCR execution, completeness, accuracy, or legal compliance.',
    ],
  }
}

export async function readBoundedFile(path, limit = EXPORT_LIMIT_BYTES) {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    requireValid(stat.isFile() && stat.size > 0 && stat.size <= limit, 'INPUT_FILE_EMPTY_OR_TOO_LARGE')
    const chunks = []; let total = 0
    // Bound actual bytes too: the file could grow after stat().
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) {
      total += chunk.length
      requireValid(total <= limit, 'INPUT_FILE_TOO_LARGE')
      chunks.push(chunk)
    }
    requireValid(total > 0, 'INPUT_FILE_EMPTY')
    return Buffer.concat(chunks, total)
  } finally { await handle.close() }
}

export async function main(args) {
  requireValid(args.length === 1 || (args.length === 3 && args[1] === '--original'), 'USAGE: node tools/verify-cloud-export.mjs <export.json> [--original <photo>]')
  const bytes = await readBoundedFile(args[0])
  let record
  try { record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('EXPORT_JSON_INVALID') }
  const sourceOriginalBytes = args.length === 3 ? await readBoundedFile(args[2], MAX_IMAGE_BYTES) : undefined
  return { ...await verifyCloudExport(record, { sourceOriginalBytes }), artifactBytes: bytes.length, artifactSha256: digest(bytes) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)) }
  catch (error) {
    // Never print filesystem paths, arbitrary source strings, signed URLs, or
    // raw JSON parse errors. Validation failures use fixed, safe codes.
    console.error(JSON.stringify({ passed: false, error: /^(?:[A-Z][A-Z0-9_]+|USAGE: node tools\/verify-cloud-export\.mjs <export\.json> \[--original <photo>\])$/.test(error?.message || '') ? error.message : 'EXPORT_READ_OR_VALIDATION_FAILED' }))
    process.exitCode = 1
  }
}
