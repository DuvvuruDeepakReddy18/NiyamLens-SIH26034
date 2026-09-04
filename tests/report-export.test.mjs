import test from 'node:test'
import assert from 'node:assert/strict'
import { createReportExport, verifyReportCopy, reportFileName, EXPORT_LIMIT_BYTES, EXPORT_URL_GRACE_MS } from '../src/lib/reportExport.mjs'

const deferred = () => { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
const blob = (text = '{"rawOcrText":"MRP:22.00\\n500ml","original":"untouched"}') => new Blob([text], { type: 'application/json' })
const abortError = () => Object.assign(new Error('The user cancelled.'), { name: 'AbortError' })
function setup() {
  const changes = []; const created = []; const revoked = []; const timers = []
  const exporter = createReportExport({ onChange: (state) => changes.push(state), urlApi: { createObjectURL(value) { created.push(value); return `blob:test-${created.length}` }, revokeObjectURL(url) { revoked.push(url) } }, schedule(callback, delay) { timers.push({ callback, delay }); return 0 } })
  return { exporter, changes, created, revoked, timers }
}
const prepare = (exporter, data = blob()) => exporter.prepare({ recordId: 'CASE-1', format: 'json', build: () => data })
function handleFor(data, overrides = {}) {
  const calls = []
  const writable = { async write(value) { calls.push(['write', value]) }, async close() { calls.push(['close']) }, async abort() { calls.push(['abort']) }, ...overrides.writable }
  const handle = { async createWritable() { calls.push(['createWritable']); return writable }, async getFile() { calls.push(['getFile']); return data }, ...overrides.handle }
  return { calls, handle, writable }
}

test('prepared report preserves exact bytes and a persistent download URL, never claims saved', async () => {
  const { exporter, created, revoked } = setup(); const original = blob()
  assert.equal(await prepare(exporter, original), true)
  assert.equal(exporter.getState().artifact.blob, original)
  assert.equal(created[0], original)
  assert.equal(exporter.getState().artifact.name, 'CASE-1-evidence.json')
  assert.equal(exporter.getState().phase, 'ready')
  exporter.noteDownloadRequested()
  assert.equal(exporter.getState().phase, 'download_requested')
  assert.match(exporter.getState().message, /completion is not verified/)
  assert.deepEqual(revoked, [])
  exporter.noteDownloadRequested()
  assert.equal(created.length, 1, 'retry uses the same surviving blob URL')
})

test('Save as invokes the picker synchronously, then writes, closes and verifies exact bytes', async () => {
  const { exporter } = setup(); const original = blob(); await prepare(exporter, original)
  const picker = deferred(); const { handle, calls } = handleFor(blob()); let options
  const saving = exporter.save((value) => { options = value; return picker.promise })
  assert.equal(options.suggestedName, 'CASE-1-evidence.json', 'picker was invoked before the save promise yields')
  assert.deepEqual(options.types[0].accept, { 'application/json': ['.json'] })
  assert.equal(exporter.getState().phase, 'saving')
  assert.deepEqual(calls, [])
  picker.resolve(handle)
  assert.equal(await saving, true)
  assert.deepEqual(calls.map(([action]) => action), ['createWritable', 'write', 'close', 'getFile'])
  assert.equal(calls[1][1], original)
  assert.equal(exporter.getState().phase, 'saved')
  assert.match(exporter.getState().message, /read back and matched byte-for-byte/)
})

test('cancelled save keeps the prepared download and does not automatically trigger a fallback', async () => {
  const { exporter, revoked } = setup(); await prepare(exporter)
  const artifact = exporter.getState().artifact
  assert.equal(await exporter.save(() => Promise.reject(abortError())), false)
  assert.equal(exporter.getState().phase, 'cancelled')
  assert.equal(exporter.getState().artifact, artifact)
  assert.match(exporter.getState().message, /no download was started automatically/)
  assert.deepEqual(revoked, [])
})

test('unsupported picker keeps an explicit browser-download fallback without pretending saved', async () => {
  const { exporter } = setup(); await prepare(exporter)
  assert.equal(await exporter.save(undefined), false)
  assert.equal(exporter.getState().phase, 'ready')
  assert.match(exporter.getState().message, /unavailable/)
  assert.ok(exporter.getState().artifact.url)
})

test('write and permission failures are visible; partial stream is aborted and blob remains retryable', async () => {
  const { exporter } = setup(); await prepare(exporter)
  const { handle, calls } = handleFor(blob(), { writable: { async write() { throw new Error('Disk is full') } } })
  assert.equal(await exporter.save(() => Promise.resolve(handle)), false)
  assert.equal(exporter.getState().phase, 'error')
  assert.match(exporter.getState().message, /Disk is full/)
  assert.deepEqual(calls.map(([action]) => action), ['createWritable', 'abort'])
  assert.ok(exporter.getState().artifact)
  assert.equal(await exporter.save(() => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }) }), false)
  assert.match(exporter.getState().message, /Permission denied/)
})

test('write completion without successful read-back is not labelled saved', async () => {
  const { exporter } = setup(); await prepare(exporter)
  const { handle, calls } = handleFor(blob(), { handle: { async getFile() { throw new Error('Read permission revoked') } } })
  assert.equal(await exporter.save(() => Promise.resolve(handle)), false)
  assert.match(exporter.getState().message, /File write finished, but saved-copy verification failed/)
  assert.equal(exporter.getState().phase, 'error')
  assert.equal(calls.some(([action]) => action === 'abort'), false, 'completed file is not destroyed')
})

