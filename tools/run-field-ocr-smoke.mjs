#!/usr/bin/env node
// Explicitly exploratory Node OCR. No browser, cloud session, image rewrite or
// model download. The real recognizer runs only behind --run.
import { open, realpath } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { readBoundedFile } from './verify-cloud-export.mjs'
import { readPilotPhoto, pilotHash } from './field-pilot.mjs'
import { assertPilotJson, canonicalPilotJson, safePilotPath } from '../src/lib/fieldPilot.mjs'
import { extractDeclarations } from '../src/lib/extraction.mjs'

const script = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(script), '..')
const require = createRequire(import.meta.url)
export const SMOKE_LIMITS = Object.freeze({ photos: 6, selectionBytes: 100_000, photoBytes: 15 * 1024 * 1024, rawTextCharacters: 100_000, defaultTimeoutMs: 60_000, maximumTimeoutMs: 120_000, stderrBytes: 64 * 1024 })
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const fail = code => { throw new Error(code) }
const check = (condition, code) => { if (!condition) fail(code) }
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(value)
const safeHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const timeoutValid = value => Number.isInteger(value) && value >= 100 && value <= SMOKE_LIMITS.maximumTimeoutMs
const safeCode = error => /^(?:OCR|IMAGE|SOURCE|SMOKE)_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'OCR_ENGINE_FAILED'
const utf8Json = bytes => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { fail('SMOKE_INPUT_INVALID_JSON_UTF8') } }

export function validateSmokeSelection(value) {
  assertPilotJson(value)
  check(plain(value) && value.schemaVersion === 1 && value.kind === 'exploratory-field-ocr-selection', 'SMOKE_SELECTION_SCHEMA_INVALID')
  check(typeof value.selectionPolicy === 'string' && value.selectionPolicy.trim().length > 0 && value.selectionPolicy.length <= 2000, 'SMOKE_SELECTION_POLICY_REQUIRED')
  check(value.isHoldout === undefined || value.isHoldout === false, 'SMOKE_CANNOT_CLAIM_HOLDOUT')
  check(Array.isArray(value.samples) && value.samples.length >= 1 && value.samples.length <= SMOKE_LIMITS.photos, 'SMOKE_REQUIRES_ONE_TO_SIX_PHOTOS')
  const ids = new Set(); const paths = new Set(); const products = new Set(); const hashes = new Set()
  for (const sample of value.samples) {
    check(plain(sample) && safeId(sample.id) && safeHash(sample.sha256), 'SMOKE_SAMPLE_ID_HASH_INVALID')
    check(typeof sample.productKey === 'string' && sample.productKey.length > 0 && sample.productKey.length <= 200 && sample.productKey === sample.productKey.trim().toLowerCase(), 'SMOKE_PRODUCT_KEY_INVALID')
    check(!['groundTruth', 'expectedValues', 'workingText', 'fields'].some(key => Object.hasOwn(sample, key)), 'SMOKE_SELECTION_MUST_NOT_CONTAIN_LABELS')
    const path = safePilotPath(sample.sourcePath)
    check(path === sample.sourcePath, 'SMOKE_SOURCE_PATH_MUST_USE_FORWARD_SLASHES')
    for (const [set, item] of [[ids, sample.id], [paths, path.toLowerCase()], [products, sample.productKey], [hashes, sample.sha256]]) {
      check(!set.has(item), 'SMOKE_DUPLICATE_SAMPLE_SKU_PATH_OR_HASH'); set.add(item)
    }
  }
  return value
}

