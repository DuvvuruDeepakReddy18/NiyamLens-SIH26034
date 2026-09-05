// Bounded post-release diagnostic; no credentials, cloud writes or automatic rollback.
import { mkdir, open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
const origin = 'https://niyamlens-sih26034.vercel.app'
const asset = '/assets/index-E1tT8IDD.js'
const expectedSha = '509ce982693a073c685ff02ecfbafb9a17ed9d56f09626ff06616d266979d2df'
const start = Date.now(), duration = 15 * 60 * 1000, interval = 60 * 1000
const directory = resolve('reports/rc6-release-2026-09-05'); await mkdir(directory, { recursive: true })
const path = resolve(directory, 'public-probes-' + new Date(start).toISOString().replace(/[:.]/g, '-') + '.json')
const file = await open(path, 'wx')
const report = { kind: 'bounded-public-release-probes-not-load-test', origin, asset, expectedSha, startedAt: new Date(start).toISOString(), plannedDurationMs: duration, rows: [], finishedAt: null, passed: false,
  limitations: ['Low-volume synthetic endpoint probes, not real-user latency/error-rate telemetry or a stress test.', 'No provider runtime logs, authenticated user actions or human field performance measured here.', 'No automatic rollback; any failure is retained for explicit release review.'] }
async function probe(route, kind) {
  const began = performance.now()
  try {
    const response = await fetch(origin + route, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) })
    const bytes = Buffer.from(await response.arrayBuffer())
    let valid
    if (kind === 'html') valid = response.status === 200 && bytes.toString().includes(`src="${asset}"`)
    else if (kind === 'asset') valid = response.status === 200 && createHash('sha256').update(bytes).digest('hex') === expectedSha
    else if (kind === 'health') { const body = JSON.parse(bytes); valid = response.status === 200 && body.service === 'niyamlens' && body.ready === true && response.headers.get('cache-control')?.includes('no-store') }
    else valid = response.status === 401 && response.headers.get('cache-control')?.includes('no-store')
    return { route, status: response.status, passed: Boolean(valid), elapsedMs: Math.round(performance.now() - began) }
  } catch { return { route, passed: false, error: 'PROBE_FAILED', elapsedMs: Math.round(performance.now() - began) } }
}
try {
  for (let index = 0; index <= 15; index++) {
    const delay = start + index * interval - Date.now()
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
    const checks = await Promise.all([probe('/', 'html'), probe('/api/health', 'health'), probe('/api/cases', 'unauth'), ...(index === 0 || index === 15 ? [probe(asset, 'asset')] : [])])
    const row = { index, observedAt: new Date().toISOString(), checks, passed: checks.every(c => c.passed) }; report.rows.push(row)
    await file.truncate(0); await file.write(JSON.stringify(report, null, 2), 0, 'utf8'); await file.sync()
    console.log(JSON.stringify({ minute: index, passed: row.passed, checks }))
  }
  report.finishedAt = new Date().toISOString(); report.passed = report.rows.length === 16 && report.rows.every(r => r.passed)
  await file.truncate(0); await file.write(JSON.stringify(report, null, 2), 0, 'utf8'); await file.sync()
  console.log(JSON.stringify({ complete: true, passed: report.passed, path, snapshots: report.rows.length, observedDurationMs: Date.now() - start }))
  if (!report.passed) process.exitCode = 1
} finally { await file.close() }
