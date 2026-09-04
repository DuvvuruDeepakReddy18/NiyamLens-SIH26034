import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPilotConfig, validatePilotConfig, verifyHostedPermissions } from '../tools/verify-hosted-permissions.mjs'

const org = '11000000-0000-4000-8000-000000000001'
const other = '11000000-0000-4000-8000-000000000002'
const owners = ['22000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000003']
const panel = '33000000-0000-4000-8000-000000000001'
const names = ['officerA', 'officerB', 'otherOrg']
const tokens = Object.fromEntries([...names, 'supervisor'].map((name) => [name, `test-only-not-real-${name}`]))
const fixture = () => ({
  origin: 'https://pilot.example.test', storageOrigin: 'https://storage.example.test', workspaces: { primary: org, other },
  cases: Object.fromEntries(names.map((name, index) => {
    const id = `pilot-case-${name}`
    const prefix = `${name === 'otherOrg' ? other : org}/${owners[index]}/${id}/${panel}`
    return [name, { id, originalPath: `${prefix}/original-${'a'.repeat(64)}`, analysisPath: `${prefix}/analysis-${'b'.repeat(64)}` }]
  })),
})
function response(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } })
}
function mockServer(config, intercept) {
  return async (input, options) => {
    const url = new URL(input)
    assert.equal(url.origin, config.origin)
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.body, undefined)
    const bearer = options.headers.Authorization?.replace(/^Bearer /, '')
    const actor = Object.keys(tokens).find((key) => tokens[key] === bearer)
    const name = names.find((key) => config.cases[key].id === (url.searchParams.get('id') || url.searchParams.get('caseId')))
    const intercepted = await intercept?.({ url, actor, name, options })
    if (intercepted) return intercepted
    if (!actor) return response({ error: 'Sign in' }, 401)
    const workspace = actor === 'otherOrg' ? other : org
    if (options.headers['x-workspace-id'] !== workspace) return response({ error: 'Forbidden' }, 403)
    if (actor !== name && !(actor === 'supervisor' && name !== 'otherOrg')) return response({ error: 'Not accessible' }, 404)
    const record = config.cases[name]
    if (url.pathname === '/api/cases') return response({ record: { id: record.id, serverVersion: 1, actor: { id: record.originalPath.split('/')[1] } } })
    assert.ok([record.originalPath, record.analysisPath].includes(url.searchParams.get('path')))
    return response({ url: `${config.storageOrigin}/storage/v1/object/sign/evidence/${url.searchParams.get('path')}?token=private-test-link` })
  }
}
const run = (config, patch = {}) => verifyHostedPermissions(config, { enabled: true, allowOrigin: config.origin, tokens, fetchImpl: mockServer(config), ...patch })

async function withConfigFile(run) {
  const directory = await mkdtemp(join(tmpdir(), 'niyamlens-pilot-config-'))
  const file = join(directory, 'config.json')
  try { await run(file) } finally {
    await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await rmdir(directory)
  }
}

test('config reader bounds actual file bytes before parsing, including its exact limit', async () => {
  await withConfigFile(async (file) => {
    const config = fixture()
    const json = JSON.stringify(config)
    await writeFile(file, json.padEnd(20000, ' '))
    assert.deepEqual(await readPilotConfig(file), config)
    await writeFile(file, json.padEnd(20001, ' '))
    await assert.rejects(readPilotConfig(file), { code: 'CONFIG_TOO_LARGE' })
    await writeFile(file, Buffer.alloc(1000000, 32))
    await assert.rejects(readPilotConfig(file), { code: 'CONFIG_TOO_LARGE' })
  })
})

test('config reader rejects invalid UTF-8 instead of silently repairing JSON strings', async () => {
  await withConfigFile(async (file) => {
    await writeFile(file, Buffer.concat([Buffer.from('{"note":"'), Buffer.from([0xff]), Buffer.from('"}')]))
    await assert.rejects(readPilotConfig(file), { code: 'CONFIG_INVALID_UTF8' })
    await writeFile(file, '{"truncated":')
    await assert.rejects(readPilotConfig(file), { code: 'CONFIG_INVALID_JSON' })
    await writeFile(file, JSON.stringify({ note: 'తెలుగు' }))
    assert.deepEqual(await readPilotConfig(file), { note: 'తెలుగు' })
  })
})

test('hosted probe fails closed with no network until explicitly enabled and exact target approved', async () => {
  const config = fixture()
  let requests = 0
  const fetchImpl = async () => { requests++; throw new Error('must not run') }
  await assert.rejects(run(config, { enabled: false, fetchImpl }), { code: 'LIVE_RUN_NOT_ENABLED' })
  await assert.rejects(run(config, { allowOrigin: 'https://unapproved.example.test', fetchImpl }), { code: 'ORIGIN_NOT_APPROVED' })
  await assert.rejects(run(config, { tokens: {}, fetchImpl }), { code: 'FOUR_EXISTING_ACCOUNT_TOKENS_REQUIRED' })
  await assert.rejects(run(config, { tokens: { ...tokens, officerB: tokens.officerA }, fetchImpl }), { code: 'DISTINCT_ACCOUNT_TOKENS_REQUIRED' })
  assert.equal(requests, 0)
})