export async function smokeEngineMetadata() {
  const readVersion = async packageName => utf8Json(await readBoundedFile(require.resolve(`${packageName}/package.json`), 100_000)).version
  const langPath = await realpath(resolve(repoRoot, 'public/ocr/lang'))
  const modelBytes = await readBoundedFile(resolve(langPath, 'eng.traineddata.gz'), 40_000_000)
  check(modelBytes[0] === 0x1f && modelBytes[1] === 0x8b, 'OCR_LOCAL_MODEL_INVALID')
  return { name: 'Tesseract.js', version: await readVersion('tesseract.js'), coreVersion: await readVersion('tesseract.js-core'), language: 'eng', oem: 1, oemName: 'LSTM_ONLY', psm: '3', psmName: 'AUTO', cacheMethod: 'none', gzip: true, modelPath: 'public/ocr/lang/eng.traineddata.gz', modelSha256: pilotHash(modelBytes), inputTransform: 'none: exact original image bytes, no crop, rotation, resizing or manual repairs', parameters: { tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' }, pipeline: 'Node-only whole-original smoke; not the full browser OCR/preprocessing pipeline', langPath }
}

export function smokeChildEnvironment(environment = process.env) {
  const allowed = new Set(['systemroot', 'windir', 'path', 'temp', 'tmp', 'tmpdir', 'lang', 'lc_all'])
  return Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key.toLowerCase())))
}

// createWorker does not expose its worker handle until initialization resolves.
// Isolating it in a Node child lets the parent terminate initialization hangs as
// well as recognition hangs; Tesseract's worker threads die with that process.
export function recognizeSmokeInChild(bytes, { engine, timeoutMs = SMOKE_LIMITS.defaultTimeoutMs }, { spawnChild = fork } = {}) {
  check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= SMOKE_LIMITS.photoBytes, 'IMAGE_BYTES_INVALID')
  check(timeoutValid(timeoutMs), 'SMOKE_TIMEOUT_INVALID')
  return new Promise((resolveResult, rejectResult) => {
    let child; let timer; let killTimer; let settled = false; let stopping = false; let result = null; let failure = null; let stderrBytes = 0
    const finish = () => {
      if (settled) return
      settled = true; clearTimeout(timer); clearTimeout(killTimer)
      if (failure) rejectResult(new Error(failure))
      else if (result) resolveResult(result)
      else rejectResult(new Error('OCR_CHILD_EXITED_WITHOUT_RESULT'))
    }
    const stop = code => {
      if (settled || stopping) return
      stopping = true; failure ||= code
      clearTimeout(timer)
      // A kill/send error does not establish that the process is gone. Keep
      // waiting for close; if termination cannot be established, stop the batch.
      killTimer = setTimeout(() => { failure = 'OCR_CHILD_TERMINATION_FAILED'; finish() }, 2000)
      try { if (child.kill('SIGKILL') === false) failure = 'OCR_CHILD_TERMINATION_FAILED' }
      catch { failure = 'OCR_CHILD_TERMINATION_FAILED' }
    }
    try {
      child = spawnChild(script, ['--internal-child'], { cwd: repoRoot, windowsHide: true, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: smokeChildEnvironment(), execArgv: [] })
      timer = setTimeout(() => stop('OCR_IMAGE_TIMEOUT'), timeoutMs)
      child.stderr?.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > SMOKE_LIMITS.stderrBytes) stop('OCR_CHILD_STDERR_LIMIT') })
      child.on('error', () => {
        if (settled) return
        if (Number.isInteger(child.pid) && child.pid > 0) {
          if (stopping) failure = 'OCR_CHILD_TERMINATION_FAILED'
          else stop('OCR_CHILD_PROCESS_ERROR')
        } else { failure = 'OCR_CHILD_START_FAILED'; finish() }
      })
      child.on('message', message => {
        if (settled || failure) return
        if (!plain(message) || result || !['result', 'error'].includes(message.type)) { stop('OCR_CHILD_INVALID_MESSAGE'); return }
        if (message.type === 'error') { failure = safeCode(new Error(message.code)); return }
        if (typeof message.rawText !== 'string' || message.rawText.length > SMOKE_LIMITS.rawTextCharacters || (message.confidence !== null && (!Number.isFinite(message.confidence) || message.confidence < 0 || message.confidence > 100))) { stop('OCR_OUTPUT_INVALID_OR_OVERSIZED'); return }
        result = { rawText: message.rawText, confidence: message.confidence }
      })
      child.once('close', code => { if (code !== 0 && !failure) failure = 'OCR_CHILD_FAILED'; finish() })
      child.send({ type: 'recognize', bytes, engine }, error => { if (error) stop('OCR_CHILD_SEND_FAILED') })
    } catch {
      if (Number.isInteger(child?.pid) && child.pid > 0) stop('OCR_CHILD_SETUP_FAILED')
      else { failure = 'OCR_CHILD_START_FAILED'; finish() }
    }
  })
}

