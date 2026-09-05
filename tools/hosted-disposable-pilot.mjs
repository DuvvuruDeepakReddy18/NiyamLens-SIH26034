import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { verifyHostedPermissions } from './verify-hosted-permissions.mjs'

export const TARGET = Object.freeze({ projectRef: 'sivqthnclblqtqshexgx', origin: 'https://niyamlens-sih26034.vercel.app', storageOrigin: 'https://sivqthnclblqtqshexgx.supabase.co' })
export const ACTORS = Object.freeze(['officerA', 'officerB', 'supervisor', 'otherOrg'])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const fail = (code) => { throw Object.assign(new Error(code), { code }) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sdkOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45000) }) } }

export function validateConsent(args) {
  if (!args.run || args.origin !== TARGET.origin || args.projectRef !== TARGET.projectRef) fail('EXACT_TARGET_CONSENT_REQUIRED')
}
export function newManifest(runId = randomUUID()) {
  if (!UUID.test(runId)) fail('INVALID_RUN_ID')
  const prefix = `NiyamLens hosted synthetic ${runId}`
  return { schemaVersion: 1, kind: 'synthetic-hosted-integration-not-human-pilot', runId, target: TARGET,
    createdAt: new Date().toISOString(), status: 'planned',
    organizations: { primary: { id: randomUUID(), name: `${prefix} pilot`, created: false }, other: { id: randomUUID(), name: `${prefix} control`, created: false } },
    accounts: Object.fromEntries(ACTORS.map(actor => [actor, { email: `niyamlens-${runId}-${actor.toLowerCase()}@example.invalid`, role: actor === 'supervisor' ? 'supervisor' : 'officer', org: actor === 'otherOrg' ? 'other' : 'primary', id: null }])),
    cases: {}, assignments: [], checks: [],
    cleanupPlan: 'Retain marked test records for review. First disable only the four exact manifest memberships after testing. Physical removal requires separate reviewed cleanup: verify each Auth app_metadata run ID and both organization names/IDs; remove only exact manifest Storage paths, then scoped reviews/assignments/evidence/cases/audit/counters/memberships/organizations and exact synthetic Auth users. Never reset the database, alter real users, or delete unrelated paths.',
    limitations: ['Synthetic identities and generated marked images are infrastructure tests, not a human field pilot, OCR benchmark, or legal assessment.', 'No invitations, recovery emails, public-signup change, real-user role or password changes.', 'Connected OCR is unconfigured on this release and returns 503 before authorization; provider execution and OCR-route membership revocation are not proven by this run.'] }
}
export function validateManifest(m) {
  if (m?.kind !== 'synthetic-hosted-integration-not-human-pilot' || !UUID.test(m.runId || '') || m.target?.origin !== TARGET.origin || m.target?.projectRef !== TARGET.projectRef || m.target?.storageOrigin !== TARGET.storageOrigin) fail('UNSAFE_MANIFEST')
  const ids = new Set()
  for (const [name, org] of Object.entries(m.organizations || {})) {
    if (!['primary', 'other'].includes(name) || !UUID.test(org.id || '') || org.name !== `NiyamLens hosted synthetic ${m.runId} ${name === 'primary' ? 'pilot' : 'control'}` || ids.has(org.id)) fail('UNSAFE_ORGANIZATION')
    ids.add(org.id)
  }
  if (ids.size !== 2 || Object.keys(m.accounts || {}).length !== 4) fail('WRONG_FIXTURE_CARDINALITY')
  for (const actor of ACTORS) {
    const account = m.accounts[actor]
    if (!account || account.email !== `niyamlens-${m.runId}-${actor.toLowerCase()}@example.invalid` || account.role !== (actor === 'supervisor' ? 'supervisor' : 'officer') || account.org !== (actor === 'otherOrg' ? 'other' : 'primary') || (account.id !== null && (!UUID.test(account.id) || ids.has(account.id)))) fail('UNSAFE_ACCOUNT')
    if (account.id) ids.add(account.id)
  }
  return m
}
export function assertSyntheticUser(user, account, runId) {
  if (!user || user.id !== account.id || user.email !== account.email || user.app_metadata?.niyamlens_pilot_run !== runId || user.app_metadata?.synthetic_only !== true) fail('SYNTHETIC_IDENTITY_MISMATCH')
}
export async function projectCredentials() {
  // Official CLI owns login and refresh. Capture all provider values in process;
  // neither stdout nor raw CLI error objects may reach reports or tool output.
  const run = promisify(execFile)
  const cli = resolve('node_modules/supabase/dist/supabase.js')
  let projects, keys
  try {
    projects = JSON.parse((await run(process.execPath, [cli, 'projects', 'list', '--output', 'json'], { timeout: 45000, maxBuffer: 250000 })).stdout)
    const target = projects.find(p => (p.ref || p.id) === TARGET.projectRef)
    if (target?.name !== 'NiyamLens-SIH26034' || target.status !== 'ACTIVE_HEALTHY') fail('INTENDED_PROJECT_NOT_HEALTHY')
    keys = JSON.parse((await run(process.execPath, [cli, 'projects', 'api-keys', '--project-ref', TARGET.projectRef, '--reveal', '--output', 'json'], { timeout: 45000, maxBuffer: 100000 })).stdout)
  } catch { fail('AUTHORIZED_CLI_PROJECT_ACCESS_FAILED') }
  const publicKey = keys.find(k => k.type === 'publishable')?.api_key || keys.find(k => k.name === 'anon')?.api_key
  const serverKey = keys.find(k => k.type === 'secret')?.api_key || keys.find(k => k.name === 'service_role')?.api_key
  if (!publicKey || !serverKey) fail('PROJECT_KEYS_UNAVAILABLE')
  return { publicKey, serverKey }
}
export async function deployedRelease() {
  const response = await fetch(TARGET.origin, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) })
  if (!response.ok) fail('PUBLIC_APP_UNAVAILABLE')
  const html = await response.text()
  const asset = html.match(/<script\b[^>]*\bsrc="(\/assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1]
  if (!asset) fail('BUILD_ASSET_NOT_IDENTIFIED')
  const r = await fetch(TARGET.origin + asset, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!r.ok) fail('BUILD_ASSET_UNAVAILABLE')
  const bytes = Buffer.from(await r.arrayBuffer())
  if (bytes.length > 3000000) fail('BUILD_ASSET_TOO_LARGE')
  const packs = [...new Set(bytes.toString().match(/LMPC-RC-2026\.09-RC\d+/g) || [])]
  if (packs.length !== 1) fail('DEPLOYED_RULE_PACK_AMBIGUOUS')
  return { asset, sha256: hash(bytes), rulePack: packs[0], observedAt: new Date().toISOString(), note: 'Current publicly deployed release only; not a claim that unshipped local changes passed hosted testing.' }
}

