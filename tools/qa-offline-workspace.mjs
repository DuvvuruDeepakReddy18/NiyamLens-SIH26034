import assert from 'node:assert/strict'
import path from 'node:path'
import { launchTestBrowser } from './browser-runtime.mjs'
import { OFFLINE_IDENTITY_KEY, LOCAL_SIGNOUT_KEY, OFFLINE_LEASE_MS } from '../src/lib/offlineIdentity.mjs'

// Isolated browser and mocked Auth/RLS; never reads a user's browser session.
// Build the same dummy managed config used by qa-workspace-ui and serve 4174.
const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4174/'
const org = '10000000-0000-4000-8000-000000000001'
const selectedOrg = '10000000-0000-4000-8000-000000000002'
const user = { id: '20000000-0000-4000-8000-000000000001', email: 'offline@example.test', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-04T00:00:00Z' }
const tokenFor = expires => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expires })).toString('base64url')}.disposable-test-signature`
const token = tokenFor(Math.floor(Date.now() / 1000) + 3600)
const expiredToken = tokenFor(Math.floor(Date.now() / 1000) - 3600)
const browser = await launchTestBrowser()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
let networkAvailable = true; let revoked = false; let cloudCalls = 0; let membershipChecks = 0
let explicitNetworkFallbackUsed = false; let reportedOnlineAfterOfflineReload = null
page.on('pageerror', error => errors.push(error.message))
const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
const signIn = async () => {
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('disposable-offline-password')
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click()
  await page.locator('.workspace-strip').getByText('Offline Test Officer · supervisor', { exact: true }).waitFor()
}
try {
  await page.route('http://127.0.0.1:54321/**', route => {
    if (!networkAvailable) return route.abort('internetdisconnected')
    const routePath = new URL(route.request().url()).pathname
    if (routePath.endsWith('/token')) return json(route, { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'disposable-refresh', user })
    if (routePath.endsWith('/user')) return json(route, user)
    if (routePath.endsWith('/logout')) return json(route, {})
    if (routePath.endsWith('/memberships')) { membershipChecks++; return json(route, revoked ? [] : [org, selectedOrg].map(org_id => ({ org_id, role: 'supervisor', display_name: 'Offline Test Officer' }))) }
    return json(route, { error: 'Unexpected disposable Auth route' }, 404)
  })
  await page.route('**/api/**', route => {
    cloudCalls++
    if (!networkAvailable) return route.abort('internetdisconnected')
    const routePath = new URL(route.request().url()).pathname
    if (routePath.endsWith('/cases')) return json(route, { records: [], nextOffset: null })
    if (routePath.endsWith('/assignments')) return json(route, { assignments: [], nextOffset: null })
    return json(route, { error: 'Unexpected cloud write in offline-only acceptance' }, 400)
  })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await signIn()
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption(selectedOrg)
  const cache = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), OFFLINE_IDENTITY_KEY)
  assert.equal(cache.user.id, user.id)
  assert.equal(cache.preferredOrg, selectedOrg)
  assert.equal(cache.expiresAt - cache.verifiedAt, OFFLINE_LEASE_MS)
  assert.doesNotMatch(JSON.stringify(cache), /access_token|refresh_token|disposable-refresh|disposable-test-signature/)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
  // Set only the disposable SDK session's timestamp/token to the past. The
  // independent device lease remains at its original verified timestamp.
  const sdkExpired = await page.evaluate(expired => {
    const key = Object.keys(localStorage).find(key => /^sb-.+-auth-token$/.test(key))
    if (!key) return false
    const value = JSON.parse(localStorage.getItem(key))
    value.expires_at = Math.floor(Date.now() / 1000) - 3600; value.access_token = expired
    localStorage.setItem(key, JSON.stringify(value)); return true
  }, expiredToken)
  assert.equal(sdkExpired, true)
  networkAvailable = false
  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  reportedOnlineAfterOfflineReload = await page.evaluate(() => navigator.onLine)
  const localBanner = page.locator('.workspace-strip').getByText(/Offline local work only/)
  const networkFallback = page.getByRole('button', { name: 'Open cached local work', exact: true })
  await localBanner.or(networkFallback).first().waitFor({ timeout: 30000 })
  if (await networkFallback.count()) { explicitNetworkFallbackUsed = true; await networkFallback.click() }
  await localBanner.waitFor()
  await page.getByText('Local work only', { exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Workspace', exact: true }).inputValue(), selectedOrg)
  console.log(JSON.stringify({ phase: 'offline-workspace-opened', reportedOnlineAfterOfflineReload, explicitNetworkFallbackUsed }))
  assert.equal(await page.locator('.workspace-strip').getByText('Offline Test Officer · officer', { exact: true }).count(), 1)
  assert.equal(await page.getByRole('button', { name: 'Change password', exact: true }).isDisabled(), true)
  const continuityChecks = membershipChecks
  networkAvailable = true; await context.setOffline(false)
  const reconnectControl = page.getByRole('button', { name: 'Recheck connection', exact: true })
  if (await reconnectControl.count()) await reconnectControl.click().catch(error => { if (!/detached|not attached|Target closed/.test(error.message)) throw error })
  await page.locator('.workspace-strip').getByText('Offline Test Officer · supervisor', { exact: true }).waitFor()
  assert.ok(membershipChecks > continuityChecks)
  assert.equal(await page.getByRole('combobox', { name: 'Workspace', exact: true }).inputValue(), selectedOrg)
  assert.equal(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).preferredOrg, OFFLINE_IDENTITY_KEY), selectedOrg)
  networkAvailable = false; await context.setOffline(true)
  await localBanner.waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Workspace', exact: true }).inputValue(), selectedOrg)
  const callsBeforeLocalWork = cloudCalls
  await page.locator('input[type=file]').setInputFiles(path.join(process.cwd(), 'public', 'sample-real-label.png'))
  await page.getByText(/panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) await caution.click()
  // A disclosed manual fixture transcript tests capture/seal/export only.
  await page.locator('.evidence-editor').fill('OFFLINE TEST SOAP\nNET QTY 100 g\nMRP Rs 40.00')
  assert.equal(await page.locator('.connected-ocr-button').isDisabled(), true)
  await page.getByRole('button', { name: 'Finalize inspection', exact: true }).click()
  await page.getByText('1 queued change(s)', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Open sealed report', exact: true }).click()
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const browserDownload = page.getByRole('link', { name: 'Download with browser', exact: true })
  await browserDownload.waitFor()
  const downloadEvent = page.waitForEvent('download'); await browserDownload.click()
  const download = await downloadEvent; const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assert.equal(exported.syncState, 'pending')
  assert.equal(exported.actor.role, 'officer')
  assert.ok(exported.evidenceItems[0].originalUrl.startsWith('data:image/'))
  assert.equal(exported.serverVersion, undefined)
  assert.equal(cloudCalls, callsBeforeLocalWork)
  console.log(JSON.stringify({ phase: 'offline-capture-seal-export-verified' }))
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Officer operations', exact: true }).click()
  await page.getByText(/Assignments, cloud retrieval and supervisor dispositions require/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Review / override', exact: true }).count(), 0)
  const beforeReconnect = membershipChecks
  revoked = true; networkAvailable = true
  await context.setOffline(false)
  const recheck = page.getByRole('button', { name: 'Recheck connection', exact: true })
  if (await recheck.count()) await recheck.click().catch(error => { if (!/detached|not attached|Target closed/.test(error.message)) throw error })
  await page.getByRole('heading', { name: 'No workspace membership', exact: true }).waitFor({ timeout: 30000 })
  assert.ok(membershipChecks > beforeReconnect)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), OFFLINE_IDENTITY_KEY), null)
  assert.equal(await page.locator('.app-shell').count(), 0)
  console.log(JSON.stringify({ phase: 'reconnect-revocation-verified' }))
  // Restore the disposable role, explicitly sign in, then prove offline logout
  // cannot unlock on reload even when the SDK cannot revoke its session online.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  revoked = false
  await signIn()
  networkAvailable = false; await context.setOffline(true)
  await page.locator('.workspace-strip').getByText(/Offline local work only/).waitFor()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Officer sign in', exact: true }).waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), OFFLINE_IDENTITY_KEY), null)
  assert.equal(await page.evaluate(key => localStorage.getItem(key), LOCAL_SIGNOUT_KEY), 'signed-out')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Officer sign in', exact: true }).waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), LOCAL_SIGNOUT_KEY), 'signed-out')
  assert.equal(await page.locator('.app-shell').count(), 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ isolatedManagedBrowser: true, liveProviderTest: false, expiredSdkSession: true, tokenFreeLease: true, offlineReload: true, reportedOnlineAfterOfflineReload, explicitNetworkFallbackUsed, navigatorStateOverridden: false, nonFirstWorkspaceRetainedAcrossReloadFallbackReconnect: true, localCaptureSealExport: true, privilegedOfflineActionsBlocked: true, zeroCloudCallsDuringLocalWork: true, membershipRecheckedOnReconnect: true, revokedMembershipDenied: true, explicitOfflineLogoutPersists: true, errors }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ phase: 'offline-acceptance-failure', message: error.message, page: (await page.locator('body').innerText().catch(() => '')).slice(0, 1800), state: await page.evaluate(({ identityKey, lockKey }) => ({ online: navigator.onLine, identityPresent: Boolean(localStorage.getItem(identityKey)), signOutLocked: localStorage.getItem(lockKey) === 'signed-out', worker: Boolean(navigator.serviceWorker.controller) }), { identityKey: OFFLINE_IDENTITY_KEY, lockKey: LOCAL_SIGNOUT_KEY }).catch(() => null), errors }, null, 2))
  throw error
} finally { await browser.close() }
