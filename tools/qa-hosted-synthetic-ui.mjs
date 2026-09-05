import assert from 'node:assert/strict'
import { readFile, mkdir, open, realpath } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { readPilotConfig, validatePilotConfig } from './verify-hosted-permissions.mjs'
import { verifyCloudExport } from './verify-cloud-export.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
if (args.length !== 5 || args[0] !== '--run' || args[1] !== '--run-dir' || args[3] !== '--allow-origin') throw new Error('Use --run --run-dir EXISTING-PRIVATE-SYNTHETIC-RUN --allow-origin EXACT-HTTPS-ORIGIN after provisioning-agent coordination.')
const privateRoot = await realpath(resolve(root, '.niyamlens-private/team-pilot'))
const runDirectory = await realpath(resolve(args[2]))
const child = relative(privateRoot, runDirectory)
if (!/^hosted-[a-f0-9-]{36}$/.test(child)) throw new Error('Only one existing synthetic team-pilot run directory is accepted.')
const config = validatePilotConfig(await readPilotConfig(resolve(runDirectory, 'config.json')))
if (config.origin !== args[4]) throw new Error('The hosted origin must be explicitly approved.')
const readPrivateJson = async filename => { try { return JSON.parse(await readFile(resolve(runDirectory, filename))) } catch { throw new Error('PRIVATE_SYNTHETIC_CONFIG_UNAVAILABLE') } }
const manifest = await readPrivateJson('manifest.json')
// Generated passwords remain process-local and are never logged, put in a
// report, sent through tool arguments, or reused for a real user account.
const credentials = await readPrivateJson('synthetic-credentials.json')
const actors = ['officerA', 'officerB', 'supervisor', 'otherOrg']
if (credentials.syntheticOnly !== true || credentials.runId !== manifest.runId || actors.some(name => credentials.accounts?.[name]?.email !== manifest.accounts?.[name]?.email || typeof credentials.accounts[name].password !== 'string')) throw new Error('Existing synthetic credential identity mismatch.')
const sourceOriginalBytes = await readFile(resolve(runDirectory, 'synthetic-test-only.png'))
const digest = value => createHash('sha256').update(value).digest('hex')
function verifyFixtureImages(record, fixture) {
  assert.equal(record.evidenceItems.length, 1)
  const panel = record.evidenceItems[0]; const images = []
  for (const kind of ['original', 'analysis']) {
    assert.equal(panel[`${kind}Path`], fixture[`${kind}Path`])
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(panel[`${kind}Url`])
    assert.ok(match)
    const bytes = Buffer.from(match[1], 'base64')
    assert.equal(bytes.toString('base64'), match[1])
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    const sha256 = digest(bytes)
    assert.equal(sha256, fixture[`${kind}Path`].split('-').at(-1))
    if (kind === 'original') { assert.equal(sha256, panel.sha256); assert.equal(sha256, digest(sourceOriginalBytes)) }
    images.push({ kind, bytes: bytes.length, sha256, registeredPathMatched: true })
  }
  return { passed: true, scope: 'actual-portable-synthetic-image-retrieval-and-integrity-only', panels: 1, images, sourceOriginalMatched: true }
}
const startedAt = new Date().toISOString()
const directory = resolve(root, 'reports/readiness-2026-09-05'); await mkdir(directory, { recursive: true })
const outputPath = resolve(directory, `hosted-synthetic-browser-${startedAt.replace(/[:.]/g, '-')}.json`)
const file = await open(outputPath, 'wx')
const report = { schemaVersion: 1, kind: 'actual-hosted-Chrome-existing-synthetic-accounts', startedAt, finishedAt: null, target: config.origin, runId: manifest.runId, source: 'Four pre-existing synthetic test identities and existing synthetic cases, not teammates or human field-study participants.', execution: { status: 'running', plannedActors: 4, authThroughUi: true, mockedResponses: false, writesPermitted: 'Password sign-in and local-scope sign-out only. No cases, evidence, assignments, reviews, memberships or accounts are created or modified.' }, appModules: [], rows: [], limitations: ['Synthetic role and retrieval acceptance only; not a human user study or field-effectiveness result.', 'No SMTP or email-delivery claim; these accounts use administrator-provisioned generated test passwords.', 'Cloud image retrieval/export checks integrity and current authorization, not truth of photographed declarations or official legal approval.', 'An exported receipt is structurally checked, not independently signed or authenticated by this browser test.'] }
const checkpoint = async () => { await file.truncate(0); await file.write(`${JSON.stringify(report, null, 2)}\n`, 0, 'utf8'); await file.sync() }
const safeStage = error => /^[A-Z][A-Z0-9_]{2,100}$/.test(error?.message || '') ? error.message : 'UI_ACCEPTANCE_CHECK_FAILED'
let browser
try {
  await checkpoint(); browser = await launchTestBrowser()
  for (const name of actors) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
    const row = { actor: name, expectedRole: manifest.accounts[name].role, stage: 'created', passed: false, reason: null, pageErrorCount: 0, blockedRequests: [], apiReads: [], visibleCaseIds: [], exportVerification: null }
    const bodyReads = []; const lists = []; const details = []
    await context.route('**/*', route => {
      const request = route.request(); const url = new URL(request.url()); const method = request.method()
      const approvedOrigin = [config.origin, config.storageOrigin].includes(url.origin)
      const authWrite = url.origin === config.storageOrigin && method === 'POST' && ['/auth/v1/token', '/auth/v1/logout'].includes(url.pathname)
      if (!approvedOrigin || !['GET', 'HEAD', 'OPTIONS'].includes(method) && !authWrite) {
        row.blockedRequests.push({ origin: url.origin, path: url.pathname, method }); return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', () => { row.pageErrorCount += 1 })
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.origin !== config.origin || !url.pathname.startsWith('/api/')) return
      row.apiReads.push({ path: url.pathname, method: response.request().method(), status: response.status() })
      if (url.pathname !== '/api/cases' || response.status() !== 200 || response.request().method() !== 'GET') return
      bodyReads.push(response.json().then(body => {
        if (Array.isArray(body.records)) lists.push(body.records.map(record => ({ id: record.id, recordKind: record.recordKind || 'legacy-full-record', version: record.serverVersion, complete: typeof record.text === 'string' && Array.isArray(record.evidenceItems) && record.evidenceItems.length > 0 })))
        if (body.record) details.push({ id: body.record.id, version: body.record.serverVersion })
      }).catch(() => {}))
    })
    const before = performance.now()
    try {
      row.stage = 'sign-in'
      await page.goto(`${config.origin}/`, { waitUntil: 'networkidle', timeout: 60000 })
      const moduleSrc = await page.locator('script[type="module"][src]').first().getAttribute('src')
      const moduleUrl = new URL(moduleSrc, config.origin)
      assert.equal(moduleUrl.origin, config.origin)
      if (!report.appModules.some(item => item.url === moduleUrl.href)) {
        const response = await context.request.get(moduleUrl.href)
        const bytes = await response.body()
        report.appModules.push({ url: moduleUrl.href, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
      }
      await page.getByLabel('Email', { exact: true }).fill(credentials.accounts[name].email)
      await page.getByLabel('Password', { exact: true }).fill(credentials.accounts[name].password)
      await page.getByRole('button', { name: 'Sign in securely', exact: true }).click()
      await page.locator('.workspace-strip').waitFor({ timeout: 90000 })
      const badge = await page.locator('.workspace-strip > b').innerText()
      assert.ok(badge.endsWith(` · ${row.expectedRole}`))
      row.authenticatedRoleMatched = true
      row.stage = 'owned-case-list'
      await page.getByRole('button', { name: 'Officer operations', exact: true }).click()
      await page.getByRole('heading', { name: 'Shared officer operations', exact: true }).waitFor({ timeout: 30000 })
      for (let attempt = 0; attempt < 180 && !lists.length; attempt += 1) await page.waitForTimeout(250)
      await Promise.all(bodyReads)
      assert.ok(lists.length > 0)
      const expectedNames = name === 'supervisor' ? ['officerA', 'officerB'] : [name]
      const expectedIds = expectedNames.map(actor => config.cases[actor].id).sort()
      row.visibleCaseIds = [...new Set(lists.flat().map(record => record.id))].sort()
      assert.deepEqual(row.visibleCaseIds, expectedIds)
      const queue = page.locator('.shared-operations .ops-card').filter({ has: page.getByRole('heading', { name: 'Case review queue', exact: true }) })
      await queue.locator('.shared-row').first().waitFor({ timeout: 30000 })
      assert.equal(await queue.locator('.shared-row').count(), expectedIds.length)
      const reviewer = name === 'supervisor'
      const reviewButtons = queue.getByRole('button', { name: 'Review / override', exact: true })
      for (let index = 0; index < await reviewButtons.count(); index += 1) assert.equal(await reviewButtons.nth(index).isEnabled(), reviewer)
      row.reviewControlMatchesRole = true
      row.stage = 'fresh-cloud-hydration'
      await queue.getByRole('button', { name: 'Evidence', exact: true }).first().click()
      await page.getByText('Officer-supplied timeline — not independently verified', { exact: true }).waitFor({ timeout: 60000 })
      row.stage = 'portable-evidence-export'
      await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
      const link = page.getByRole('link', { name: 'Download with browser', exact: true })
      await link.waitFor({ timeout: 30000 })
      const pendingDownload = page.waitForEvent('download', { timeout: 30000 }); await link.click()
      const download = await pendingDownload; const chunks = []; let bytes = 0
      for await (const chunk of await download.createReadStream()) { bytes += chunk.length; if (bytes > 20000000) throw new Error('SYNTHETIC_EXPORT_TOO_LARGE'); chunks.push(chunk) }
      const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      row.stage = 'verify-export-owner-and-receipt'
      assert.ok(expectedIds.includes(exported.id))
      const fixtureName = expectedNames.find(actor => config.cases[actor].id === exported.id)
      assert.equal(exported.actor.id, manifest.accounts[fixtureName].id)
      await Promise.all(bodyReads)
      const detailGetMatched = details.some(detail => detail.id === exported.id && detail.version === exported.serverVersion)
      const completeFreshListMatched = lists.flat().some(record => record.id === exported.id && record.version === exported.serverVersion && record.complete)
      assert.ok(detailGetMatched || completeFreshListMatched)
      row.exportVerification = verifyFixtureImages(exported, config.cases[fixtureName])
      // API-provisioned fixtures intentionally have no browser seal audit.
      // Preserve the stricter verifier's outcome; do not fabricate an audit or
      // weaken its requirements merely to pass this narrower transport check.
      try { row.fullAuditExportVerification = await verifyCloudExport(exported, { sourceOriginalBytes }) }
      catch (error) { row.fullAuditExportVerification = { passed: false, reason: safeStage(error), fixtureAuditEvents: exported.clientAuditChain?.length ?? null, limitation: 'Existing synthetic API fixture, not a browser-sealed human inspection. Full audit/export acceptance is not established by this fixture.' } }
      row.exportCaseId = exported.id; row.exportBytes = bytes; row.freshDetailGetMatched = detailGetMatched; row.freshCloudRecordMatched = true
      row.retrievalContract = detailGetMatched ? 'on-demand-full-detail-GET' : 'complete-record-in-fresh-cloud-list-legacy-contract'
      row.stage = 'sign-out'
      await page.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: 'Sign out', exact: true }).click()
      await page.getByRole('heading', { name: 'Officer sign in', exact: true }).waitFor({ timeout: 30000 })
      row.signedOut = true
      assert.equal(row.pageErrorCount, 0)
      assert.equal(row.blockedRequests.some(request => request.origin === config.origin && request.method !== 'GET'), false)
      row.stage = 'complete'; row.passed = true
    } catch (error) { row.reason = safeStage(error) }
    finally { row.elapsedMs = Math.round(performance.now() - before); await context.close() }
    report.rows.push(row); await checkpoint()
    console.log(JSON.stringify({ actor: row.actor, stage: row.stage, passed: row.passed, reason: row.reason, visibleCaseCount: row.visibleCaseIds.length, portableImages: row.exportVerification?.images.length || 0 }))
  }
  report.execution.status = 'complete'; report.finishedAt = new Date().toISOString(); report.passed = report.rows.length === 4 && report.rows.every(row => row.passed)
  report.passedScope = 'Hosted role, exact visible synthetic fixture list, fresh case retrieval, downloaded image integrity, and sign-out only.'
  report.fullAuditExportPassed = report.rows.length === 4 && report.rows.every(row => row.fullAuditExportVerification?.passed)
  await checkpoint()
  console.log(JSON.stringify({ outputPath, passed: report.passed, completedActors: report.rows.length, passedActors: report.rows.filter(row => row.passed).length }))
} finally { await browser?.close(); await file.close() }
