// A short-lived local continuity hint, not an authentication token or a grant
// of server permissions. Browser evidence is already device-local and must be
// used on a trusted device. Only a fresh online membership result mints a lease.
export const OFFLINE_IDENTITY_KEY = 'niyamlens:offline-identity:v1'
export const LOCAL_SIGNOUT_KEY = 'niyamlens:local-signout:v1'
export const OFFLINE_LEASE_MS = 24 * 60 * 60 * 1000
export function isRetryableIdentityFailure(issue, responseStatus) {
  const status = Number(responseStatus ?? issue?.status ?? 0)
  if ([400, 401, 403, 404].includes(status)) return false
  return status === 429 || status >= 500 || (status === 0 && /network|failed to fetch|fetch failed|timed? ?out|timeout|load failed|aborted/i.test(String(issue?.message || '')))
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ROLES = ['officer', 'supervisor', 'admin']
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
const safeText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value)
const originOf = (value) => { try { const origin = new URL(value); return /^https?:$/.test(origin.protocol) && !origin.username && !origin.password ? origin.origin : '' } catch { return '' } }

export function validateOfflineIdentity(value, { projectUrl, now = Date.now(), expectedUserId } = {}) {
  if (!exactKeys(value, ['version', 'projectOrigin', 'user', 'memberships', 'preferredOrg', 'verifiedAt', 'expiresAt']) || value.version !== 1) return null
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(value.verifiedAt) || !Number.isSafeInteger(value.expiresAt)) return null
  if (value.verifiedAt > now || value.expiresAt <= now || value.expiresAt - value.verifiedAt !== OFFLINE_LEASE_MS) return null
  if (!originOf(projectUrl) || value.projectOrigin !== originOf(projectUrl)) return null
  if (!exactKeys(value.user, ['id', 'label']) || !UUID.test(value.user.id) || !safeText(value.user.label, 320)) return null
  if (expectedUserId && value.user.id !== expectedUserId) return null
  if (!Array.isArray(value.memberships) || value.memberships.length < 1 || value.memberships.length > 100) return null
  const orgs = new Set()
  for (const member of value.memberships) {
    if (!exactKeys(member, ['org_id', 'role', 'display_name']) || !UUID.test(member.org_id) || !ROLES.includes(member.role) || !safeText(member.display_name, 200) || orgs.has(member.org_id)) return null
    orgs.add(member.org_id)
  }
  if (!orgs.has(value.preferredOrg)) return null
  return value
}

export function rememberVerifiedIdentity(storage, { projectUrl, user, memberships, preferredOrg, now = Date.now() }) {
  if (isLocalSignoutLocked(storage)) return null
  // Whitelist fields; never spread an Auth session into persistent storage.
  const value = {
    version: 1, projectOrigin: originOf(projectUrl), user: { id: user?.id, label: user?.email || user?.id },
    memberships: (memberships || []).map(member => ({ org_id: member.org_id, role: member.role, display_name: member.display_name || user?.email || user?.id })),
    preferredOrg: memberships?.some(member => member.org_id === preferredOrg) ? preferredOrg : memberships?.[0]?.org_id,
    verifiedAt: now, expiresAt: now + OFFLINE_LEASE_MS,
  }
  if (!validateOfflineIdentity(value, { projectUrl, now })) { forgetOfflineIdentity(storage); return null }
  try { storage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify(value)); return value } catch { return null }
}

export function rememberOfflineSelection(storage, org, options) {
  const cached = readOfflineIdentity(storage, options)
  if (!cached || !cached.memberships.some(member => member.org_id === org)) return null
  const next = { ...cached, preferredOrg: org }
  try { storage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify(next)); return next } catch { return null }
}

export function readOfflineIdentity(storage, options) {
  try {
    if (isLocalSignoutLocked(storage)) return null
    const raw = storage.getItem(OFFLINE_IDENTITY_KEY)
    if (!raw || raw.length > 40000) return null
    return validateOfflineIdentity(JSON.parse(raw), options)
  } catch { return null }
}

export function isLocalSignoutLocked(storage) {
  try { return storage.getItem(LOCAL_SIGNOUT_KEY) === 'signed-out' } catch { return true }
}

export function lockLocalSignout(storage) {
  forgetOfflineIdentity(storage)
  try { storage.setItem(LOCAL_SIGNOUT_KEY, 'signed-out') } catch { /* In-memory Gate also locks immediately. */ }
}

export function unlockAfterSignIn(storage) {
  try { storage.removeItem(LOCAL_SIGNOUT_KEY) } catch { /* A failed persistent unlock remains fail-closed on reload. */ }
}

export function forgetOfflineIdentity(storage) {
  try { storage.removeItem(OFFLINE_IDENTITY_KEY) } catch { /* Storage may be unavailable; never erase evidence. */ }
}

export function canOpenOfflineIdentity(value, { online, projectUrl, now = Date.now(), expectedUserId } = {}) {
  return online === false ? validateOfflineIdentity(value, { projectUrl, now, expectedUserId }) : null
}

export function createOfflineWorkspaceApi(expectedUserId) {
  let controller = new AbortController()
  let disposed = false
  const denied = () => Object.assign(new Error('Local work only. Reconnect and verify your sign-in and membership before using cloud actions.'), { status: 401, code: 'OFFLINE_REAUTH_REQUIRED' })
  const reject = async () => { throw denied() }
  return {
    expectedUserId, headers: reject, request: reject, ensureCurrent: reject, transport: reject, openRecord: reject,
    get signal() { return controller.signal },
    cancelPending() { controller.abort(denied()); if (!disposed) controller = new AbortController() },
    dispose() { disposed = true; controller.abort(denied()) },
  }
}
