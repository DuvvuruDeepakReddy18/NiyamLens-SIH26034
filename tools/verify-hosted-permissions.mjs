import { open } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const TOKEN_NAMES = {
  officerA: 'NIYAMLENS_PILOT_OFFICER_A_TOKEN',
  officerB: 'NIYAMLENS_PILOT_OFFICER_B_TOKEN',
  supervisor: 'NIYAMLENS_PILOT_SUPERVISOR_TOKEN',
  otherOrg: 'NIYAMLENS_PILOT_OTHER_ORG_TOKEN',
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const ID = /^[A-Za-z0-9_-]{8,100}$/
const fail = (code) => { throw Object.assign(new Error(code), { code }) }
const MAX_CONFIG_BYTES = 20000
export async function readPilotConfig(path) {
  const file = await open(path, 'r')
  try {
    if (!(await file.stat()).isFile()) fail('CONFIG_READ_OR_VALIDATION_FAILED')
    // Read at most the limit plus one sentinel byte; a misleading stat or a
    // growing file cannot cause an unbounded read before validation.
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    let total = 0
    while (total < bytes.length) {
      const { bytesRead } = await file.read(bytes, total, bytes.length - total, null)
      if (!bytesRead) break
      total += bytesRead
      if (total > MAX_CONFIG_BYTES) fail('CONFIG_TOO_LARGE')
    }
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)) } catch { fail('CONFIG_INVALID_UTF8') }
    try { return JSON.parse(text) } catch { fail('CONFIG_INVALID_JSON') }
  } finally { await file.close() }
}
function exactHttpsOrigin(value) {
  if (typeof value !== 'string' || value.length > 250) fail('INVALID_ORIGIN')
  let url
  try { url = new URL(value) } catch { fail('INVALID_ORIGIN') }
  if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value || url.port) fail('INVALID_ORIGIN')
  return url.origin
}
export function validatePilotConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('INVALID_CONFIG')
  const origin = exactHttpsOrigin(config.origin)
  const storageOrigin = exactHttpsOrigin(config.storageOrigin)
  const primary = config.workspaces?.primary
  const other = config.workspaces?.other
  if (typeof primary !== 'string' || typeof other !== 'string' || !UUID.test(primary) || !UUID.test(other) || primary === other) fail('INVALID_WORKSPACES')
  const ids = []
  for (const name of ['officerA', 'officerB', 'otherOrg']) {
    const record = config.cases?.[name]
    if (!record || typeof record.id !== 'string' || !ID.test(record.id)) fail('INVALID_CASE_FIXTURE')
    ids.push(record.id)
    for (const kind of ['original', 'analysis']) {
      const path = record[`${kind}Path`]
      const parts = typeof path === 'string' ? path.split('/') : []
      const workspace = name === 'otherOrg' ? other : primary
      if (parts.length !== 5 || parts[0] !== workspace || !UUID.test(parts[1]) || parts[2] !== record.id || !UUID.test(parts[3]) || !new RegExp(`^${kind}-[a-f0-9]{64}$`).test(parts[4])) fail('INVALID_EVIDENCE_FIXTURE')
    }
    if (record.originalPath.split('/').slice(0, 4).join('/') !== record.analysisPath.split('/').slice(0, 4).join('/')) fail('MISMATCHED_EVIDENCE_FIXTURE')
  }
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_CASE_FIXTURE')
  const ownerA = config.cases.officerA.originalPath.split('/')[1]
  const ownerB = config.cases.officerB.originalPath.split('/')[1]
  if (ownerA === ownerB) fail('DISTINCT_OFFICERS_REQUIRED')
  return { ...config, origin, storageOrigin }
}
async function boundedJson(response) {
  if (!response.body) fail('EMPTY_RESPONSE')
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2500000) { await reader.cancel(); fail('RESPONSE_TOO_LARGE') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('INVALID_JSON_RESPONSE') }
}

