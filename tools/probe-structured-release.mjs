// Fixed-origin anonymous deployment smoke probe. No account/token or remote write.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const phase = args[0]
assert.ok(['before', 'after'].includes(phase), 'Usage: node tools/probe-structured-release.mjs before|after [--expect-sha SHA256]')
assert.ok(args.length === 1 || args.length === 3 && args[1] === '--expect-sha', 'Unknown arguments; only the optional expected public-bundle digest is accepted.')
const expectedSha256 = args.length === 3 ? args[2].toLowerCase() : null
if (args.length === 3) assert.match(expectedSha256, /^[a-f0-9]{64}$/)
const origin = 'https://niyamlens-sih26034.vercel.app'
const markers = ['Read label fields', 'machine-structured-candidates-v1', 'Retry faint stamp detection', 'LMPC-RC-2026.09-RC7']
const maximumBytes = 2000000
const report = {
  kind: 'public-structured-release-anonymous-smoke', phase, origin, startedAt: new Date().toISOString(),
  expectedSha256, sourceCommit: null, checks: [], markers: [], error: null,
  scope: 'Four anonymous GETs: homepage, its observed bundle, health readiness and cases access denial. No sign-in, OCR execution, private records, writes, field-accuracy claim or independent source-commit attestation.',
}
async function read(path) {
  const started = performance.now()
  const response = await fetch(`${origin}${path}`, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const reader = response.body?.getReader()
  const chunks = []; let size = 0
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > maximumBytes) { await reader.cancel(); throw new Error(`Response exceeds ${maximumBytes} byte limit: ${path}`) }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = Buffer.concat(chunks, size)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  report.checks.push({ path, method: 'GET', status: response.status, bytes: size, elapsedMs: Math.round(performance.now() - started), sha256 })
  return { status: response.status, text: bytes.toString('utf8'), sha256 }
}
try {
  const page = await read('/'); assert.equal(page.status, 200, 'Public homepage must not redirect to Vercel authentication.')
  const asset = page.text.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/)?.[1]
  assert.match(asset || '', /^\/assets\/index-[\w-]+\.js$/)
  report.observedAsset = asset
  const bundle = await read(asset); assert.equal(bundle.status, 200)
  report.observedBundleSha256 = bundle.sha256
  if (expectedSha256) assert.equal(bundle.sha256, expectedSha256, 'Observed public bundle differs from the supplied release digest.')
  if (phase === 'after') {
    report.markers = markers.map(marker => ({ marker, present: bundle.text.includes(marker) }))
    assert.ok(report.markers.every(row => row.present), 'Public bundle is missing a structured-release marker.')
  }
  const health = await read('/api/health'); assert.equal(health.status, 200); assert.equal(JSON.parse(health.text).ready, true)
  const cases = await read('/api/cases'); assert.equal(cases.status, 401, 'Anonymous access to private cases must remain denied.')
} catch (error) { report.error = String(error.message).slice(0, 2000); process.exitCode = 1 }
report.finishedAt = new Date().toISOString()
const directory = resolve(import.meta.dirname, '../reports/root-cause-2026-09-05')
await mkdir(directory, { recursive: true })
const output = resolve(directory, `public-structured-${phase}-${report.startedAt.replace(/[:.]/g, '-')}.json`)
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
console.log(JSON.stringify({ output, ...report }, null, 2))
