import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

// Configuration validation only: this does not authenticate keys, prove RLS,
// contact Supabase, or print environment values. Supported key families:
// https://supabase.com/docs/guides/getting-started/api-keys
const VARIABLES = Object.freeze([
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
])
const LIMIT = 16384
export class BuildConfigurationError extends Error {
  constructor(message) { super(message); this.name = 'BuildConfigurationError' }
}
const reject = (message) => { throw new BuildConfigurationError(message) }

function checkedValue(env, name) {
  const value = env[name]
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > LIMIT || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) {
    reject(`${name} must be a bounded nonempty value without whitespace or control characters.`)
  }
  return value
}

function projectOrigin(value, name, allowLocalHttp) {
  // Do not allow the URL parser to silently normalize backslashes, credentials,
  // query delimiters, fragments or an API subpath into a different endpoint.
  if (value.length > 2048 || /[\\?#]/.test(value) || !/^[A-Za-z]+:\/\/[^/?#]+\/?$/.test(value)) reject(`${name} must be a safe HTTPS project root URL.`)
  let url
  try { url = new URL(value) } catch { reject(`${name} must be a safe HTTPS project root URL.`) }
  const localHttp = allowLocalHttp && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!localHttp && url.protocol !== 'https:') || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    reject(`${name} must be a safe HTTPS project root URL.`)
  }
  return url.origin
}

function jsonSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null
  try {
    const bytes = Buffer.from(segment, 'base64url')
    if (bytes.toString('base64url') !== segment) return null
    const parsed = JSON.parse(bytes.toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

function keyRole(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,512}$/.test(key)) return 'anon'
  if (/^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(key)) return 'service_role'
  const parts = key.split('.')
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]{16,1024}$/.test(parts[2])) return null
  const header = jsonSegment(parts[0]); const payload = jsonSegment(parts[1])
  // Legacy project API keys are HS256 JWTs. Reject user-session JWTs and
  // alg:none. Decoding a role is a leak guard, not signature verification.
  if (header?.alg !== 'HS256' || !['anon', 'service_role'].includes(payload?.role)) return null
  return payload.role
}

export function validateBuildConfig(env = {}) {
  if (env.VERCEL_ENV !== undefined && !['production', 'preview', 'development'].includes(env.VERCEL_ENV)) reject('VERCEL_ENV must identify production, preview or development when present.')
  const environment = ['production', 'preview', 'development'].includes(env.VERCEL_ENV) ? env.VERCEL_ENV : 'local'
  const values = Object.fromEntries(VARIABLES.map((name) => [name, checkedValue(env, name)]))
  const present = VARIABLES.filter((name) => values[name])
  if (present.length === 0 && environment !== 'production') {
    return Object.freeze({ mode: 'local', environment, message: `Build configuration: ${environment} local-only mode; no cloud authentication or backup.` })
  }
  const missing = VARIABLES.filter((name) => !values[name])
  if (missing.length) reject(`Managed build configuration is incomplete. Required variables missing: ${missing.join(', ')}.`)
  const publicOrigin = projectOrigin(values.VITE_SUPABASE_URL, 'VITE_SUPABASE_URL', env.VERCEL_ENV === undefined)
  const serverOrigin = projectOrigin(values.SUPABASE_URL, 'SUPABASE_URL', env.VERCEL_ENV === undefined)
  if (publicOrigin !== serverOrigin) reject('VITE_SUPABASE_URL and SUPABASE_URL must identify the same project root.')
  if (keyRole(values.VITE_SUPABASE_ANON_KEY) !== 'anon') reject('VITE_SUPABASE_ANON_KEY must be a publishable key or legacy anon JWT; privileged keys must never reach the browser.')
  if (keyRole(values.SUPABASE_SERVICE_ROLE_KEY) !== 'service_role') reject('SUPABASE_SERVICE_ROLE_KEY must be a server secret key or legacy service_role JWT.')
  return Object.freeze({ mode: 'managed', environment, message: `Build configuration: ${environment} managed mode; key types and matching project URLs checked, hosted acceptance still required.` })
}

export function checkBuildConfiguration({ env, log = console.log, reportError = console.error } = {}) {
  try {
    // Vite also loads .env, .env.local, .env.production and
    // .env.production.local, with existing process values taking precedence.
    // Empty prefix is deliberate: server variables must be checked too. They
    // are never passed to the browser or written into a generated file.
    // Vite's DEBUG=... env diagnostics can print loadEnv's resolved object.
    // Refuse that diagnostic path before loading any secrets, rather than
    // claiming our own redacted logger can suppress third-party logging.
    if (env === undefined && process.env.DEBUG) reject('Build configuration cannot load credentials while DEBUG is enabled; disable environment diagnostics before building.')
    const result = validateBuildConfig(env ?? loadEnv('production', process.cwd(), ''))
    log(result.message)
    return 0
  } catch (error) {
    reportError(error instanceof BuildConfigurationError ? error.message : 'Build configuration could not be validated. No environment values are logged.')
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // This command intentionally validates Vite's default production build mode.
  // An unsupported custom mode must not silently validate different env files.
  if (process.argv.length > 2) {
    console.error('Build configuration validator accepts no arguments; only the default production build mode is supported.')
    process.exitCode = 1
  } else process.exitCode = checkBuildConfiguration()
}
