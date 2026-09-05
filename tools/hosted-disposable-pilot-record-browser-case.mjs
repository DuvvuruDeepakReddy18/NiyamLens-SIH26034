import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { TARGET, validateManifest, assertSyntheticUser, projectCredentials } from './hosted-disposable-pilot.mjs'

// Read-only hosted verification plus one private manifest annotation. It never
// creates or edits a cloud case; the separately authorized Chrome flow does that.
const fail = code => { throw Object.assign(new Error(code), { code }) }
const must = (v, code) => { if (!v) fail(code) }
async function main() {
  const args = process.argv.slice(2)
  const runId = args[args.indexOf('--run-id') + 1]
  const caseId = args[args.indexOf('--case-id') + 1]
  must(args.length === 4 && args.includes('--run-id') && args.includes('--case-id') && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId) && /^[A-Za-z0-9_-]{8,100}$/.test(caseId), 'EXACT_BROWSER_FIXTURE_REQUIRED')
  const path = join(resolve('.niyamlens-private/team-pilot', `hosted-${runId}`), 'manifest.json')
  const m = validateManifest(JSON.parse(await readFile(path, 'utf8')))
  must(m.runId === runId && !m.membershipShutdown && !m.browserCases && !Object.values(m.cases).some(c => c.id === caseId), 'SINGLE_NEW_BROWSER_CASE_ONLY')
  const keys = await projectCredentials()
  const admin = createClient(TARGET.storageOrigin, keys.serverKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const account = m.accounts.officerA
  const identity = await admin.auth.admin.getUserById(account.id)
  must(!identity.error, 'SYNTHETIC_USER_LOOKUP_FAILED'); assertSyntheticUser(identity.data.user, account, runId)
  const org = m.organizations.primary
  const orgRow = await admin.from('organizations').select('name').eq('id', org.id).single()
  must(!orgRow.error && orgRow.data.name === org.name, 'SYNTHETIC_ORG_MISMATCH')
  const response = await admin.from('cases').select('id,owner_id,payload,payload_hash,version,created_at').eq('org_id', org.id).eq('id', caseId).single()
  const row = response.data
  must(!response.error && row.id === caseId && row.owner_id === account.id && row.version === 1, 'BROWSER_CASE_OWNER_OR_VERSION_MISMATCH')
  must(row.payload.rulePack === m.release.rulePack && row.payload.evidenceItems?.length === 1 && row.payload.clientAuditChain?.length > 0, 'BROWSER_TRACE_NOT_PRESENT')
  const panel = row.payload.evidenceItems[0]
  const sourceSha256 = createHash('sha256').update(await readFile(resolve('public/sample-real-label.png'))).digest('hex')
  must(panel.sha256 === sourceSha256, 'UNEXPECTED_BROWSER_SOURCE_IMAGE')
  const evidence = {}
  for (const kind of ['original', 'analysis']) {
    const objectPath = panel[`${kind}Path`]
    must(typeof objectPath === 'string' && objectPath.startsWith(`${org.id}/${account.id}/${caseId}/${panel.id}/${kind}-`), 'BROWSER_EVIDENCE_SCOPE_MISMATCH')
    const registered = await admin.from('evidence_objects').select('path,sha256,bytes,mime,owner_id,case_id,panel_id,kind').eq('path', objectPath).single()
    const object = registered.data
    must(!registered.error && object.owner_id === account.id && object.case_id === caseId && object.panel_id === panel.id && object.kind === kind, 'BROWSER_IMAGE_NOT_REGISTERED')
    evidence[kind] = { path: objectPath, sha256: object.sha256, bytes: object.bytes, mime: object.mime }
  }
  m.browserCases = [{ id: caseId, actor: 'officerA', source: 'known-development-image-public/sample-real-label.png', sourceSha256, serverVersion: row.version, serverPayloadHash: row.payload_hash, createdAt: row.created_at, panelId: panel.id, evidence, clientAuditEvents: row.payload.clientAuditChain.length,
    rulePack: row.payload.rulePack, independentlyRegisteredAt: new Date().toISOString(), note: 'One root-authorized actual-browser-sealed synthetic case. Its OCR is from a known development image, not an unseen benchmark; no manual transcription or physical confirmations authorized. Strict browser export verification is recorded in the separate Chrome report.' }]
  await writeFile(path, JSON.stringify(m, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ recorded: true, newBrowserCases: 1, registeredImages: 2, sameSyntheticOwner: true, clientAuditEvents: row.payload.clientAuditChain.length, originalThreeCasesUnchanged: true, cloudWrites: 0 }))
}
main().catch(error => { console.log(JSON.stringify({ recorded: false, code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'BROWSER_CASE_CHECK_FAILED' })); process.exitCode = 1 })
