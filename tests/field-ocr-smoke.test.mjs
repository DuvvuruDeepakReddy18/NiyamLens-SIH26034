import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { pilotHash } from '../tools/field-pilot.mjs'
import { SMOKE_LIMITS, validateSmokeSelection, smokeChildEnvironment, recognizeSmokeInChild, runFieldOcrSmoke, main } from '../tools/run-field-ocr-smoke.mjs'

const sample = index => ({ id: `SMOKE-${index}`, productKey: `test-sku-${index}`, sourcePath: `test-${index}.png`, sha256: pilotHash(`test-image-${index}`) })
const selection = (count = 1) => ({ schemaVersion: 1, kind: 'exploratory-field-ocr-selection', isHoldout: false, selectionPolicy: 'Synthetic test contract only, never unseen-label field performance.', samples: Array.from({ length: count }, (_, index) => sample(index + 1)) })
const engine = { name: 'Tesseract.js', version: 'mock-not-a-real-engine-run', coreVersion: 'mock', language: 'eng', modelSha256: 'a'.repeat(64), langPath: 'private-local-model-path', inputTransform: 'none' }
function fakeChild(onSend = () => {}) {
  const child = new EventEmitter(); child.pid = 12345; child.stderr = new EventEmitter(); child.kills = []
  child.send = (message, callback) => { callback?.(null); queueMicrotask(() => onSend(child, message)) }
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', null)); return true }
  return child
}
async function withPhotos(count, run) {
  const root = await mkdtemp(join(tmpdir(), 'niyamlens-smoke-contract-')); const paths = []; const chosen = selection(count)
  try {
    for (const [index, item] of chosen.samples.entries()) {
      const path = join(root, item.sourcePath); paths.push(path)
      const bytes = await sharp({ create: { width: 300, height: 300, channels: 3, background: { r: index * 30, g: 80, b: 90 } } }).png().toBuffer()
      item.sha256 = pilotHash(bytes); await writeFile(path, bytes)
    }
    return await run({ root, paths, chosen })
  } finally { for (const path of paths) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error }); await rmdir(root) }
}

test('smoke selection requires one to six unique unlabelled photos and refuses holdout claims', () => {
  assert.doesNotThrow(() => validateSmokeSelection(selection(6)))
  for (const value of [selection(0), selection(7), { ...selection(), isHoldout: true }]) assert.throws(() => validateSmokeSelection(value))
  for (const key of ['id', 'productKey', 'sourcePath', 'sha256']) {
    const duplicate = selection(2); duplicate.samples[1][key] = duplicate.samples[0][key]; assert.throws(() => validateSmokeSelection(duplicate), /DUPLICATE/)
  }
  const labelled = selection(); labelled.samples[0].expectedValues = { mrp: '22.00' }; assert.throws(() => validateSmokeSelection(labelled), /MUST_NOT_CONTAIN_LABELS/)
  const traversal = selection(); traversal.samples[0].sourcePath = '../outside.png'; assert.throws(() => validateSmokeSelection(traversal), /safe root-relative/)
})

test('an explicit run flag is required before any image or recognizer is used', async () => {
  let calls = 0
  await assert.rejects(runFieldOcrSmoke(selection(), { photoRoot: 'unused', engine, recognizer: () => { calls += 1 } }), /EXPLICIT_RUN/)
  await assert.rejects(main(['--photo-root', 'unused', '--input', 'unused', '--output', 'unused']), /EXPLICIT_RUN/)
  assert.equal(calls, 0)
})

test('child environment drops cloud/auth tokens, uses hidden window and bounded IPC settings', async () => {
  assert.deepEqual(smokeChildEnvironment({ PATH: 'safe', SystemRoot: 'windows', TMP: 'temp', SUPABASE_SERVICE_ROLE_KEY: 'secret', GITHUB_TOKEN: 'secret', VERCEL_TOKEN: 'secret', NODE_OPTIONS: '--unwanted' }), { PATH: 'safe', SystemRoot: 'windows', TMP: 'temp' })
  let receivedOptions; let receivedBytes
  const child = fakeChild((target, message) => { receivedBytes = message.bytes; target.emit('message', { type: 'result', rawText: 'unchanged\n', confidence: 71 }); target.emit('close', 0) })
  const result = await recognizeSmokeInChild(Buffer.from('synthetic-bytes'), { engine, timeoutMs: 1000 }, { spawnChild: (_file, args, options) => { receivedOptions = options; assert.deepEqual(args, ['--internal-child']); return child } })
  assert.equal(result.rawText, 'unchanged\n'); assert.equal(receivedBytes.toString(), 'synthetic-bytes')
  assert.equal(receivedOptions.windowsHide, true); assert.equal(receivedOptions.serialization, 'advanced'); assert.deepEqual(receivedOptions.stdio, ['ignore', 'ignore', 'pipe', 'ipc'])
  assert.deepEqual(receivedOptions.execArgv, [], 'Do not inherit --env-file, --require or --import from the parent Node process.')
})

