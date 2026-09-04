import test from 'node:test'
import assert from 'node:assert/strict'
import { auditProduction, classifyAudit } from './audit-production.mjs'

const report = (counts = {}, status = 0) => ({ status, stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0, ...counts } } }) })
const quiet = { log() {}, pause: async () => {} }

test('only complete successful audit reports can pass the high-severity gate', () => {
  assert.equal(classifyAudit(report()), 'clean')
  assert.equal(classifyAudit(report({ moderate: 1, total: 1 })), 'clean')
  assert.equal(classifyAudit(report({ high: 1, total: 1 })), 'vulnerable')
  assert.equal(classifyAudit(report({ critical: 1, total: 1 }, 1)), 'vulnerable')
  assert.equal(classifyAudit(report({}, 1)), 'failed')
  assert.equal(classifyAudit({ status: 0, stdout: '{}' }), 'unavailable')
  assert.equal(classifyAudit({ status: 0, stdout: '<html>registry error</html>' }), 'unavailable')
  assert.equal(classifyAudit({ status: 1, stdout: JSON.stringify({ error: { code: 'E400' } }) }), 'unavailable')
  assert.equal(classifyAudit({ ...report(), error: { code: 'ETIMEDOUT' } }), 'unavailable')
  assert.equal(classifyAudit({ ...report({ high: 1, total: 1 }, 1), error: { code: 'ETIMEDOUT' } }), 'vulnerable')
})

test('registry failure is retried but remains red if no valid report arrives', async () => {
  let attempts = 0; const delays = []
  assert.equal(await auditProduction({ ...quiet, execute: () => { attempts++; return { status: 1, stdout: '' } }, pause: async (ms) => delays.push(ms) }), 1)
  assert.equal(attempts, 3); assert.deepEqual(delays, [5000, 10000])
})

test('one transient invalid response may recover to an actual clean report', async () => {
  let attempts = 0
  assert.equal(await auditProduction({ ...quiet, execute: () => ++attempts === 1 ? { status: 1, stdout: '' } : report() }), 0)
  assert.equal(attempts, 2)
})

test('high or critical findings fail immediately without being retried away', async () => {
  for (const severity of ['high', 'critical']) {
    let attempts = 0
    assert.equal(await auditProduction({ ...quiet, execute: () => { attempts++; return report({ [severity]: 1, total: 1 }, 1) } }), 1)
    assert.equal(attempts, 1)
  }
})

test('an unexplained nonzero exit on a complete report is a terminal failure', async () => {
  let attempts = 0
  assert.equal(await auditProduction({ ...quiet, execute: () => { attempts++; return report({}, 2) } }), 1)
  assert.equal(attempts, 1)
})
