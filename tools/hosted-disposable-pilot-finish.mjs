import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { TARGET, ACTORS, validateConsent, validateManifest, assertSyntheticUser, projectCredentials } from './hosted-disposable-pilot.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const must = (v, code) => { if (!v) fail(code) }
async function main() {
  const args = process.argv.slice(2)
  const value = key => args[args.indexOf(key) + 1]
  validateConsent({ run: args.includes('--run'), origin: value('--allow-origin'), projectRef: value('--project-ref') })
  const runId = value('--run-id')
  must(args.length === 7 && args.includes('--run-id') && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId), 'EXACT_RUN_ID_REQUIRED')
  const directory = resolve('.niyamlens-private/team-pilot', `hosted-${runId}`)
  const manifestPath = join(directory, 'manifest.json')
  const m = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  must(m.runId === runId && m.permissions?.passed && m.permissions.checks.length === 41 && Object.keys(m.cases).length === 3 && m.status === 'failed' && !m.independentFollowup && m.assignments.length === 0, 'EXACT_PARTIAL_RUN_REQUIRED')
  const keys = await projectCredentials()
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }) } }
  const admin = createClient(TARGET.storageOrigin, keys.serverKey, options)
  const credentials = JSON.parse(await readFile(join(directory, 'synthetic-credentials.json'), 'utf8'))
  must(credentials.syntheticOnly && credentials.runId === runId, 'WRONG_SYNTHETIC_CREDENTIALS')
  const tokens = {}
  for (const actor of ACTORS) {
    const account = m.accounts[actor]
    const user = await admin.auth.admin.getUserById(account.id)
    must(!user.error, 'SYNTHETIC_LOOKUP_FAILED'); assertSyntheticUser(user.data.user, account, runId)
    const org = m.organizations[account.org]
    const row = await admin.from('organizations').select('name').eq('id', org.id).single()
    must(!row.error && row.data.name === org.name, 'SYNTHETIC_ORG_MISMATCH')
    must(credentials.accounts[actor]?.email === account.email, 'WRONG_ACCOUNT_CREDENTIALS')
    const client = createClient(TARGET.storageOrigin, keys.publicKey, options)
    const login = await client.auth.signInWithPassword(credentials.accounts[actor])
    must(!login.error && login.data.session?.access_token, 'SYNTHETIC_LOGIN_FAILED')
    assertSyntheticUser(login.data.user, account, runId); tokens[actor] = login.data.session.access_token
  }
  m.independentFollowup = { startedAt: new Date().toISOString(), checks: [], limitations: ['Stale assignment business conflict not repeated: hosted review conflict already returned500 and direct stale RPC timed out504; current provider is PostgREST14.5. Global SQL changes require separate approval.', 'Review timeout explanation is a supported inference from the provider version and upstream40001 automatic-retry fix; no server query trace was captured.'] }
  const save = () => writeFile(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 })
  await save()
  const check = async (name, operation) => {
    try { await operation(); m.independentFollowup.checks.push({ name, passed: true }) }
    catch (error) { m.independentFollowup.checks.push({ name, passed: false, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'CHECK_FAILED' }) }
    await save()
  }
  const request = async (actor, route, method = 'GET', body, expected = 200) => {
    must(/^\/(cases|evidence|reviews|assignments)(\?|$)/.test(route), 'UNAPPROVED_ROUTE')
    const r = await fetch(`${TARGET.origin}/api${route}`, { method, headers: { Authorization: `Bearer ${tokens[actor]}`, 'X-Workspace-Id': m.organizations[m.accounts[actor].org].id, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000) })
    const b = await r.json().catch(() => ({}))
    must(r.status === expected, `HTTP_${r.status}_EXPECTED_${expected}`)
    must(r.headers.get('cache-control')?.includes('no-store'), 'PRIVATE_RESPONSE_CACHEABLE')
    return b
  }
  const assignment = { id: randomUUID(), officerId: m.accounts.officerA.id, packageRef: `HOSTED SYNTHETIC TEST ${runId}` }
  m.assignments.push(assignment.id); await save()
  await check('assignment:real-create-identical-retry-and-four-account-list-scope', async () => {
    await request('supervisor', '/assignments', 'POST', assignment)
    await request('supervisor', '/assignments', 'POST', assignment)
    for (const actor of ACTORS) {
      const list = await request(actor, '/assignments')
      const allowed = ['officerA', 'supervisor'].includes(actor)
      must(list.assignments?.length === (allowed ? 1 : 0) && (!allowed || list.assignments[0].id === assignment.id), 'ASSIGNMENT_SCOPE_MISMATCH')
    }
  })
  await check('assignment:foreign-officer-update-denied', () => request('officerB', '/assignments', 'PATCH', { id: assignment.id, version: 1, status: 'in_progress' }, 403))
  await check('assignment:owner-progress-and-supervisor-only-close', async () => {
    await request('officerA', '/assignments', 'PATCH', { id: assignment.id, version: 1, status: 'in_progress' })
    await request('officerA', '/assignments', 'PATCH', { id: assignment.id, version: 2, status: 'closed' }, 403)
    const list = await request('officerA', '/assignments')
    must(list.assignments?.[0]?.version === 2 && list.assignments[0].status === 'in_progress', 'ASSIGNMENT_PROGRESS_NOT_PRESERVED')
  })
  await check('suspension:existing-session-case-assignment-upload-and-seal-denied', async () => {
    const account = m.accounts.officerA
    const membership = () => admin.from('memberships').update({ active: false }).eq('org_id', m.organizations.primary.id).eq('user_id', account.id).eq('role', 'officer').select('user_id').single()
    const suspended = await membership(); must(!suspended.error && suspended.data.user_id === account.id, 'SYNTHETIC_SUSPEND_FAILED')
    account.temporarilySuspended = true; await save()
    try {
      await request('officerA', '/cases', 'GET', null, 403)
      await request('officerA', '/assignments', 'GET', null, 403)
      await request('officerA', '/evidence', 'POST', {}, 403)
      await request('officerA', '/cases', 'POST', {}, 403)
    } finally {
      const restored = await admin.from('memberships').update({ active: true }).eq('org_id', m.organizations.primary.id).eq('user_id', account.id).eq('role', 'officer').select('user_id').single()
      must(!restored.error && restored.data.user_id === account.id, 'SYNTHETIC_RESTORE_FAILED')
      account.temporarilySuspended = false; await save()
    }
    await request('officerA', `/cases?id=${encodeURIComponent(m.cases.officerA.id)}`)
  })
  await check('all-four-synthetic-memberships-active-after-revocation-test', async () => {
    for (const actor of ACTORS) {
      const account = m.accounts[actor]
      const row = await admin.from('memberships').select('role,active,org_id').eq('user_id', account.id).single()
      must(!row.error && row.data.active && row.data.role === account.role && row.data.org_id === m.organizations[account.org].id, 'FINAL_MEMBERSHIP_MISMATCH')
    }
  })
  m.independentFollowup.completedAt = new Date().toISOString()
  m.status = 'completed-with-failures'; m.completedAt = new Date().toISOString(); await save()
  console.log(JSON.stringify({ completed: true, allFeaturesPassed: false, runId, permissionChecks: 41, permissionsPassed: true, checks: m.independentFollowup.checks, priorFailuresPreserved: m.checks.filter(c => !c.passed), resourcesRetained: true }, null, 2))
  if (m.independentFollowup.checks.some(c => !c.passed)) process.exitCode = 1
}
main().catch(error => { console.log(JSON.stringify({ completed: false, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'FOLLOWUP_FAILED' })); process.exitCode = 2 })
