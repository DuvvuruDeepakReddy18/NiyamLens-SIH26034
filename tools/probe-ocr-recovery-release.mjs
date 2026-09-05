import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
const phase = process.argv[2]
if (!['before', 'after'].includes(phase)) throw new Error('Specify before or after. This probe only reads the fixed public project.')
const origin = 'https://niyamlens-sih26034.vercel.app'
const expectedAsset = phase === 'before' ? '/assets/index-E1tT8IDD.js' : '/assets/index-gwkgHLXn.js'
const report = { phase, startedAt: new Date().toISOString(), sourceCommit: phase === 'after' ? '6c9d185616ac91ad7e241f9bee381d90e62818f0' : 'd13aad50adedaa2c3a7d1c41bd036fe65bcb5b54', checks: [], error: null, scope: 'Anonymous public smoke probes only; not signed-in hosted OCR, load testing or human field validation.' }
async function read(path) {
  const started = performance.now()
  const response = await fetch(`${origin}${path}`, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000) })
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.ok(bytes.length <= 1500000)
  report.checks.push({ path, status: response.status, bytes: bytes.length, elapsedMs: Math.round(performance.now() - started), sha256: createHash('sha256').update(bytes).digest('hex') })
  return { status: response.status, text: new TextDecoder().decode(bytes) }
}
try {
  const page = await read('/'); assert.equal(page.status, 200)
  const asset = page.text.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>/)?.[1]
  assert.equal(asset, expectedAsset)
  const bundle = await read(asset); assert.equal(bundle.status, 200)
  if (phase === 'after') for (const marker of ['Recover an overprinted or sideways dark stamp', 'max-rgb-v1', 'dark-ink-90']) assert.ok(bundle.text.includes(marker))
  const health = await read('/api/health'); assert.equal(health.status, 200); assert.equal(JSON.parse(health.text).ready, true)
  const cases = await read('/api/cases'); assert.equal(cases.status, 401)
} catch (error) { report.error = error.message; process.exitCode = 1 }
report.finishedAt = new Date().toISOString()
await mkdir('reports/ocr-recovery-2026-09-05', { recursive: true })
const output = `reports/ocr-recovery-2026-09-05/public-${phase}-${report.startedAt.replace(/[:.]/g, '-')}.json`
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output, ...report }, null, 2))
