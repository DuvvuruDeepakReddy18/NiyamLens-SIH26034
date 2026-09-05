import { readFile, writeFile } from 'node:fs/promises'
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
  must(args.length === 8 && args.includes('--chrome-finished') && args.includes('--run-id') && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId), 'COMPLETED_CHROME_AND_EXACT_RUN_REQUIRED')
  const directory = resolve('.niyamlens-private/team-pilot', `hosted-${runId}`)
  const path = join(directory, 'manifest.json')
  const m = validateManifest(JSON.parse(await readFile(path, 'utf8')))
  must(m.runId === runId && ['completed-with-failures', 'passed'].includes(m.status) && !m.membershipShutdown, 'COMPLETED_UNCLOSED_RUN_REQUIRED')
  const keys = await projectCredentials()
  const admin = createClient(TARGET.storageOrigin, keys.serverKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }) } })
  // Verify every identity and membership before touching the first one.
  for (const actor of ACTORS) {
    const a = m.accounts[actor]
    const user = await admin.auth.admin.getUserById(a.id)
    must(!user.error, 'SYNTHETIC_LOOKUP_FAILED'); assertSyntheticUser(user.data.user, a, runId)
    const org = m.organizations[a.org]
    const orgRow = await admin.from('organizations').select('name').eq('id', org.id).single()
    must(!orgRow.error && orgRow.data.name === org.name, 'SYNTHETIC_ORG_MISMATCH')
    const rows = await admin.from('memberships').select('org_id,role,active').eq('user_id', a.id)
    must(!rows.error && rows.data.length === 1 && rows.data[0].org_id === org.id && rows.data[0].role === a.role && rows.data[0].active, 'UNEXPECTED_SYNTHETIC_MEMBERSHIP')
  }
  m.membershipShutdown = { startedAt: new Date().toISOString(), disabled: [], allDisabled: false, note: 'Only exact synthetic pilot memberships disabled. Auth accounts, marked evidence, organizations and immutable audit records retained; no deletion.' }
  const save = () => writeFile(path, JSON.stringify(m, null, 2), { mode: 0o600 })
  await save()
  for (const actor of ACTORS) {
    const a = m.accounts[actor]
    const changed = await admin.from('memberships').update({ active: false }).eq('user_id', a.id).eq('org_id', m.organizations[a.org].id).eq('role', a.role).eq('active', true).select('user_id').single()
    must(!changed.error && changed.data.user_id === a.id, 'SYNTHETIC_DISABLE_FAILED')
    m.membershipShutdown.disabled.push(actor); await save()
  }
  for (const actor of ACTORS) {
    const a = m.accounts[actor]
    const row = await admin.from('memberships').select('active,role').eq('user_id', a.id).eq('org_id', m.organizations[a.org].id).single()
    must(!row.error && !row.data.active && row.data.role === a.role, 'SYNTHETIC_DISABLE_NOT_CONFIRMED')
  }
  m.membershipShutdown.allDisabled = true; m.membershipShutdown.completedAt = new Date().toISOString(); await save()
  console.log(JSON.stringify({ runId, syntheticMembershipsDisabled: 4, verifiedInactive: true, usersDeleted: 0, evidenceDeleted: 0, humanAccountsChanged: 0 }, null, 2))
}
main().catch(error => { console.log(JSON.stringify({ passed: false, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'SYNTHETIC_SHUTDOWN_FAILED' })); process.exitCode = 1 })