test('recognizer timeout kills the child and waits for closure rather than leaving worker threads', async () => {
  const child = fakeChild()
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 100 }, { spawnChild: () => child }), /OCR_IMAGE_TIMEOUT/)
  assert.deepEqual(child.kills, ['SIGKILL'])
})

test('invalid and oversized child output is rejected and stderr never enters the result', async () => {
  for (const output of [{ type: 'result', rawText: 'x'.repeat(SMOKE_LIMITS.rawTextCharacters + 1), confidence: 10 }, { type: 'result', rawText: '', confidence: Infinity }, { type: 'unexpected', rawText: 'do not print me' }]) {
    const child = fakeChild(target => target.emit('message', output))
    await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => child }), /OCR_(?:OUTPUT_INVALID_OR_OVERSIZED|CHILD_INVALID_MESSAGE)/)
    assert.deepEqual(child.kills, ['SIGKILL'])
  }
  const noisy = fakeChild(target => target.stderr.emit('data', Buffer.alloc(SMOKE_LIMITS.stderrBytes + 1, 'x')))
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => noisy }), /OCR_CHILD_STDERR_LIMIT/)
})

test('arbitrary child error details are sanitized, including error-message children which fail to exit', async () => {
  const child = fakeChild(target => { target.emit('message', { type: 'error', code: 'private path and token should not escape' }); target.emit('close', 0) })
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => child }), /^Error: OCR_ENGINE_FAILED$/)
  const hanging = fakeChild(target => target.emit('message', { type: 'error', code: 'OCR_ENGINE_FAILED' }))
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 100 }, { spawnChild: () => hanging }), /OCR_ENGINE_FAILED/)
  assert.deepEqual(hanging.kills, ['SIGKILL'])
})

test('error after a live child spawn terminates and awaits close; a no-PID spawn failure is separate', async () => {
  const live = fakeChild(target => target.emit('error', new Error('private runtime error')))
  let closed = false
  live.kill = signal => { live.kills.push(signal); setTimeout(() => { closed = true; live.emit('close', null) }, 10); return true }
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => live }), /OCR_CHILD_PROCESS_ERROR/)
  assert.equal(closed, true); assert.deepEqual(live.kills, ['SIGKILL'])
  const noPid = fakeChild(target => target.emit('error', new Error('spawn failed'))); noPid.pid = undefined
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => noPid }), /OCR_CHILD_START_FAILED/)
  assert.deepEqual(noPid.kills, [])
})

test('synchronous send/setup failure after spawn kills the existing process', async () => {
  const child = fakeChild(); child.send = () => { throw new Error('send setup failed') }
  await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => child }), /OCR_CHILD_SETUP_FAILED/)
  assert.deepEqual(child.kills, ['SIGKILL'])
})

test('failed kill return, thrown kill and kill error event are termination failures, not permission to continue', async () => {
  for (const mode of ['false-return', 'throw', 'error-event']) {
    const child = fakeChild(target => target.emit('error', new Error('live process failed')))
    let closed = false
    child.kill = signal => {
      child.kills.push(signal)
      setTimeout(() => { closed = true; child.emit('close', null) }, 10)
      if (mode === 'throw') throw new Error('kill failed')
      if (mode === 'error-event') child.emit('error', new Error('kill error'))
      return mode !== 'false-return'
    }
    await assert.rejects(recognizeSmokeInChild(Buffer.from('fixture'), { engine, timeoutMs: 1000 }, { spawnChild: () => child }), /OCR_CHILD_TERMINATION_FAILED/)
    assert.equal(closed, true); assert.deepEqual(child.kills, ['SIGKILL'])
  }
})

