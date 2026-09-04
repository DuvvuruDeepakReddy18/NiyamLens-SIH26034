import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep npm's vulnerability calculation and high/critical threshold authoritative.
// Retry only when no complete audit report was returned, never a vulnerability.
export function classifyAudit(result) {
  let report
  try { report = JSON.parse(result.stdout) } catch { return 'unavailable' }
  const counts = report?.metadata?.vulnerabilities
  if (report?.auditReportVersion !== 2 || !report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)
    || !counts || !['info', 'low', 'moderate', 'high', 'critical', 'total'].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0)) return 'unavailable'
  if (counts.high > 0 || counts.critical > 0) return 'vulnerable'
  if (report.error || result.error || result.signal || result.status === null) return 'unavailable'
  // A nonzero npm exit must never be converted into a successful audit.
  return result.status === 0 ? 'clean' : 'failed'
}

function executeAudit() {
  return spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'audit', '--omit=dev', '--audit-level=high', '--json',
    '--registry=https://registry.npmjs.org', '--fetch-timeout=30000', '--fetch-retries=0',
  ], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32', windowsHide: true })
}

export async function auditProduction({ execute = executeAudit, log = console.log, pause = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`Production dependency audit: attempt ${attempt}/3 (60-second process limit).`)
    const result = execute()
    if (result.stdout) log(result.stdout.trim())
    if (result.stderr) log(result.stderr.trim())
    if (result.error) log(`Audit process error: ${result.error.code || result.error.message}`)
    const classification = classifyAudit(result)
    if (classification === 'clean') { log('Audit passed: a complete npm report contains no high/critical production findings.'); return 0 }
    if (classification === 'vulnerable' || classification === 'failed') {
      log('Audit failed. A completed audit is not retried to override its failure.'); return 1
    }
    if (attempt < 3) await pause(attempt * 5000)
  }
  log('Audit unavailable after three attempts. Registry/network failure is NOT a passing security check.')
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await auditProduction()