// GET only. No users, memberships, cases or uploads are created or modified.
// Evidence GET consumes the normal read quota and requests short-lived links;
// links and response bodies remain in memory and are never printed or followed.
export async function verifyHostedPermissions(config, {
  enabled = false, allowOrigin, tokens = {}, fetchImpl = globalThis.fetch,
} = {}) {
  if (!enabled) fail('LIVE_RUN_NOT_ENABLED')
  const checked = validatePilotConfig(config)
  if (exactHttpsOrigin(allowOrigin) !== checked.origin) fail('ORIGIN_NOT_APPROVED')
  for (const name of Object.keys(TOKEN_NAMES)) {
    if (typeof tokens[name] !== 'string' || tokens[name].length < 16 || tokens[name].length > 16000 || /\s/.test(tokens[name])) fail('FOUR_EXISTING_ACCOUNT_TOKENS_REQUIRED')
  }
  if (new Set(Object.values(tokens)).size !== 4) fail('DISTINCT_ACCOUNT_TOKENS_REQUIRED')
  const checks = []
  const call = async (name, route, actor, workspace, expectedStatus, validate) => {
    const url = new URL(route, checked.origin)
    if (url.origin !== checked.origin || !['/api/cases', '/api/evidence'].includes(url.pathname)) fail('UNAPPROVED_REQUEST')
    try {
      const headers = { 'x-workspace-id': workspace }
      if (actor) headers.Authorization = `Bearer ${tokens[actor]}`
      const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(60000), cache: 'no-store' })
      if (response.redirected || (response.url && new URL(response.url).origin !== checked.origin)) fail('REDIRECT_REJECTED')
      if (response.status !== expectedStatus) fail('UNEXPECTED_HTTP_STATUS')
      if (!(response.headers.get('cache-control') || '').split(',').some((part) => part.trim() === 'no-store')) fail('PRIVATE_RESPONSE_MAY_CACHE')
      const body = await boundedJson(response)
      if (expectedStatus === 200) validate(body)
      else if (!body || typeof body.error !== 'string' || Object.keys(body).some((key) => key !== 'error')) fail('DENIAL_RESPONSE_LEAKS_DATA')
      checks.push({ name, passed: true, status: response.status })
    } catch (error) {
      // Never echo URLs, provider bodies, signed links, headers or raw errors.
      const permitted = new Set(['REDIRECT_REJECTED', 'UNEXPECTED_HTTP_STATUS', 'PRIVATE_RESPONSE_MAY_CACHE', 'EMPTY_RESPONSE', 'RESPONSE_TOO_LARGE', 'INVALID_JSON_RESPONSE', 'DENIAL_RESPONSE_LEAKS_DATA', 'WRONG_CASE_OR_RECEIPT', 'WRONG_SIGNED_EVIDENCE_URL'])
      checks.push({ name, passed: false, reason: permitted.has(error.code) ? error.code : 'REQUEST_FAILED' })
    }
  }
  const fixtureNames = ['officerA', 'officerB', 'otherOrg']
  for (const actor of Object.keys(TOKEN_NAMES)) {
    const workspace = actor === 'otherOrg' ? checked.workspaces.other : checked.workspaces.primary
    for (const fixtureName of fixtureNames) {
      const record = checked.cases[fixtureName]
      const allowed = actor === fixtureName || (actor === 'supervisor' && fixtureName !== 'otherOrg')
      const expected = allowed ? 200 : 404
      await call(`${actor}:${fixtureName}:case`, `/api/cases?id=${encodeURIComponent(record.id)}`, actor, workspace, expected, (body) => {
        if (body?.record?.id !== record.id || !Number.isSafeInteger(body.record.serverVersion) || body.record.serverVersion < 1 || body.record.actor?.id !== record.originalPath.split('/')[1]) fail('WRONG_CASE_OR_RECEIPT')
      })
      for (const kind of ['original', 'analysis']) {
        const path = record[`${kind}Path`]
        await call(`${actor}:${fixtureName}:${kind}`, `/api/evidence?${new URLSearchParams({ caseId: record.id, path })}`, actor, workspace, expected, (body) => {
          let signed
          try { signed = new URL(body?.url) } catch { fail('WRONG_SIGNED_EVIDENCE_URL') }
          if (signed.origin !== checked.storageOrigin || signed.username || signed.password || signed.hash || decodeURIComponent(signed.pathname) !== `/storage/v1/object/sign/evidence/${path}` || !signed.searchParams.get('token')) fail('WRONG_SIGNED_EVIDENCE_URL')
        })
      }
    }
  }
  for (const actor of Object.keys(TOKEN_NAMES)) {
    const foreignWorkspace = actor === 'otherOrg' ? checked.workspaces.primary : checked.workspaces.other
    const id = actor === 'otherOrg' ? checked.cases.officerA.id : checked.cases.otherOrg.id
    await call(`${actor}:foreign-workspace`, `/api/cases?id=${encodeURIComponent(id)}`, actor, foreignWorkspace, 403)
  }
  await call('anonymous:case-denied', `/api/cases?id=${encodeURIComponent(checked.cases.officerA.id)}`, null, checked.workspaces.primary, 401)
  return {
    schemaVersion: 1, performedAt: new Date().toISOString(), target: checked.origin,
    passed: checks.every((check) => check.passed), checks,
    limitations: [
      'Uses four pre-existing, administrator-approved accounts and three already-sealed test cases; no provisioning performed.',
      'Checks exact-case and original/analysis evidence-link authorization, not every paginated list or all data in the tenant.',
      'Signed image links are validated but not downloaded; independent image-byte retrieval and hashing is a separate acceptance gate.',
      'Does not mutate permissions, submit reviews, interrupt uploads, test email delivery, or prove suspension with an old hosted token.',
      'Database failure recovery and role mutations are covered separately in isolated embedded PostgreSQL tests, not claimed live.',
    ],
  }
}