test('same-length corruption in saved copy is rejected, not just size-checked', async () => {
  const { exporter } = setup(); await prepare(exporter, blob('abc'))
  const { handle } = handleFor(blob('abd'))
  assert.equal(await exporter.save(() => Promise.resolve(handle)), false)
  assert.equal(exporter.getState().phase, 'error')
  assert.match(exporter.getState().message, /did not match/)
})

test('user-selected saved copy must exactly match; mismatch never changes original artifact', async () => {
  const { exporter } = setup(); await prepare(exporter, blob('123'))
  const artifact = exporter.getState().artifact
  assert.equal(await exporter.verify(blob('124')), false)
  assert.equal(exporter.getState().artifact, artifact)
  assert.equal(exporter.getState().phase, 'error')
  assert.equal(await exporter.verify(blob('123')), true)
  assert.equal(exporter.getState().phase, 'verified')
  assert.match(exporter.getState().message, /Selected saved copy matches/)
})

test('stale successful and failed generations cannot publish into a newer record', async () => {
  for (const fail of [false, true]) {
    const { exporter, created } = setup(); const pending = deferred()
    const first = exporter.prepare({ recordId: 'OLD', format: 'docx', build: () => pending.promise })
    exporter.reset()
    await exporter.prepare({ recordId: 'NEW', format: 'json', build: () => blob('new') })
    if (fail) pending.reject(new Error('Old failure')); else pending.resolve(blob('old'))
    assert.equal(await first, false)
    assert.equal(exporter.getState().artifact.recordId, 'NEW')
    assert.equal(exporter.getState().phase, 'ready')
    assert.equal(created.length, 1, 'stale generations never allocate an unused URL')
  }
})

test('closing while picker is open prevents opening a writable stream when it later resolves', async () => {
  const { exporter } = setup(); await prepare(exporter)
  const picker = deferred(); const { handle, calls } = handleFor(blob())
  const saving = exporter.save(() => picker.promise)
  exporter.dispose(); picker.resolve(handle)
  assert.equal(await saving, false)
  assert.deepEqual(calls, [])
})

test('switching records during a write aborts before close and cannot publish old success', async () => {
  const { exporter } = setup(); await prepare(exporter)
  const write = deferred(); const started = deferred()
  const { handle, calls } = handleFor(blob(), { writable: { async write() { started.resolve(); await write.promise } } })
  const saving = exporter.save(() => Promise.resolve(handle))
  await started.promise
  exporter.reset(); await prepare(exporter, blob('new case'))
  write.resolve()
  assert.equal(await saving, false)
  assert.equal(calls.some(([action]) => action === 'close'), false)
  assert.equal(calls.some(([action]) => action === 'abort'), true)
  assert.equal(await exporter.getState().artifact.blob.text(), 'new case')
  assert.equal(exporter.getState().phase, 'ready')
})

test('stale read-back verification cannot replace a newer export status', async () => {
  const { exporter } = setup(); await prepare(exporter, blob('abc'))
  const read = deferred()
  const checking = exporter.verify({ size: 3, arrayBuffer: () => read.promise })
  exporter.reset(); await prepare(exporter, blob('new'))
  read.resolve(await blob('abc').arrayBuffer())
  assert.equal(await checking, false)
  assert.equal(exporter.getState().phase, 'ready')
})

test('generation and save are single-flight; repeated gestures do not start duplicate writes', async () => {
  const { exporter } = setup(); const pending = deferred()
  const preparing = exporter.prepare({ recordId: 'ONE', format: 'json', build: () => pending.promise })
  assert.equal(await prepare(exporter), false)
  pending.resolve(blob()); await preparing
  const picker = deferred(); let pickers = 0
  const saving = exporter.save(() => { pickers++; return picker.promise })
  assert.equal(await exporter.save(() => { pickers++; return Promise.resolve() }), false)
  assert.equal(await prepare(exporter), false)
  assert.equal(pickers, 1)
  picker.reject(abortError()); await saving
})

test('replaced or closed artifact URLs are revoked once after a browser-consumption grace period', async () => {
  const { exporter, revoked, timers } = setup()
  await prepare(exporter); exporter.noteDownloadRequested()
  await prepare(exporter, blob('second'))
  assert.deepEqual(revoked, [])
  assert.equal(timers[0].delay, EXPORT_URL_GRACE_MS)
  exporter.dispose(); exporter.dispose()
  assert.equal(timers.length, 2)
  for (const timer of timers) timer.callback()
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2'])
})

test('invalid, empty, oversized and failed reports do not create links', async () => {
  for (const value of [null, new Blob([]), { size: EXPORT_LIMIT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) }]) {
    const { exporter, created } = setup()
    assert.equal(await prepare(exporter, value), false)
    assert.equal(created.length, 0)
    assert.equal(exporter.getState().phase, 'error')
  }
  const { exporter } = setup()
  assert.equal(await exporter.prepare({ recordId: 'X', format: 'docx', build: () => { throw new Error('Image hash mismatch') } }), false)
  assert.match(exporter.getState().message, /Image hash mismatch/)
})

test('safe filenames and byte comparison cover format, path characters and size mismatches', async () => {
  assert.equal(reportFileName('../report:<>|', 'docx'), '___report____-inspection.docx')
  assert.equal(reportFileName('CASE', 'docx'), 'CASE-inspection.docx')
  assert.equal(await verifyReportCopy(blob('abc'), blob('ab')), false)
  assert.equal(await verifyReportCopy(blob('abc'), null), false)
  assert.equal(await verifyReportCopy(blob('abc'), blob('abc')), true)
})