export async function runPilot(consent, { privateRoot = resolve('.niyamlens-private/team-pilot') } = {}) {
  validateConsent(consent)
  const root = resolve('.niyamlens-private/team-pilot')
  if (resolve(privateRoot) !== root) fail('PRIVATE_OUTPUT_ROOT_REQUIRED')
  if (consent.resume && !UUID.test(consent.resume)) fail('INVALID_RESUME_RUN')
  const directory = join(privateRoot, `hosted-${consent.resume || randomUUID()}`)
  const m = consent.resume ? JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) : newManifest(directory.slice(-36))
  validateManifest(m)
  if (consent.resume && (m.runId !== consent.resume || Object.values(m.organizations).some(o => !o.created) || Object.values(m.accounts).some(a => !a.id || !a.membershipCreated))) fail('RESUME_REQUIRES_COMPLETE_IDENTITIES')
  const ignored = await promisify(execFile)('git', ['check-ignore', '--quiet', '.niyamlens-private/team-pilot/hosted-probe-placeholder'], { cwd: process.cwd() }).then(() => true, () => false)
  if (!ignored) fail('PRIVATE_OUTPUT_NOT_GIT_IGNORED')
  if (!consent.resume) await mkdir(directory, { recursive: false })
  const save = () => writeFile(join(directory, 'manifest.json'), JSON.stringify(m, null, 2), { mode: 0o600 })
  await save()
  const secrets = consent.resume ? JSON.parse(await readFile(join(directory, 'synthetic-credentials.json'), 'utf8')) : { syntheticOnly: true, runId: m.runId, accounts: {} }
  if (!secrets.syntheticOnly || secrets.runId !== m.runId) fail('WRONG_SYNTHETIC_CREDENTIAL_FILE')
  const check = async (name, operation) => {
    try { await operation(); m.checks.push({ name, passed: true }) }
    catch (error) { m.checks.push({ name, passed: false, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'CHECK_FAILED' }); await save(); throw error }
    await save()
  }
  const must = (value, code) => { if (!value) fail(code) }
  const checked = async (query, code) => { const r = await query; if (r.error) fail(code); return r.data }
  let admin
  try {
    const observedRelease = await deployedRelease()
    if (consent.resume && observedRelease.sha256 !== m.release?.sha256) fail('DEPLOYED_RELEASE_CHANGED_STOP_RESUME')
    m.release = observedRelease
    const keys = await projectCredentials()
    admin = createClient(TARGET.storageOrigin, keys.serverKey, sdkOptions)
    if (consent.resume) {
      // Resume is never a reprovision or password reset. Before any mutation,
      // independently verify all four exact synthetic identities and org names.
      for (const org of Object.values(m.organizations)) {
        const row = await checked(admin.from('organizations').select('id,name').eq('id', org.id).single(), 'RESUME_ORG_NOT_FOUND')
        must(row.name === org.name, 'RESUME_ORG_CHANGED')
      }
      for (const actor of ACTORS) {
        const account = m.accounts[actor]
        const data = await checked(admin.auth.admin.getUserById(account.id), 'RESUME_USER_NOT_FOUND')
        assertSyntheticUser(data.user, account, m.runId)
        must(secrets.accounts[actor]?.email === account.email, 'RESUME_CREDENTIAL_ACCOUNT_MISMATCH')
        const memberships = await checked(admin.from('memberships').select('org_id,role,active').eq('user_id', account.id), 'RESUME_MEMBERSHIP_LOOKUP_FAILED')
        must(memberships.length === 1 && memberships[0].org_id === m.organizations[account.org].id && memberships[0].role === account.role && memberships[0].active, 'RESUME_MEMBERSHIP_CHANGED')
      }
      m.attempts = [...(m.attempts || []), { previousStatus: m.status, previousFailure: m.failureCode, resumedAt: new Date().toISOString() }]
    }
    m.status = 'provisioning'; await save()
    for (const [name, organization] of Object.entries(m.organizations)) {
      if (consent.resume) continue
      await checked(admin.from('organizations').insert({ id: organization.id, name: organization.name }), 'ORG_INSERT_FAILED')
      organization.created = true; await save()
    }
    for (const actor of ACTORS) {
      if (consent.resume) continue
      const account = m.accounts[actor]
      const password = randomBytes(32).toString('base64url') + 'aA1!'
      secrets.accounts[actor] = { email: account.email, password }
      // This ignored file contains only disposable test passwords, never admin
      // keys or human credentials. It supports independently authenticated UI QA.
      await writeFile(join(directory, 'synthetic-credentials.json'), JSON.stringify(secrets), { mode: 0o600 })
      account.creationRequestedAt = new Date().toISOString(); await save()
      const created = await checked(admin.auth.admin.createUser({ email: account.email, password, email_confirm: true,
        app_metadata: { niyamlens_pilot_run: m.runId, synthetic_only: true }, user_metadata: { display_name: `HOSTED TEST ONLY ${actor}` } }), 'SYNTHETIC_USER_CREATE_FAILED')
      account.id = created.user?.id; assertSyntheticUser(created.user, account, m.runId); await save()
      await checked(admin.from('memberships').insert({ org_id: m.organizations[account.org].id, user_id: account.id, role: account.role, active: true, display_name: `HOSTED TEST ONLY ${actor}` }), 'MEMBERSHIP_INSERT_FAILED')
      account.membershipCreated = true; await save()
    }
    const clients = {}, tokens = {}
    for (const actor of ACTORS) {
      clients[actor] = createClient(TARGET.storageOrigin, keys.publicKey, sdkOptions)
      await check(`${actor}:real-password-sign-in`, async () => {
        const data = await checked(clients[actor].auth.signInWithPassword(secrets.accounts[actor]), 'SYNTHETIC_SIGNIN_FAILED')
        must(data.user?.id === m.accounts[actor].id && data.session?.access_token, 'SIGNIN_IDENTITY_MISMATCH')
        tokens[actor] = data.session.access_token
      })
    }
    const request = async (actor, route, method = 'GET', body, expected = 200, orgOverride) => {
      if (!/^\/(cases|evidence|reviews|assignments|ocr)(\?|$)/.test(route)) fail('UNAPPROVED_APP_ROUTE')
      const r = await fetch(`${TARGET.origin}/api${route}`, { method, headers: { Authorization: `Bearer ${tokens[actor]}`, 'X-Workspace-Id': orgOverride || m.organizations[m.accounts[actor].org].id, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000) })
      const b = await r.json().catch(() => ({}))
      if (r.status !== expected) fail(`HTTP_${r.status}_EXPECTED_${expected}`)
      must(r.headers.get('cache-control')?.includes('no-store'), 'PRIVATE_RESPONSE_CACHEABLE')
      return b
    }
    const bytes = consent.resume ? await readFile(join(directory, 'synthetic-test-only.png')) : await sharp(Buffer.from('<svg width="640" height="240" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="240" fill="white"/><text x="20" y="60" font-size="28" fill="black">NIYAMLENS HOSTED TEST ONLY</text><text x="20" y="115" font-size="19" fill="black">Synthetic infrastructure fixture. Not a product.</text><text x="20" y="165" font-size="19" fill="black">No OCR or legal accuracy claim.</text></svg>')).png().toBuffer()
    const digest = hash(bytes)
    await writeFile(join(directory, 'synthetic-test-only.png'), bytes)
    for (const actor of ['officerA', 'officerB', 'otherOrg']) {
      const freshRecord = { id: `hosted-${m.runId}-${actor}`, rulePack: m.release.rulePack, createdAt: new Date().toISOString(), sealedAt: new Date().toISOString(), meta: { productName: 'HOSTED SYNTHETIC INFRASTRUCTURE TEST ONLY', packageRef: `Run ${m.runId}; ${actor}; not a product inspection`, category: 'general', enforceEvidenceReview: true, allPanelsCaptured: false }, text: 'HOSTED INTEGRATION TEST ONLY. Not a product inspection; no OCR was run.', rawOcrText: '', auditChain: [], evidenceItems: [] }
      const record = consent.resume ? await readFile(join(directory, `${actor}-submitted-case.json`), 'utf8').then(JSON.parse, () => freshRecord) : freshRecord
      must(record.rulePack === m.release.rulePack && record.id === freshRecord.id, 'RESUME_CASE_IDENTITY_CHANGED')
      const panel = record.evidenceItems[0] || { id: m.cases[actor]?.panelId || randomUUID(), name: 'synthetic-test-only.png', panelRole: 'other', sha256: digest, capturedAt: new Date().toISOString() }
      if (m.cases[actor]) must(m.cases[actor].sha256 === digest, 'RESUME_IMAGE_DIGEST_CHANGED')
      m.cases[actor] ||= { id: record.id, panelId: panel.id, sha256: digest }; await save()
      for (const kind of ['original', 'analysis']) {
        await check(`${actor}:${kind}:real-private-upload-and-registration`, async () => {
          const descriptor = { caseId: record.id, panelId: panel.id, kind, sha256: digest, bytes: bytes.length, mime: 'image/png' }
          if (consent.resume && m.cases[actor][`${kind}Path`]) {
            // An explicit operator/test recovery, NOT evidence that the app's
            // failed automatic prepare retry worked. Preserve the failed check.
            await request(actor, '/evidence', 'POST', { ...descriptor, action: 'verify' })
            m.interventions = [...(m.interventions || []), { actor, kind, action: 'explicit-verify-existing-exact-test-file', at: new Date().toISOString() }]
            await save()
          }
          const prepared = await request(actor, '/evidence', 'POST', { ...descriptor, action: 'prepare' })
          const expectedPath = `${m.organizations[m.accounts[actor].org].id}/${m.accounts[actor].id}/${record.id}/${panel.id}/${kind}-${digest}`
          must(prepared.path === expectedPath, 'WRONG_PREPARED_PATH')
          if (prepared.verified === true) { panel[`${kind}Path`] = expectedPath; return }
          const signed = new URL(prepared.uploadUrl)
          must(signed.origin === TARGET.storageOrigin && decodeURIComponent(signed.pathname) === `/storage/v1/object/upload/sign/evidence/${expectedPath}`, 'UNEXPECTED_SIGNED_UPLOAD_ORIGIN')
          m.cases[actor][`${kind}Path`] = expectedPath; await save()
          const uploaded = await fetch(signed, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' }, redirect: 'error', signal: AbortSignal.timeout(45000) })
          must(uploaded.ok, 'SIGNED_STORAGE_UPLOAD_FAILED')
          // Repeat prepare before verification: actual bytes already exist, but
          // caller deliberately discarded the first success acknowledgement.
          if (actor === 'officerA' && kind === 'original') {
            const retry = await request(actor, '/evidence', 'POST', { ...descriptor, action: 'prepare' })
            must(retry.path === expectedPath && retry.verified === true && !retry.uploadUrl, 'LOST_ACK_RETRY_DID_NOT_VERIFY_EXISTING_BYTES')
            const again = await request(actor, '/evidence', 'POST', { ...descriptor, action: 'prepare' })
            must(again.path === expectedPath && again.verified === true && !again.uploadUrl, 'RECOVERED_PREPARE_NOT_IDEMPOTENT')
          }
          const verified = await request(actor, '/evidence', 'POST', { ...descriptor, action: 'verify' })
          must(verified.verified === true && verified.path === expectedPath, 'UPLOAD_NOT_VERIFIED')
          panel[`${kind}Path`] = expectedPath
        })
      }
      record.evidenceItems = [panel]
      await writeFile(join(directory, `${actor}-submitted-case.json`), JSON.stringify(record, null, 2))
      await check(`${actor}:real-server-seal-and-exact-retry`, async () => {
        const first = await request(actor, '/cases', 'POST', { record })
        must(first.record?.id === record.id && first.record.rulePack === m.release.rulePack && first.record.serverVersion === 1 && first.record.syncState === 'synced', 'INVALID_SERVER_RECEIPT')
        const retry = await request(actor, '/cases', 'POST', { record })
        must(retry.record?.serverVersion === 1 && retry.record.serverPayloadHash === first.record.serverPayloadHash, 'SEAL_RETRY_NOT_IDEMPOTENT')
        m.cases[actor].serverPayloadHash = first.record.serverPayloadHash
        m.cases[actor].serverVersion = first.record.serverVersion
      })
    }
    const config = { origin: TARGET.origin, storageOrigin: TARGET.storageOrigin, workspaces: { primary: m.organizations.primary.id, other: m.organizations.other.id }, cases: m.cases }
    await writeFile(join(directory, 'config.json'), JSON.stringify(config, null, 2))
    m.permissions = await verifyHostedPermissions(config, { enabled: true, allowOrigin: TARGET.origin, tokens })
    await save()
    if (!m.permissions.passed) fail('HOSTED_PERMISSION_MATRIX_FAILED')
    for (const actor of ['officerA', 'officerB', 'otherOrg']) {
      for (const kind of ['original', 'analysis']) await check(`${actor}:${kind}:signed-download-byte-hash`, async () => {
        const fixture = m.cases[actor]
        const link = await request(actor, `/evidence?${new URLSearchParams({ caseId: fixture.id, path: fixture[`${kind}Path`] })}`)
        const url = new URL(link.url)
        must(url.origin === TARGET.storageOrigin && decodeURIComponent(url.pathname) === `/storage/v1/object/sign/evidence/${fixture[`${kind}Path`]}`, 'WRONG_DOWNLOAD_URL')
        const image = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
        const downloaded = Buffer.from(await image.arrayBuffer())
        must(image.ok && downloaded.length === bytes.length && hash(downloaded) === digest, 'DOWNLOADED_IMAGE_HASH_MISMATCH')
      })
    }
    for (const actor of ACTORS) await check(`${actor}:case-list-isolation`, async () => {
      const result = await request(actor, '/cases')
      const expected = actor === 'supervisor' ? [m.cases.officerA.id, m.cases.officerB.id] : [m.cases[actor].id]
      must(Array.isArray(result.records) && result.records.length === expected.length && result.records.every(c => expected.includes(c.id)), 'CASE_LIST_SCOPE_MISMATCH')
    })
    const review = { caseId: m.cases.officerA.id, operationId: randomUUID(), baseVersion: 1, status: 'manual_review', reason: 'HOSTED SYNTHETIC TEST: no product inspection or legal conclusion was performed.' }
    await check('review:officer-denied', () => request('officerA', '/reviews', 'POST', review, 403))
    await check('review:supervisor-commit-identical-retry-and-stale-conflict', async () => {
      const first = await request('supervisor', '/reviews', 'POST', review)
      must(first.record?.serverVersion === 2 && first.record.reviewHistory?.length === 1, 'REVIEW_RECEIPT_INVALID')
      const again = await request('supervisor', '/reviews', 'POST', review)
      must(again.record?.serverVersion === 2 && again.record.reviewHistory?.length === 1, 'DUPLICATE_REVIEW')
      await request('supervisor', '/reviews', 'POST', { ...review, operationId: randomUUID(), reason: review.reason + ' stale attempt' }, 409)
      await request('supervisor', '/reviews', 'POST', { ...review, reason: review.reason + ' altered replay' }, 409)
      const unchanged = await request('supervisor', `/cases?id=${encodeURIComponent(review.caseId)}`)
      must(unchanged.record?.serverVersion === 2 && unchanged.record.reviewHistory?.length === 1, 'STALE_REVIEW_CHANGED_RECORDED_STATE')
    })
    const assignment = { id: randomUUID(), officerId: m.accounts.officerA.id, packageRef: `HOSTED SYNTHETIC TEST ${m.runId}` }
    m.assignments.push(assignment.id); await save()
    await check('assignment:create-retry-scope-and-version-conflict', async () => {
      await request('supervisor', '/assignments', 'POST', assignment)
      await request('supervisor', '/assignments', 'POST', assignment)
      await request('supervisor', '/assignments', 'POST', { ...assignment, packageRef: assignment.packageRef + ' changed replay' }, 409)
      for (const actor of ACTORS) {
        const list = await request(actor, '/assignments')
        const allowed = ['officerA', 'supervisor'].includes(actor)
        must(list.assignments?.length === (allowed ? 1 : 0), 'ASSIGNMENT_LIST_SCOPE_MISMATCH')
      }
      await request('officerB', '/assignments', 'PATCH', { id: assignment.id, version: 1, status: 'in_progress' }, 403)
      await request('officerA', '/assignments', 'PATCH', { id: assignment.id, version: 1, status: 'in_progress' })
      await request('officerA', '/assignments', 'PATCH', { id: assignment.id, version: 1, status: 'submitted' }, 409)
      await request('officerA', '/assignments', 'PATCH', { id: assignment.id, version: 2, status: 'closed' }, 403)
      const unchanged = await request('officerA', '/assignments')
      must(unchanged.assignments?.length === 1 && unchanged.assignments[0].version === 2 && unchanged.assignments[0].status === 'in_progress', 'STALE_ASSIGNMENT_CHANGED_RECORDED_STATE')
    })
    await check('suspension:old-token-rejected-and-exact-membership-restored', async () => {
      const account = m.accounts.officerA
      const user = await checked(admin.auth.admin.getUserById(account.id), 'SYNTHETIC_USER_LOOKUP_FAILED')
      assertSyntheticUser(user.user, account, m.runId)
      const org = m.organizations.primary.id
      await checked(admin.from('memberships').update({ active: false }).eq('org_id', org).eq('user_id', account.id).eq('role', 'officer').select('user_id').single(), 'SYNTHETIC_SUSPEND_FAILED')
      account.temporarilySuspended = true; await save()
      try {
        await request('officerA', '/cases', 'GET', null, 403)
        await request('officerA', '/assignments', 'GET', null, 403)
        await request('officerA', '/evidence', 'POST', {}, 403)
        await request('officerA', '/cases', 'POST', {}, 403)
      } finally {
        await checked(admin.from('memberships').update({ active: true }).eq('org_id', org).eq('user_id', account.id).eq('role', 'officer').select('user_id').single(), 'SYNTHETIC_RESTORE_FAILED')
        account.temporarilySuspended = false; await save()
      }
      await request('officerA', `/cases?id=${encodeURIComponent(m.cases.officerA.id)}`)
    })
    const passed = m.checks.every(c => c.passed) && m.permissions.passed
    m.status = passed ? 'passed' : 'completed-with-failures'; m.completedAt = new Date().toISOString(); await save()
    return { passed, completed: true, runId: m.runId, directory, deployedRulePack: m.release.rulePack, permissionChecks: m.permissions.checks.length, permissionsPassed: m.permissions.passed, additionalChecks: m.checks.length, failedChecks: m.checks.filter(c => !c.passed), retained: 'Four synthetic accounts, two isolated organizations, three marked test cases and six private image objects retained for review; no cleanup performed.' }
  } catch (error) {
    m.status = 'failed'; m.failureCode = /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'PILOT_RUN_FAILED'; await save()
    return { passed: false, runId: m.runId, directory, code: m.failureCode, completedChecks: m.checks.length, retained: 'Any exact-created synthetic resources are recorded in the private manifest; inspect it before retry or cleanup. No automatic deletion.' }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const allowed = new Set(['--run', '--allow-origin', '--project-ref', '--resume'])
  const consent = { run: false }
  try {
    for (let i = 0; i < args.length; i++) {
      if (!allowed.has(args[i])) fail('INVALID_ARGUMENTS')
      if (args[i] === '--run') consent.run = true
      else { const key = args[i]; const value = args[++i]; if (!value || value.startsWith('--')) fail('INVALID_ARGUMENTS'); consent[key === '--allow-origin' ? 'origin' : key === '--resume' ? 'resume' : 'projectRef'] = value }
    }
    const result = await runPilot(consent); console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1
  } catch (error) { console.log(JSON.stringify({ passed: false, blocked: true, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'PILOT_NOT_STARTED' })); process.exitCode = 2 }
}