async function main() {
  const args = process.argv.slice(2)
  const allowed = new Set(['--run', '--config', '--allow-origin'])
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index])) fail('INVALID_ARGUMENTS')
    if (args[index] !== '--run') { if (!args[index + 1] || args[index + 1].startsWith('--')) fail('INVALID_ARGUMENTS'); index++ }
  }
  if (!args.includes('--run')) fail('LIVE_RUN_NOT_ENABLED')
  const configPath = args[args.indexOf('--config') + 1]
  const origin = args[args.indexOf('--allow-origin') + 1]
  if (!args.includes('--config') || !args.includes('--allow-origin')) fail('CONFIG_AND_APPROVED_ORIGIN_REQUIRED')
  const config = await readPilotConfig(configPath)
  const tokens = Object.fromEntries(Object.entries(TOKEN_NAMES).map(([name, variable]) => [name, process.env[variable]]))
  const result = await verifyHostedPermissions(config, { enabled: true, allowOrigin: origin, tokens })
  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exitCode = 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const safe = new Set(['INVALID_ARGUMENTS', 'LIVE_RUN_NOT_ENABLED', 'CONFIG_AND_APPROVED_ORIGIN_REQUIRED', 'CONFIG_TOO_LARGE', 'CONFIG_INVALID_UTF8', 'CONFIG_INVALID_JSON', 'INVALID_ORIGIN', 'INVALID_CONFIG', 'INVALID_WORKSPACES', 'INVALID_CASE_FIXTURE', 'INVALID_EVIDENCE_FIXTURE', 'MISMATCHED_EVIDENCE_FIXTURE', 'DUPLICATE_CASE_FIXTURE', 'DISTINCT_OFFICERS_REQUIRED', 'ORIGIN_NOT_APPROVED', 'FOUR_EXISTING_ACCOUNT_TOKENS_REQUIRED', 'DISTINCT_ACCOUNT_TOKENS_REQUIRED'])
    console.error(JSON.stringify({ passed: false, blocked: true, code: safe.has(error.code) ? error.code : 'CONFIG_READ_OR_VALIDATION_FAILED' }))
    process.exitCode = 2
  })
}
