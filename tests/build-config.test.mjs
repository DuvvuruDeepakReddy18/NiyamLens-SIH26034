import test from 'node:test'
import assert from 'node:assert/strict'
import { BuildConfigurationError, checkBuildConfiguration, validateBuildConfig } from '../tools/validate-build-config.mjs'

const PUBLIC = `sb_publishable_${'p'.repeat(32)}`
const SECRET = `sb_secret_${'s'.repeat(32)}`
const URL = 'https://example-project.supabase.co'
const config = (overrides = {}) => ({
  VERCEL_ENV: 'production', VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: PUBLIC,
  SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SECRET, ...overrides,
})
const jwt = (role, header = { alg: 'HS256', typ: 'JWT' }) => [header, { role }]
  .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).concat('a'.repeat(43)).join('.')
const expectRejection = (env, pattern) => assert.throws(() => validateBuildConfig(env), (error) => {
  assert.ok(error instanceof BuildConfigurationError)
  if (pattern) assert.match(error.message, pattern)
  for (const value of Object.values(env)) {
    if (typeof value === 'string' && value.length > 12) assert.equal(error.message.includes(value), false, 'configuration values must not be logged')
  }
  return true
})

test('unconfigured local and preview builds are explicitly local-only, not cloud-ready', () => {
  for (const env of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }]) {
    const result = validateBuildConfig(env)
    assert.equal(result.mode, 'local')
    assert.match(result.message, /local-only mode; no cloud authentication or backup/)
    assert.equal(Object.values(result).includes(URL), false)
  }
})

test('Production cannot silently build local mode and every partial combination fails in every environment', () => {
  expectRejection({ VERCEL_ENV: 'production' }, /Required variables missing/)
  const names = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  for (const environment of ['production', 'preview', 'development', undefined]) {
    for (let mask = 1; mask < 15; mask++) {
      const full = config(); const partial = { VERCEL_ENV: environment }
      names.forEach((name, index) => { if (mask & (1 << index)) partial[name] = full[name] })
      expectRejection(partial, /Required variables missing/)
    }
  }
})

test('modern and legacy key families and normalized matching project URLs are accepted without exposing values', () => {
  for (const pair of [[PUBLIC, SECRET], [jwt('anon'), jwt('service_role')], [PUBLIC, jwt('service_role')], [jwt('anon'), SECRET]]) {
    const result = validateBuildConfig(config({ VITE_SUPABASE_ANON_KEY: pair[0], SUPABASE_SERVICE_ROLE_KEY: pair[1], SUPABASE_URL: 'https://EXAMPLE-PROJECT.supabase.co:443/' }))
    assert.equal(result.mode, 'managed')
    assert.equal(result.environment, 'production')
    assert.match(result.message, /hosted acceptance still required/)
    for (const value of [URL, PUBLIC, SECRET, ...pair]) assert.equal(JSON.stringify(result).includes(value), false)
  }
})

test('privileged keys and session JWTs are barred from public variables; public credentials cannot configure the server', () => {
  for (const value of [SECRET, jwt('service_role'), jwt('authenticated'), jwt('anon', { alg: 'none' }), jwt('anon', { alg: 'RS256' })]) {
    expectRejection(config({ VITE_SUPABASE_ANON_KEY: value }), /VITE_SUPABASE_ANON_KEY/)
  }
  for (const value of [PUBLIC, jwt('anon'), jwt('authenticated')]) expectRejection(config({ SUPABASE_SERVICE_ROLE_KEY: value }), /SUPABASE_SERVICE_ROLE_KEY/)
})

test('malformed, empty, oversized and whitespace-bearing credentials fail closed without leaking values', () => {
  for (const value of ['', ' ', ` ${PUBLIC}`, `${PUBLIC}\n`, 'sb_publishable_short', 'sb_secret_short', 'a.b.c', PUBLIC.repeat(400), null, 25, {}, jwt('anon').replace(/\./, '+.')]) {
    expectRejection(config({ VITE_SUPABASE_ANON_KEY: value }))
  }
})

test('unsafe URLs and mismatched browser/server projects are rejected and never printed', () => {
  for (const value of [
    'http://example-project.supabase.co', 'https://name:password@example-project.supabase.co/',
    `${URL}?key=private`, `${URL}?`, `${URL}#private`, `${URL}#`, `${URL}/rest/v1`,
    `${URL}/../api`, `${URL}/api/../`, `${URL}/%2e%2e/`, 'https:\\example-project.supabase.co', ` ${URL}`, `${URL}\n`,
    'not-a-project-url', `${URL}/${'a'.repeat(2100)}`,
  ]) expectRejection(config({ VITE_SUPABASE_URL: value }), /VITE_SUPABASE_URL/)
  expectRejection(config({ SUPABASE_URL: 'https://different-project.supabase.co' }), /same project/)
})

test('HTTP is allowed only for matching loopback development origins without VERCEL_ENV', () => {
  for (const origin of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    const local = config({ VERCEL_ENV: undefined, VITE_SUPABASE_URL: origin, SUPABASE_URL: `${origin}/` })
    assert.equal(validateBuildConfig(local).mode, 'managed')
    for (const environment of ['production', 'preview', 'development']) expectRejection({ ...local, VERCEL_ENV: environment }, /HTTPS/)
  }
  for (const origin of ['http://remote.example', 'http://127.0.0.2:54321', 'http://localhost.example', 'http://192.168.1.2:54321']) {
    expectRejection(config({ VERCEL_ENV: undefined, VITE_SUPABASE_URL: origin, SUPABASE_URL: origin }), /HTTPS/)
  }
  for (const environment of ['', 'Production', 'invalid', true]) expectRejection({ VERCEL_ENV: environment }, /VERCEL_ENV/)
})

test('CLI integration returns nonzero on invalid configuration and produces only safe messages', () => {
  const output = []
  const options = { log: (line) => output.push(line), reportError: (line) => output.push(line) }
  assert.equal(checkBuildConfiguration({ ...options, env: config() }), 0)
  assert.equal(checkBuildConfiguration({ ...options, env: { VERCEL_ENV: 'preview' } }), 0)
  assert.equal(checkBuildConfiguration({ ...options, env: config({ VITE_SUPABASE_ANON_KEY: SECRET }) }), 1)
  assert.equal(checkBuildConfiguration({ ...options, env: { VERCEL_ENV: 'production' } }), 1)
  for (const value of [URL, PUBLIC, SECRET]) assert.equal(output.join('\n').includes(value), false)
})

test('CLI refuses third-party DEBUG environment dumping before loading credentials', () => {
  const previous = process.env.DEBUG; const output = []
  try {
    process.env.DEBUG = 'vite:*'
    assert.equal(checkBuildConfiguration({ log: (line) => output.push(line), reportError: (line) => output.push(line) }), 1)
    assert.match(output.join('\n'), /DEBUG is enabled/)
    assert.equal(output.join('\n').includes('vite:*'), false)
  } finally {
    if (previous === undefined) delete process.env.DEBUG
    else process.env.DEBUG = previous
  }
})