async function originalBytes(photoRoot, sample) {
  const metadata = await readPilotPhoto(photoRoot, sample.sourcePath)
  check(metadata.sha256 === sample.sha256, 'SOURCE_IMAGE_SHA256_MISMATCH')
  const root = await realpath(photoRoot); const path = await realpath(resolve(root, safePilotPath(sample.sourcePath)))
  const child = relative(root, path)
  check(child && !child.startsWith('..') && !isAbsolute(child), 'SOURCE_IMAGE_OUTSIDE_PHOTO_ROOT')
  const bytes = await readBoundedFile(path, SMOKE_LIMITS.photoBytes)
  check(pilotHash(bytes) === sample.sha256, 'SOURCE_IMAGE_CHANGED_DURING_READ')
  return { bytes, metadata }
}

export async function runFieldOcrSmoke(selection, { run = false, photoRoot, engine, timeoutMs = SMOKE_LIMITS.defaultTimeoutMs, recognizer = recognizeSmokeInChild, progress = () => {} } = {}) {
  check(run === true, 'SMOKE_REQUIRES_EXPLICIT_RUN')
  validateSmokeSelection(selection); check(timeoutValid(timeoutMs), 'SMOKE_TIMEOUT_INVALID')
  check(typeof photoRoot === 'string' && photoRoot.length > 0, 'SMOKE_PHOTO_ROOT_REQUIRED')
  check(plain(engine) && engine.name === 'Tesseract.js' && typeof engine.version === 'string' && safeHash(engine.modelSha256), 'SMOKE_ENGINE_METADATA_REQUIRED')
  const startedAt = new Date().toISOString(); const rows = []
  for (const [index, sample] of selection.samples.entries()) {
    const started = performance.now(); const rowStartedAt = new Date().toISOString()
    progress({ index: index + 1, total: selection.samples.length, sampleId: sample.id, state: 'started' })
    let metadata = null; let rawText = ''; let confidence = null; let error = null; let ocrAttempted = false
    try {
      const original = await originalBytes(photoRoot, sample); metadata = original.metadata; ocrAttempted = true
      const output = await recognizer(original.bytes, { engine, timeoutMs })
      check(plain(output) && typeof output.rawText === 'string' && output.rawText.length <= SMOKE_LIMITS.rawTextCharacters, 'OCR_OUTPUT_INVALID_OR_OVERSIZED')
      rawText = output.rawText
      confidence = output.confidence ?? null
      check(confidence === null || (Number.isFinite(confidence) && confidence >= 0 && confidence <= 100), 'OCR_CONFIDENCE_INVALID')
    } catch (caught) { rawText = ''; confidence = null; error = metadata ? safeCode(caught) : caught?.message?.startsWith('SOURCE_') ? safeCode(caught) : 'IMAGE_VALIDATION_FAILED' }
    const parsed = extractDeclarations(rawText)
    rows.push({ sampleId: sample.id, productKey: sample.productKey, sourcePath: sample.sourcePath, sourceSha256: sample.sha256, verifiedSourceSha256: metadata?.sha256 ?? null, sourceByteLength: metadata?.byteLength ?? null, width: metadata?.width ?? null, height: metadata?.height ?? null, mode: 'node-tesseract-eng-lstm-auto-whole-original', ocrAttempted, startedAt: rowStartedAt, finishedAt: new Date().toISOString(), elapsedSeconds: (performance.now() - started) / 1000, rawText, rawTextSha256: pilotHash(rawText), transcriptKind: 'raw-ocr-unedited', manuallyEdited: false, error, engineConfidence: confidence, extractedSuggestions: { notGroundTruth: true, fields: Object.fromEntries(['mrp', 'netQuantity', 'packDate'].map(field => [field, { value: parsed.byId[field].value, conflict: parsed.byId[field].conflict, validation: parsed.byId[field].validation?.status ?? null }])) } })
    progress({ index: index + 1, total: selection.samples.length, sampleId: sample.id, state: error ? 'failed' : 'completed', error, rawCharacters: rawText.length })
    // An OS-level inability to kill a worker is a safety stop, not permission to
    // start more concurrent workers. Preserve skipped rows explicitly.
    if (error === 'OCR_CHILD_TERMINATION_FAILED') {
      for (const unrun of selection.samples.slice(index + 1)) rows.push({ sampleId: unrun.id, productKey: unrun.productKey, sourcePath: unrun.sourcePath, sourceSha256: unrun.sha256, verifiedSourceSha256: null, mode: 'node-tesseract-eng-lstm-auto-whole-original', ocrAttempted: false, startedAt: null, finishedAt: null, elapsedSeconds: null, rawText: '', rawTextSha256: pilotHash(''), transcriptKind: 'raw-ocr-unedited', manuallyEdited: false, error: 'OCR_SKIPPED_AFTER_TERMINATION_FAILURE', engineConfidence: null, extractedSuggestions: null })
      break
    }
  }
  const { langPath: _privateLangPath, ...publicEngine } = engine
  return { schemaVersion: 1, kind: 'exploratory-field-ocr-smoke', startedAt, finishedAt: new Date().toISOString(), isHoldout: false, groundTruthProvided: false, accuracy: null, selectionPolicy: selection.selectionPolicy, selectionSha256: pilotHash(canonicalPilotJson(selection)), engine: publicEngine, timeoutMs, sampleCount: selection.samples.length, attemptedPhotos: rows.filter(row => row.ocrAttempted).length, completedPhotos: rows.filter(row => !row.error).length, failedOrUnrunPhotos: rows.filter(row => row.error).length, rows, limitations: ['Exploratory raw-output smoke only. No ground truth, field accuracy, compliance correctness or holdout performance is measured.', 'These SKUs have now been exposed to development evaluation. Record them in a field-smoke exclusion marker and do not later call them unseen.', 'English-only Node Tesseract whole-original execution is not the full browser OCR/preprocessing or guided-crop pipeline.', 'Extracted suggestions and engine confidence are not verified labels or correctness scores.', 'Raw OCR is preserved unchanged; no text repair, manual correction, best-of-attempt selection or model tuning occurs.', 'Latency includes photo read/validation and fresh worker initialization; it is not steady-state browser latency.'] }
}