test('mocked smoke preserves exact original bytes, unedited raw text and separate non-ground-truth suggestions', async () => {
  await withPhotos(1, async ({ root, paths, chosen }) => {
    const original = await readFile(paths[0]); const progress = []
    const rawText = '  MRP Rs. 22.00\r\nNET QTY 5OO ml\r\nPKD 19/10/25\n'
    const report = await runFieldOcrSmoke(chosen, { run: true, photoRoot: root, engine, progress: value => progress.push(value), recognizer: async bytes => { assert.deepEqual(bytes, original); return { rawText, confidence: 60 } } })
    assert.equal(report.rows[0].rawText, rawText); assert.equal(report.rows[0].rawTextSha256, pilotHash(rawText)); assert.equal(report.rows[0].verifiedSourceSha256, pilotHash(original))
    assert.deepEqual(await readFile(paths[0]), original)
    assert.equal(report.rows[0].manuallyEdited, false); assert.equal(report.rows[0].extractedSuggestions.notGroundTruth, true)
    assert.equal(report.isHoldout, false); assert.equal(report.accuracy, null); assert.equal(report.groundTruthProvided, false)
    assert.equal(Object.hasOwn(report.engine, 'langPath'), false)
    assert.deepEqual(progress.map(value => value.state), ['started', 'completed']); assert.ok(progress.every(value => value.rawText === undefined))
  })
})

test('one OCR failure is recorded without hiding it or dropping following samples', async () => {
  await withPhotos(2, async ({ root, chosen }) => {
    let attempts = 0
    const report = await runFieldOcrSmoke(chosen, { run: true, photoRoot: root, engine, recognizer: async () => { if (++attempts === 1) throw new Error('OCR_IMAGE_TIMEOUT'); return { rawText: '', confidence: null } } })
    assert.equal(attempts, 2); assert.equal(report.sampleCount, 2); assert.equal(report.attemptedPhotos, 2)
    assert.equal(report.failedOrUnrunPhotos, 1); assert.equal(report.rows[0].error, 'OCR_IMAGE_TIMEOUT'); assert.equal(report.rows[0].rawText, '')
    assert.equal(report.rows[1].error, null); assert.equal(report.rows[1].rawText, '')
  })
})

test('source hash mismatch refuses OCR and oversized/mock error output cannot become a repaired transcript', async () => {
  await withPhotos(2, async ({ root, chosen }) => {
    chosen.samples[0].sha256 = 'b'.repeat(64); let attempts = 0
    const report = await runFieldOcrSmoke(chosen, { run: true, photoRoot: root, engine, recognizer: async () => { attempts += 1; return { rawText: 'x'.repeat(SMOKE_LIMITS.rawTextCharacters + 1), confidence: 50 } } })
    assert.equal(attempts, 1); assert.equal(report.rows[0].error, 'SOURCE_IMAGE_SHA256_MISMATCH'); assert.equal(report.rows[0].ocrAttempted, false)
    assert.equal(report.rows[1].error, 'OCR_OUTPUT_INVALID_OR_OVERSIZED'); assert.equal(report.rows[1].rawText, '')
  })
})

test('termination failure stops additional workers and keeps remaining samples explicitly unrun', async () => {
  await withPhotos(2, async ({ root, chosen }) => {
    let calls = 0
    const report = await runFieldOcrSmoke(chosen, { run: true, photoRoot: root, engine, recognizer: async () => { calls += 1; throw new Error('OCR_CHILD_TERMINATION_FAILED') } })
    assert.equal(calls, 1); assert.equal(report.rows.length, 2); assert.equal(report.rows[1].ocrAttempted, false); assert.equal(report.rows[1].error, 'OCR_SKIPPED_AFTER_TERMINATION_FAILURE')
    assert.equal(report.failedOrUnrunPhotos, 2)
  })
})

test('CLI contract creates raw artifact once, refuses overwrite before OCR and rejects invalid UTF-8', async () => {
  await withPhotos(1, async ({ root, chosen }) => {
    const input = join(root, 'selection.json'); const output = join(root, 'raw.json')
    const args = ['--run', '--photo-root', root, '--input', input, '--output', output]
    let attempts = 0
    const dependencies = { getEngine: async () => engine, recognizer: async () => { attempts += 1; return { rawText: 'Mock raw text, not real recognition.\n', confidence: null } } }
    try {
      await writeFile(input, JSON.stringify(chosen))
      await main(args, dependencies)
      const bytes = await readFile(output); const artifact = JSON.parse(bytes.toString())
      assert.equal(artifact.rows[0].rawText, 'Mock raw text, not real recognition.\n'); assert.equal(attempts, 1)
      await assert.rejects(main(args, dependencies), error => error.code === 'EEXIST')
      assert.equal(attempts, 1); assert.deepEqual(await readFile(output), bytes)
      await writeFile(input, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))
      await assert.rejects(main(args, dependencies), /SMOKE_INPUT_INVALID_JSON_UTF8/)
    } finally { await unlink(input).catch(error => { if (error.code !== 'ENOENT') throw error }); await unlink(output).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  })
})
