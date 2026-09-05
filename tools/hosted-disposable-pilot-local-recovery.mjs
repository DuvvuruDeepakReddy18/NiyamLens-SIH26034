import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { TARGET, validateManifest, validateConsent, assertSyntheticUser, projectCredentials } from './hosted-disposable-pilot.mjs'
import handler from '../api/evidence.js'

// Candidate handler runs locally; its Auth and Storage requests are real. This
// must never be described as a successful test of the still-old production API.
const fail = code => { throw Object.assign(new Error(code), { code }) }
const must = (value, code) => { if (!value) fail(code) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function main() {
  const args = process.argv.slice(2)
  const runId = args[args.indexOf('--run-id') + 1]
  const origin = args[args.indexOf('--allow-origin') + 1]
  const projectRef = args[args.indexOf('--project-ref') + 1]
  validateConsent({ run: args.includes('--run'), origin, projectRef })
  must(args.length === 7 && args.includes('--run-id') && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId), 'EXACT_RUN_ID_REQUIRED')
  const directory = resolve('.niyamlens-private/team-pilot', `hosted-${runId}`)
  const manifestPath = join(directory, 'manifest.json')
  const m = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  must(m.runId === runId && ['completed-with-failures', 'passed'].includes(m.status), 'COMPLETED_PILOT_REQUIRED')
  must(!m.localCandidateRecovery, 'CANDIDATE_RECOVERY_ALREADY_ATTEMPTED')
  const keys = await projectCredentials()
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  const admin = createClient(TARGET.storageOrigin, keys.serverKey, options)
  const account = m.accounts.officerA
  const identity = await admin.auth.admin.getUserById(account.id)
  must(!identity.error, 'SYNTHETIC_LOOKUP_FAILED')
  assertSyntheticUser(identity.data.user, account, m.runId)
  const org = m.organizations.primary
  const orgRow = await admin.from('organizations').select('id,name').eq('id', org.id).single()
  must(!orgRow.error && orgRow.data.name === org.name, 'SYNTHETIC_ORGANIZATION_MISMATCH')
  const membership = await admin.from('memberships').select('role,active').eq('user_id', account.id).eq('org_id', org.id).single()
  must(!membership.error && membership.data.role === 'officer' && membership.data.active, 'SYNTHETIC_MEMBERSHIP_NOT_ACTIVE')
  const credentials = JSON.parse(await readFile(join(directory, 'synthetic-credentials.json'), 'utf8'))
  must(credentials.syntheticOnly && credentials.runId === runId && credentials.accounts.officerA.email === account.email, 'WRONG_SYNTHETIC_CREDENTIALS')
  const client = createClient(TARGET.storageOrigin, keys.publicKey, options)
  const login = await client.auth.signInWithPassword(credentials.accounts.officerA)
  must(!login.error && login.data.session?.access_token, 'SYNTHETIC_SIGNIN_FAILED')
  assertSyntheticUser(login.data.user, account, m.runId)
  const bytes = await readFile(join(directory, 'synthetic-test-only.png'))
  const caseId = m.cases.officerA.id
  must(caseId === `hosted-${runId}-officerA`, 'SYNTHETIC_CASE_MISMATCH')
  const descriptor = { caseId, panelId: randomUUID(), kind: 'original', sha256: hash(bytes), bytes: bytes.length, mime: 'image/png' }
  const path = `${org.id}/${account.id}/${caseId}/${descriptor.panelId}/original-${descriptor.sha256}`
  m.localCandidateRecovery = { kind: 'local-candidate-handler-real-supabase-providers', startedAt: new Date().toISOString(), path, panelId: descriptor.panelId, sha256: descriptor.sha256, bytes: bytes.length,
    handlerSha256: hash(await readFile(resolve('api/evidence.js'))), validatorSha256: hash(await readFile(resolve('server/imageValidation.mjs'))),
    status: 'started', checks: [], publicDeploymentChanged: false, limitation: 'One extra unsealed recovery-test original retained under an existing synthetic case ID; not part of its sealed evidence payload. Public RC5 failure remains unchanged.' }
  const save = () => writeFile(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 })
  await save()
  process.env.SUPABASE_URL = TARGET.storageOrigin
  process.env.SUPABASE_SERVICE_ROLE_KEY = keys.serverKey
  const invoke = async () => {
    let status, payload
    const headers = {}
    const res = { setHeader(k, v) { headers[k.toLowerCase()] = v }, status(v) { status = v; return this }, json(v) { payload = v; return this } }
    await handler({ method: 'POST', headers: { authorization: `Bearer ${login.data.session.access_token}`, 'x-workspace-id': org.id }, body: { ...descriptor, action: 'prepare' } }, res)
    must(status === 200 && payload?.path === path && headers['cache-control'] === 'no-store', `LOCAL_PREPARE_HTTP_${status}`)
    return payload
  }
  try {
    const first = await invoke()
    must(first.verified === false && first.uploadUrl, 'FIRST_PREPARE_NOT_UPLOAD')
    const url = new URL(first.uploadUrl)
    must(url.origin === TARGET.storageOrigin && decodeURIComponent(url.pathname) === `/storage/v1/object/upload/sign/evidence/${path}`, 'WRONG_STORAGE_UPLOAD_TARGET')
    const uploaded = await fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' }, redirect: 'error', signal: AbortSignal.timeout(45000) })
    must(uploaded.ok, 'REAL_UPLOAD_FAILED')
    m.localCandidateRecovery.checks.push({ name: 'real-signed-PUT-before-registration', passed: true }); await save()
    const registrationBefore = await admin.from('evidence_objects').select('path').eq('path', path)
    must(!registrationBefore.error && registrationBefore.data.length === 0, 'ALREADY_REGISTERED_BEFORE_RETRY')
    const retry = await invoke()
    must(retry.verified === true && !retry.uploadUrl, 'RETRY_DID_NOT_VERIFY_EXISTING_BYTES')
    m.localCandidateRecovery.checks.push({ name: 'local-candidate-prepare-recovers-unregistered-live-object', passed: true }); await save()
    const again = await invoke()
    must(again.verified === true && !again.uploadUrl, 'THIRD_PREPARE_NOT_IDEMPOTENT')
    const registration = await admin.from('evidence_objects').select('path,sha256,bytes').eq('path', path)
    must(!registration.error && registration.data.length === 1 && registration.data[0].sha256 === descriptor.sha256 && registration.data[0].bytes === bytes.length, 'REGISTRATION_NOT_EXACT_AND_SINGLE')
    m.localCandidateRecovery.checks.push({ name: 'repeat-idempotent-one-exact-registration', passed: true })
    m.localCandidateRecovery.status = 'passed'; m.localCandidateRecovery.passed = true
  } catch (error) {
    m.localCandidateRecovery.status = 'failed'; m.localCandidateRecovery.passed = false
    m.localCandidateRecovery.failureCode = /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'LOCAL_CANDIDATE_CHECK_FAILED'
  } finally {
    m.localCandidateRecovery.completedAt = new Date().toISOString(); await save()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  }
  console.log(JSON.stringify({ passed: m.localCandidateRecovery.passed, runId, mode: m.localCandidateRecovery.kind, checks: m.localCandidateRecovery.checks, failureCode: m.localCandidateRecovery.failureCode, publicDeploymentChanged: false, extraTestImageRetained: true }, null, 2))
  if (!m.localCandidateRecovery.passed) process.exitCode = 1
}
main().catch(error => { console.log(JSON.stringify({ passed: false, blocked: true, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'CANDIDATE_NOT_STARTED' })); process.exitCode = 2 })