async function childMain() {
  check(typeof process.send === 'function', 'OCR_CHILD_IPC_REQUIRED')
  process.once('message', async message => {
    let worker = null; let result
    try {
      check(plain(message) && message.type === 'recognize' && Buffer.isBuffer(message.bytes) && message.bytes.length <= SMOKE_LIMITS.photoBytes, 'OCR_CHILD_INVALID_REQUEST')
      const localEngine = await smokeEngineMetadata()
      check(message.engine?.modelSha256 === localEngine.modelSha256 && message.engine?.version === localEngine.version, 'OCR_LOCAL_MODEL_CHANGED')
      const { default: tesseract } = await import('tesseract.js')
      const { createWorker, OEM, PSM } = tesseract
      worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath: localEngine.langPath, cacheMethod: 'none', gzip: true, logger: () => {}, errorHandler: () => {} })
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
      const output = await worker.recognize(message.bytes, {}, { text: true })
      check(typeof output?.data?.text === 'string' && output.data.text.length <= SMOKE_LIMITS.rawTextCharacters, 'OCR_OUTPUT_INVALID_OR_OVERSIZED')
      result = { type: 'result', rawText: output.data.text, confidence: Number.isFinite(output.data.confidence) ? output.data.confidence : null }
    } catch (error) { result = { type: 'error', code: safeCode(error) } }
    finally { if (worker) await worker.terminate().catch(() => {}) }
    process.send(result, () => { process.disconnect(); process.exit(0) })
  })
}

