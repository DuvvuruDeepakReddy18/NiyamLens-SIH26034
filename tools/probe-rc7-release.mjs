import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
const phase = process.argv[2]
if (!['before', 'after'].includes(phase)) throw new Error('Specify before or after; fixed public project, anonymous GET requests only.')
const origin = 'https://niyamlens-sih26034.vercel.app'
const report = { phase, startedAt: new Date().toISOString(), sourceCommit: phase === 'after' ? '3f9ef45250cb4336900f40199018df28decaab9c' : '6c9d185616ac91ad7e241f9bee381d90e62818f0', checks: [], error: null, scope: 'Anonymous homepage/bundle/database-readiness/access-denial checks only; not hosted OCR, officer permissions, field accuracy or load testing.' }
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
  assert.match(asset || '', /^\/assets\/index-[\w-]+\.js$/)
  if (phase === 'before') assert.equal(asset, '/assets/index-gwkgHLXn.js')
  const bundle = await read(asset); assert.equal(bundle.status, 200)
  if (phase === 'after') for (const marker of ['LMPC-RC-2026.09-RC7', 'Dismiss crop preview', 'Not read yet', 'Reading changed — reconfirm']) assert.ok(bundle.text.includes(marker), marker)
  const health = await read('/api/health'); assert.equal(health.status, 200); assert.equal(JSON.parse(health.text).ready, true)
  const cases = await read('/api/cases'); assert.equal(cases.status, 401)
} catch (error) { report.error = error.message; process.exitCode = 1 }
report.finishedAt = new Date().toISOString()
await mkdir('reports/rc7-release-2026-09-05', { recursive: true })
const output = `reports/rc7-release-2026-09-05/public-${phase}-${report.startedAt.replace(/[:.]/g, '-')}.json`
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output, ...report }, null, 2))
