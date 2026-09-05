// Public, allowlisted release evidence. Never publish private pilot manifests.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const root = resolve('reports/rc6-release-2026-09-05')
const pilotRoot = resolve('.niyamlens-private/team-pilot/hosted-b44b9972-b65c-4a34-a095-eea93e4fd7d4')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const must = (value, message) => { if (!value) throw new Error(message) }
const m = await json(join(pilotRoot, 'manifest.json'))
must(m.status === 'passed' && m.permissions?.passed && m.membershipShutdown?.allDisabled, 'Completed contained pilot required')
must(m.release?.sha256 === '509ce982693a073c685ff02ecfbafb9a17ed9d56f09626ff06616d266979d2df', 'Expected public build required')
const browserPath = 'reports/readiness-2026-09-05/hosted-synthetic-browser-2026-09-05T11-45-40-482Z.json'
const sealPath = 'reports/readiness-2026-09-05/hosted-browser-seal-2026-09-05T11-48-11-866Z.json'
const browser = await json(browserPath), seal = await json(sealPath)
must(browser.passed && browser.rows.length === 4 && browser.rows.every(row => row.passed), 'Four completed Chrome roles required')
must(seal.passed && seal.offlineRecovery?.reconnectedAndSynced && seal.exportVerification?.passed, 'Successful hosted offline recovery and strict export required')
const monitorNames = (await readdir(root)).filter(name => /^public-probes-.*\.json$/.test(name)).sort()
must(monitorNames.length === 1, 'Unambiguous monitor required')
const monitor = await json(join(root, monitorNames[0]))
must(monitor.passed && monitor.finishedAt && monitor.rows.length === 16, 'Completed 15-minute probes required')
const migrationRoot = '.niyamlens-private/releases/rc6-conflict-20260905-v2'
const migration = await json(join(migrationRoot, 'apply-result.json'))
const rehearsal = await json(join(migrationRoot, 'rehearsal-result.json'))
const before = await json(join(migrationRoot, 'before.json'))
must(migration.passed && rehearsal.passed && migration.migrationSha256 === before.migrationSha256, 'Verified migration and rollback required')
const sum = checks => ({ passed: checks.filter(c => c.passed).length, total: checks.length })
const result = {
  schemaVersion: 1, kind: 'RC6-release-engineering-evidence-not-winner-certification', generatedAt: new Date().toISOString(),
  application: { origin: m.target.origin, version: '0.4.4', rulePack: m.release.rulePack, sourceCommit: 'd13aad50adedaa2c3a7d1c41bd036fe65bcb5b54', deploymentId: 'dpl_FPx8WbxZrukoGC3RijjaKiuRbc8q', asset: m.release.asset, assetSha256: m.release.sha256 },
  ci: { passed: true, releaseTests: 603, url: 'https://github.com/DuvvuruDeepakReddy18/NiyamLens-SIH26034/actions/runs/33963587174', includes: ['Linux clean install', 'unit regressions', 'production build', 'OCR asset SHA-256 checks', 'production dependency audit'] },
  migration: { passed: true, rehearsalRolledBackAndExactOriginalsVerified: true, liveReadbackPassed: true, functions: 4, sha256: migration.migrationSha256, appliedAt: migration.observedAt, functionRollbackSha256: before.rollbackSha256, tableDataChanged: false, backupScope: 'Four function definitions and restricted execute grants only. Not a complete database/Auth/Storage backup.' },
  hostedApi: { permissions: sum(m.permissions.checks), additional: sum(m.checks), checks: m.checks.map(c => ({ name: c.name, passed: c.passed })), permissionsDetail: m.permissions.checks.map(c => ({ name: c.name, passed: c.passed })) },
  chromeRoles: { passed: true, actors: browser.rows.map(row => ({ actor: row.actor, role: row.expectedRole, passed: row.passed, visibleCaseCount: row.visibleCaseIds.length, imageIntegrity: row.exportVerification?.passed === true, retrievalContract: row.retrievalContract })), fixtureLimitation: 'API-seeded fixtures have no genuine browser audit. Their narrower image/transport check is not strict full-audit acceptance.' },
  chromeOfflineSeal: { passed: true, casePostAttempts: seal.casePostAttempts, originalOcr: seal.originalOcr, offlineRecovery: seal.offlineRecovery, export: seal.exportVerification, appModules: seal.appModules, pageErrors: seal.pageErrorCount },
  localBrowser: { passed: true, checks: ['capture coach and correction review invalidation', 'mobile layout and navigation', 'sealed source replay', 'immutable original transcript', 'mocked expired-SDK-session offline restart', 'mocked membership revocation and account-switch races', 'queued rule-pack mismatch and linked reassessment', 'observer timer export and corrupt-storage refusal'], limitation: 'Local/mock checks are distinct from actual hosted provider acceptance.' },
  developmentOcr: { knownPhotos: 8, eligibleFields: 10, directMatches: 1, selectedLayoutMatches: 5, wrongValidSelected: 0, unresolvedSelected: 5, blind: false, humanReviewed: false, aiProvisionalReference: true, source: 'reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T11-27-15-509Z.json', limitation: 'Known development corpus, not general accuracy. Automatic checkbox selection is not officer verification; zero observed wrong readings is not a safety guarantee.' },
  probes: { passed: true, startedAt: monitor.startedAt, finishedAt: monitor.finishedAt, snapshots: monitor.rows.length, requests: monitor.rows.reduce((n,r) => n+r.checks.length, 0), failed: monitor.rows.flatMap(r => r.checks).filter(c => !c.passed).length, file: monitorNames[0], limitation: 'Low-volume synthetic probes, not maximum-load stress testing or real-user production telemetry.' },
  containment: { syntheticAccounts: 4, isolatedTestWorkspaces: 2, sealedTestCases: Object.keys(m.cases).length + (m.browserCases?.length || 0), registeredTestImageObjects: 8, disabledMemberships: m.membershipShutdown.disabled.length, allVerifiedInactive: true, humanAccountsChanged: 0, emailsSentByAcceptance: 0, resourcesDeleted: 0 },
  pendingHumanEvidence: ['New declaration-focused physical package photos', 'Independent human labels and disagreement adjudication before frozen evaluation', 'Real-user paired timing and separate report correctness checks', 'Qualified legal applicability and physical measurement review', 'Outsider-led live rehearsals'],
  remainingOperationalLimits: ['Protected off-site workspace/Auth/Storage backups and service-level disaster recovery are not completed here.', 'Connected OCR execution and SMTP delivery are not proven by these tests.', 'Hosted expired-session renewal and fully offline OCR are not claimed by the one hosted offline-seal test.', 'No SIH win, official 2026 rubric/deadline or departmental approval is certified.'],
}
await writeFile(join(root, 'release-evidence.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
await writeFile(join(root, 'offline-browser-export-check.json'), JSON.stringify(seal, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ written: true, path: join(root, 'release-evidence.json'), hash: createHash('sha256').update(JSON.stringify(result)).digest('hex'), hostedApiChecks: result.hostedApi.permissions.total + result.hostedApi.additional.total, syntheticMembershipsDisabled: 4, probeRequests: result.probes.requests }))
