import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { TARGET, ACTORS, validateConsent, newManifest, validateManifest, assertSyntheticUser } from '../tools/hosted-disposable-pilot.mjs'

test('hosted disposable pilot requires explicit exact production target consent', () => {
  const valid = { run: true, origin: TARGET.origin, projectRef: TARGET.projectRef }
  assert.doesNotThrow(() => validateConsent(valid))
  for (const change of [{ run: false }, { origin: TARGET.origin + '/' }, { origin: 'https://example.com' }, { projectRef: 'another-project' }]) assert.throws(() => validateConsent({ ...valid, ...change }), { code: 'EXACT_TARGET_CONSENT_REQUIRED' })
})
test('manifest is exactly four synthetic accounts and two distinctly scoped organizations', () => {
  const m = newManifest()
  assert.equal(validateManifest(m), m)
  assert.deepEqual(Object.keys(m.accounts), ACTORS)
  assert.ok(ACTORS.every(a => m.accounts[a].email.endsWith('@example.invalid')))
  assert.equal(m.accounts.supervisor.role, 'supervisor')
  assert.equal(m.accounts.otherOrg.org, 'other')
  assert.equal(m.accounts.officerA.org, 'primary')
  assert.notEqual(m.organizations.primary.id, m.organizations.other.id)
  assert.match(m.cleanupPlan, /Never reset/)
  assert.doesNotMatch(JSON.stringify(m), /"(?:access_token|refresh_token|password|service_role)"\s*:/)
})
test('manifest rejects real addresses, cross-project targets, extra accounts and broadened memberships', () => {
  const changes = [m => { m.accounts.officerA.email = 'human@gmail.com' }, m => { m.target = { ...TARGET, projectRef: 'other' } }, m => { m.accounts.extra = m.accounts.officerA }, m => { m.accounts.officerA.role = 'admin' }, m => { m.organizations.primary.name = 'NiyamLens team' }, m => { delete m.organizations.other }, m => { m.accounts.otherOrg.org = 'primary' }, m => { m.organizations.other.id = m.organizations.primary.id }]
  for (const change of changes) { const m = newManifest(); change(m); assert.throws(() => validateManifest(m)) }
})
test('manifest rejects duplicate or invalid recorded Auth identities', () => {
  const m = newManifest()
  m.accounts.officerA.id = randomUUID()
  m.accounts.officerB.id = m.accounts.officerA.id
  assert.throws(() => validateManifest(m), { code: 'UNSAFE_ACCOUNT' })
  m.accounts.officerB.id = 'not-a-uuid'
  assert.throws(() => validateManifest(m), { code: 'UNSAFE_ACCOUNT' })
})
test('later fixture membership changes require exact Auth identity and server-owned synthetic metadata', () => {
  const m = newManifest()
  const account = { ...m.accounts.officerA, id: randomUUID() }
  const user = { id: account.id, email: account.email, app_metadata: { niyamlens_pilot_run: m.runId, synthetic_only: true } }
  assert.doesNotThrow(() => assertSyntheticUser(user, account, m.runId))
  for (const modified of [{ ...user, id: randomUUID() }, { ...user, email: 'human@gmail.com' }, { ...user, app_metadata: {} }, { ...user, app_metadata: { niyamlens_pilot_run: randomUUID(), synthetic_only: true } }]) assert.throws(() => assertSyntheticUser(modified, account, m.runId), { code: 'SYNTHETIC_IDENTITY_MISMATCH' })
})
