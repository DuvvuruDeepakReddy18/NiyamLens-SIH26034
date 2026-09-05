import test from 'node:test'
import assert from 'node:assert/strict'
import { canOpenOfflineIdentity, createOfflineWorkspaceApi, forgetOfflineIdentity, isLocalSignoutLocked, isRetryableIdentityFailure, LOCAL_SIGNOUT_KEY, lockLocalSignout, OFFLINE_IDENTITY_KEY, OFFLINE_LEASE_MS, readOfflineIdentity, rememberOfflineSelection, rememberVerifiedIdentity, unlockAfterSignIn, validateOfflineIdentity } from '../src/lib/offlineIdentity.mjs'

const projectUrl = 'https://project-one.supabase.co'
const now = Date.parse('2026-09-06T08:00:00Z')
const user = { id: '20000000-0000-4000-8000-000000000001', email: 'officer@example.test' }
const memberships = [{ org_id: '10000000-0000-4000-8000-000000000001', role: 'supervisor', display_name: 'Test officer' }]
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } }
const lease = () => rememberVerifiedIdentity(storage(), { projectUrl, user, memberships, now })

test('explicit local fallback is only offered for retryable verification failures, never invalid authentication', () => {
  for (const issue of [{ message: 'Failed to fetch' }, { message: 'Network request failed' }, { message: 'The operation timed out' }, { status: 503 }, { status: 429 }]) assert.equal(isRetryableIdentityFailure(issue), true)
  for (const issue of [null, {}, { message: 'Invalid Refresh Token', status: 400 }, { message: 'Unauthorized', status: 401 }, { message: 'Membership revoked', status: 403 }, { message: 'permission denied' }]) assert.equal(isRetryableIdentityFailure(issue), false)
  assert.equal(isRetryableIdentityFailure({ message: 'Failed to fetch' }, 401), false)
})

test('verified identity grants at most 24 hours of local continuity without caching credentials', () => {
  const store = storage()
  const cached = rememberVerifiedIdentity(store, { projectUrl, now, user: { ...user, access_token: 'SECRET', refresh_token: 'SECRET', user_metadata: { role: 'admin' } }, memberships: memberships.map(row => ({ ...row, extra: 'SECRET' })) })
  assert.equal(cached.expiresAt, now + OFFLINE_LEASE_MS)
  assert.doesNotMatch(store.getItem(OFFLINE_IDENTITY_KEY), /SECRET|access_token|refresh_token|user_metadata/)
  assert.deepEqual(readOfflineIdentity(store, { projectUrl, now }), cached)
  assert.equal(canOpenOfflineIdentity(cached, { online: false, projectUrl, now: now + 3600000 }).user.id, user.id)
  // No JWT, expiry extension or substitute session is part of offline unlock.
  assert.equal(cached.session, undefined)
})

test('online reconnect cannot use the cached identity even before membership responds', () => {
  const cached = lease()
  for (const online of [true, undefined, null]) assert.equal(canOpenOfflineIdentity(cached, { online, projectUrl, now }), null)
})

test('non-first workspace selection persists without extending the lease or crossing account membership', () => {
  const store = storage()
  const other = { ...memberships[0], org_id: '10000000-0000-4000-8000-000000000002' }
  const cached = rememberVerifiedIdentity(store, { projectUrl, user, memberships: [...memberships, other], now })
  const selected = rememberOfflineSelection(store, other.org_id, { projectUrl, now: now + 1000, expectedUserId: user.id })
  assert.equal(selected.preferredOrg, other.org_id)
  assert.equal(selected.verifiedAt, cached.verifiedAt)
  assert.equal(selected.expiresAt, cached.expiresAt)
  assert.equal(readOfflineIdentity(store, { projectUrl, now: now + 1000 }).preferredOrg, other.org_id)
  assert.equal(rememberOfflineSelection(store, '10000000-0000-4000-8000-000000000003', { projectUrl, now }), null)
  assert.equal(rememberOfflineSelection(store, memberships[0].org_id, { projectUrl, now, expectedUserId: '20000000-0000-4000-8000-000000000002' }), null)
  assert.equal(rememberOfflineSelection(store, memberships[0].org_id, { projectUrl, now: cached.expiresAt }), null)
  assert.equal(validateOfflineIdentity({ ...cached, preferredOrg: other.org_id.replace(/2$/, '3') }, { projectUrl, now }), null)
})