test('configuration rejects target credentials, routes, ports, non-TLS and mis-scoped evidence paths', () => {
  for (const origin of ['http://pilot.example.test', 'https://u:p@pilot.example.test', 'https://pilot.example.test/', 'https://pilot.example.test/path', 'https://pilot.example.test?secret=1', 'https://pilot.example.test#fragment', 'https://pilot.example.test:443', 'https://pilot.example.test:8443']) {
    assert.throws(() => validatePilotConfig({ ...fixture(), origin }), { code: 'INVALID_ORIGIN' })
  }
  const wrongPath = fixture(); wrongPath.cases.officerA.originalPath = wrongPath.cases.officerB.originalPath
  assert.throws(() => validatePilotConfig(wrongPath), { code: 'INVALID_EVIDENCE_FIXTURE' })
  const sameOrg = fixture(); sameOrg.workspaces.other = org
  assert.throws(() => validatePilotConfig(sameOrg), { code: 'INVALID_WORKSPACES' })
  for (const field of ['primary', 'other']) {
    const config = fixture(); config.workspaces[field] = [config.workspaces[field]]
    assert.throws(() => validatePilotConfig(config), { code: 'INVALID_WORKSPACES' })
  }
  const arrayCase = fixture(); arrayCase.cases.officerA.id = [arrayCase.cases.officerA.id]
  assert.throws(() => validatePilotConfig(arrayCase), { code: 'INVALID_CASE_FIXTURE' })
  const sameOwner = fixture()
  for (const kind of ['original', 'analysis']) sameOwner.cases.officerB[`${kind}Path`] = sameOwner.cases.officerB[`${kind}Path`].replace(owners[1], owners[0])
  assert.throws(() => validatePilotConfig(sameOwner), { code: 'DISTINCT_OFFICERS_REQUIRED' })
})

test('41 read-only checks distinguish each role and original/analysis links without following or printing signed URLs', async () => {
  const config = fixture()
  const result = await run(config)
  assert.equal(result.passed, true)
  assert.equal(result.checks.length, 41)
  assert.equal(result.checks.filter((check) => check.status === 200).length, 15)
  assert.equal(result.checks.filter((check) => check.status === 404).length, 21)
  assert.equal(result.checks.filter((check) => check.status === 403).length, 4)
  assert.equal(result.checks.filter((check) => check.status === 401).length, 1)
  assert.doesNotMatch(JSON.stringify(result), /private-test-link|test-only-not-real|original-aaaa/)
  assert.ok(result.limitations.some((text) => text.includes('not downloaded')))
})

test('a denied case that leaks evidence or a permissive status is a failing check, never a skipped pass', async () => {
  const config = fixture()
  for (const leak of [response({ record: { id: 'secret' } }), response({ error: 'denied', url: 'https://private.example.test' }, 404), response({ error: 'denied', details: { text: 'private label' } }, 404)]) {
    let used = false
    const result = await run(config, { fetchImpl: mockServer(config, ({ actor, name, url }) => {
      if (!used && actor === 'officerA' && name === 'officerB' && url.pathname === '/api/cases') { used = true; return leak }
    }) })
    assert.equal(result.passed, false)
    assert.equal(result.checks.filter((check) => !check.passed).length, 1)
  }
})

test('redirects, provider error text and untrusted signed-link origins cannot leak credentials in output', async () => {
  const config = fixture()
  const result = await run(config, { fetchImpl: mockServer(config, ({ actor, name, url }) => {
    if (actor === 'officerA' && name === 'officerA') {
      if (url.pathname === '/api/cases') throw new Error(`Provider dumped ${tokens.officerA}`)
      return response({ url: 'https://untrusted.example.test/private?token=secret' })
    }
  }) })
  assert.equal(result.passed, false)
  assert.equal(result.checks.filter((check) => !check.passed).length, 3)
  assert.doesNotMatch(JSON.stringify(result), /test-only-not-real|untrusted.example|token=secret|Provider dumped/)
  const redirected = response({ record: {} })
  Object.defineProperty(redirected, 'redirected', { value: true })
  const redirectResult = await run(config, { fetchImpl: async () => redirected })
  assert.equal(redirectResult.passed, false)
  assert.ok(redirectResult.checks.every((check) => check.reason === 'REDIRECT_REJECTED'))
})

test('private responses must be non-cacheable and bounded', async () => {
  const config = fixture()
  const cacheResult = await run(config, { fetchImpl: async () => response({}, 200, { 'cache-control': 'public, max-age=3600' }) })
  assert.equal(cacheResult.passed, false)
  assert.ok(cacheResult.checks.some((check) => check.reason === 'PRIVATE_RESPONSE_MAY_CACHE'))
  let used = false
  const sizeResult = await run(config, { fetchImpl: mockServer(config, ({ actor, name, url }) => {
    if (!used && actor === 'officerA' && name === 'officerA' && url.pathname === '/api/cases') { used = true; return response({ excess: 'x'.repeat(2500001) }) }
  }) })
  assert.equal(sizeResult.passed, false)
  assert.equal(sizeResult.checks[0].reason, 'RESPONSE_TOO_LARGE')
})
