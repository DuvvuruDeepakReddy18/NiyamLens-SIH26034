import test from 'node:test'
import assert from 'node:assert/strict'
import { publicHostedSealReport } from '../tools/hosted-report-projection.mjs'

test('hosted shareable report omits private identifiers, paths, raw text and arbitrary nested keys', () => {
  const secret = 'SENTINEL_PRIVATE_SECRET'
  const input = {
    runId: secret, origin: 'https://user:password@example.com/path?token=secret',
    stage: 'complete', passed: true, caseId: secret, createdCase: { id: secret, paths: [secret] },
    privateExportPath: secret, productName: secret, casePostAttempts: 1,
    appModules: ['/assets/index-ABCDE.js', secret, '/assets/index-ABCDE.js'],
    originalOcr: { rawText: secret, characters: 345, sha256: 'a'.repeat(64), typedCorrections: false },
    snapshots: [{ label: 'after-seal', path: secret, inspections: 1, drafts: 0, outbox: 0 }],
    finalExportVerification: { passed: true, panels: 1, private: secret, images: [{ kind: 'original', panel: 1, path: secret, sha256: 'b'.repeat(64), bytes: 20, hashMatchesRegisteredMetadata: true }], receipt: { presentAndWellFormed: true, version: 1, token: secret }, audit: { events: 6, internallyHashLinked: true }, ocr: { rawPassCount: 3 } },
  }
  const output = publicHostedSealReport(input)
  assert.equal(JSON.stringify(output).includes(secret), false)
  assert.equal(output.origin, 'https://example.com')
  assert.equal(output.caseCreated, true)
  assert.equal(output.exportVerification.clientAuditEvents, 6)
  assert.deepEqual(output.appModules, ['/assets/index-ABCDE.js'])
  assert.equal(output.localCheckpoints[0].outbox, 0)
  assert.equal(input.privateExportPath, secret)
})

test('failed hosted report cannot expose raw errors or arbitrary endpoint strings', () => {
  const output = publicHostedSealReport({ runId: 'test', stage: 'unknown-secret', failureCode: 'Error: password=secret', serverFailure: { path: '/api/users?secret=secret', status: 500 }, apiRequests: [{ path: '/api/evidence', method: 'POST', status: 503 }, { path: '/api/users?secret=secret', method: 'POST', status: 400 }] })
  assert.equal(output.failureCode, null)
  assert.equal(output.serverFailure, null)
  assert.equal(output.stage, 'unknown')
  assert.equal(output.caseCreated, false)
  assert.deepEqual(output.apiRequests, [{ path: '/api/evidence', method: 'POST', status: 503 }])
  assert.equal(JSON.stringify(output).includes('secret'), false)
})

test('offline evidence projection keeps only literal booleans and cannot imply expired-session coverage', () => {
  const output = publicHostedSealReport({ offlineRecovery: { requested: true, disconnectedSealQueued: true, queuedRecordSurvivedReload: true, explicitCachedWorkUsed: true, reconnectedAndSynced: true, expiredSessionTested: 'true', ocrExecutedOffline: false, privateToken: 'SECRET-SENTINEL' } })
  assert.equal(output.offlineRecovery.reconnectedAndSynced, true)
  assert.equal(output.offlineRecovery.expiredSessionTested, false)
  assert.equal(output.offlineRecovery.ocrExecutedOffline, false)
  assert.equal(JSON.stringify(output).includes('SECRET-SENTINEL'), false)
})