test('lease fails closed at exact expiry, clock rollback, a different account and project', () => {
  const cached = lease()
  assert.equal(validateOfflineIdentity(cached, { projectUrl, now: cached.expiresAt - 1 })?.user.id, user.id)
  assert.equal(validateOfflineIdentity(cached, { projectUrl, now: cached.expiresAt }), null)
  assert.equal(validateOfflineIdentity(cached, { projectUrl, now: now - 1 }), null)
  assert.equal(validateOfflineIdentity(cached, { projectUrl: 'https://other.supabase.co', now }), null)
  assert.equal(validateOfflineIdentity(cached, { projectUrl, now, expectedUserId: '20000000-0000-4000-8000-000000000002' }), null)
  assert.equal(validateOfflineIdentity({ ...cached, expiresAt: cached.expiresAt + 1 }, { projectUrl, now }), null)
})

test('malformed, legacy, duplicated and token-bearing cached identities cannot unlock', () => {
  const cached = lease()
  for (const invalid of [null, [], memberships, { ...cached, version: 2 }, { ...cached, session: { access_token: 'SECRET' } }, { ...cached, user: { ...cached.user, token: 'SECRET' } }, { ...cached, memberships: [] }, { ...cached, memberships: [memberships[0], memberships[0]] }, { ...cached, memberships: [{ ...memberships[0], role: 'owner' }] }, { ...cached, memberships: [{ ...memberships[0], org_id: '../../other' }] }]) assert.equal(validateOfflineIdentity(invalid, { projectUrl, now }), null)
  const store = storage()
  assert.equal(readOfflineIdentity(store, { projectUrl, now }), null)
  store.setItem(OFFLINE_IDENTITY_KEY, '{bad')
  assert.equal(readOfflineIdentity(store, { projectUrl, now }), null)
})

test('explicit logout removes offline unlock while retaining local evidence and locks stale SDK sessions', () => {
  const store = storage()
  rememberVerifiedIdentity(store, { projectUrl, user, memberships, now })
  store.setItem('niyamlens:evidence:test', 'original photo remains')
  lockLocalSignout(store)
  assert.equal(store.getItem(OFFLINE_IDENTITY_KEY), null)
  assert.equal(isLocalSignoutLocked(store), true)
  assert.equal(store.getItem('niyamlens:evidence:test'), 'original photo remains')
  // Even a delayed previously-started membership response cannot reopen after logout.
  rememberVerifiedIdentity(store, { projectUrl, user, memberships, now })
  assert.equal(readOfflineIdentity(store, { projectUrl, now }), null)
  assert.equal(store.getItem(OFFLINE_IDENTITY_KEY), null)
  unlockAfterSignIn(store)
  assert.equal(store.getItem(LOCAL_SIGNOUT_KEY), null)
  rememberVerifiedIdentity(store, { projectUrl, user, memberships, now })
  assert.equal(readOfflineIdentity(store, { projectUrl, now })?.user.id, user.id)
})

test('revoked membership clears continuity and a new account replaces the previous identity', () => {
  const store = storage()
  rememberVerifiedIdentity(store, { projectUrl, user, memberships, now })
  assert.equal(rememberVerifiedIdentity(store, { projectUrl, user, memberships: [], now: now + 1 }), null)
  assert.equal(readOfflineIdentity(store, { projectUrl, now: now + 1 }), null)
  const peer = { ...user, id: '20000000-0000-4000-8000-000000000002' }
  rememberVerifiedIdentity(store, { projectUrl, user: peer, memberships, now: now + 1 })
  assert.equal(readOfflineIdentity(store, { projectUrl, now: now + 1, expectedUserId: user.id }), null)
  assert.equal(readOfflineIdentity(store, { projectUrl, now: now + 1 })?.user.id, peer.id)
  forgetOfflineIdentity(store)
  assert.equal(readOfflineIdentity(store, { projectUrl, now: now + 1 }), null)
})

test('offline API never calls credentials or network, including after connectivity changes', async () => {
  const api = createOfflineWorkspaceApi(user.id)
  for (const method of ['headers', 'request', 'ensureCurrent', 'transport', 'openRecord']) await assert.rejects(api[method]({ access_token: 'expired' }), { status: 401, code: 'OFFLINE_REAUTH_REQUIRED' })
  const old = api.signal
  api.cancelPending(); assert.equal(old.aborted, true); assert.equal(api.signal.aborted, false)
  api.dispose(); assert.equal(api.signal.aborted, true)
  api.cancelPending(); assert.equal(api.signal.aborted, true)
  await assert.rejects(api.request('cases'), { code: 'OFFLINE_REAUTH_REQUIRED' })
})

test('unavailable storage fails closed without preventing online code from continuing', () => {
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') }, removeItem() { throw Error('blocked') } }
  assert.equal(rememberVerifiedIdentity(blocked, { projectUrl, user, memberships, now }), null)
  assert.equal(readOfflineIdentity(blocked, { projectUrl, now }), null)
  assert.equal(isLocalSignoutLocked(blocked), true)
  assert.doesNotThrow(() => forgetOfflineIdentity(blocked))
})