const usage = `Explicit local exploratory OCR; at most six selected new-to-team SKUs.
node tools/run-field-ocr-smoke.mjs --run --photo-root DIRECTORY --input SELECTION.json --output PRIVATE-RAW.json [--timeout-ms 60000]
Selection: {schemaVersion:1,kind:'exploratory-field-ocr-selection',selectionPolicy:'...',samples:[{id,productKey,sourcePath,sha256}]}.
Paths are relative to --photo-root. Original images are unchanged. Output is create-only.
Uses installed Tesseract.js 7 / local English LSTM model / AUTO segmentation; no model downloads.
This is NOT an accuracy benchmark or the full browser pipeline. Keep raw output private.`

export async function main(args = process.argv.slice(2), { getEngine = smokeEngineMetadata, recognizer = recognizeSmokeInChild } = {}) {
  if (args.includes('--help') || args.includes('-h') || !args.length) { process.stdout.write(`${usage}\n`); return }
  const options = {}; let run = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--run') { check(!run, 'SMOKE_DUPLICATE_RUN_FLAG'); run = true; continue }
    check(['--photo-root', '--input', '--output', '--timeout-ms'].includes(arg) && args[index + 1] && !args[index + 1].startsWith('--') && options[arg] === undefined, 'SMOKE_ARGUMENT_INVALID')
    options[arg] = args[++index]
  }
  check(run, 'SMOKE_REQUIRES_EXPLICIT_RUN')
  check(options['--photo-root'] && options['--input'] && options['--output'], 'SMOKE_REQUIRED_ARGUMENT_MISSING')
  const inputPath = resolve(options['--input']); const outputPath = resolve(options['--output']); check(inputPath !== outputPath, 'SMOKE_OUTPUT_MUST_NOT_REPLACE_INPUT')
  const selection = validateSmokeSelection(utf8Json(await readBoundedFile(inputPath, SMOKE_LIMITS.selectionBytes)))
  const timeoutMs = options['--timeout-ms'] === undefined ? SMOKE_LIMITS.defaultTimeoutMs : Number(options['--timeout-ms'])
  check(timeoutValid(timeoutMs), 'SMOKE_TIMEOUT_INVALID')
  const engine = await getEngine()
  const handle = await open(outputPath, 'wx')
  try {
    const report = await runFieldOcrSmoke(selection, { run, photoRoot: resolve(options['--photo-root']), engine, timeoutMs, recognizer, progress: item => process.stdout.write(`${item.sampleId}: ${item.state} (${item.index}/${item.total})${item.error ? ` ${item.error}` : ''}\n`) })
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await handle.sync()
    process.stdout.write(`Saved private raw artifact. Completed ${report.completedPhotos}/${report.sampleCount}; failed or unrun ${report.failedOrUnrunPhotos}. No accuracy score computed.\n`)
    return report
  } finally { await handle.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  if (process.argv[2] === '--internal-child' && process.send) await childMain()
  else main().catch(error => { process.stderr.write(`Exploratory OCR failed: ${error?.code === 'EEXIST' ? 'OUTPUT_ALREADY_EXISTS' : safeCode(error)}\n`); process.exitCode = 1 })
}
