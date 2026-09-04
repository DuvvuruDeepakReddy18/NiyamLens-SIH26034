import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
import { validateCase } from '../server/caseService.mjs'
const org = '10000000-0000-4000-8000-000000000001'
const user = { id: '20000000-0000-4000-8000-000000000001', email: 'officer@example.test', role: 'authenticated', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-04T00:00:00Z' }
const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`
const otherUser = { ...user, id: '20000000-0000-4000-8000-000000000002', email: 'peer@example.test' }
const otherToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: otherUser.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test-signature`
const browser = await launchTestBrowser()
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const errors = []; let saved = null; let evidenceChecks = 0; let uploadedFiles = 0; let holdNextRead = false; let releaseRead; let readStarted
const uploads = new Map(); const verified = new Set()
page.on('pageerror', (error) => errors.push(error.message))
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
try {
  await page.route('http://127.0.0.1:54321/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/storage/v1/object/upload/sign/evidence/')) {
      assert.equal(route.request().method(), 'PUT')
      assert.equal(route.request().headers()['x-upsert'], 'false')
      const objectPath = path.slice('/storage/v1/object/upload/sign/evidence/'.length)
      const bytes = route.request().postDataBuffer()
      assert.ok(bytes.length > 0)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), objectPath.split('-').at(-1))
      uploads.set(objectPath, bytes); uploadedFiles++
      return json(route, { Key: `evidence/${objectPath}` })
    }
    if (path.endsWith('/token')) {
      const other = route.request().postDataJSON().email === otherUser.email
      return json(route, { access_token: other ? otherToken : token, token_type: 'bearer', expires_in: 3600, refresh_token: 'test-refresh', user: other ? otherUser : user })
    }
    if (path.endsWith('/user')) return json(route, user)
    if (path.endsWith('/logout')) return json(route, {})
    if (path.endsWith('/memberships')) return json(route, [{ org_id: org, role: 'officer', display_name: route.request().headers().authorization === `Bearer ${otherToken}` ? 'Peer Officer' : 'Test Officer' }])
    return json(route, { error: 'Unexpected mock route' }, 404)
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname
    assert.equal(request.headers()['x-workspace-id'], org)
    const other = request.headers().authorization === `Bearer ${otherToken}`
    assert.ok([`Bearer ${token}`, `Bearer ${otherToken}`].includes(request.headers().authorization))
    if (path === '/api/cases' && request.method() === 'GET') {
      if (holdNextRead && !other) {
        holdNextRead = false; readStarted()
        await new Promise((resolve) => { releaseRead = resolve })
      }
      return json(route, { records: saved && !other ? [saved] : [], nextOffset: null }).catch((error) => { if (!/closed|interception|Invalid InterceptionId/i.test(error.message)) throw error })
    }
    if (path === '/api/evidence' && request.method() === 'POST') {
      const input = request.postDataJSON(); evidenceChecks++
      assert.match(input.sha256, /^[a-f0-9]{64}$/); assert.ok(input.bytes > 0)
      assert.equal(other, false)
      const objectPath = `${org}/${user.id}/${input.caseId}/${input.panelId}/${input.kind}-${input.sha256}`
      if (input.action === 'prepare') return json(route, { path: objectPath, verified: verified.has(objectPath), uploadUrl: `http://127.0.0.1:54321/storage/v1/object/upload/sign/evidence/${objectPath}?token=test-only-signature` })
      assert.equal(input.action, 'verify')
      const bytes = uploads.get(objectPath)
      assert.ok(bytes, 'The actual file must be uploaded before registration succeeds.')
      assert.equal(bytes.length, input.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256)
      verified.add(objectPath)
      return json(route, { path: objectPath, verified: true })
    }
    if (path === '/api/cases' && request.method() === 'POST') {
      const input = request.postDataJSON().record
      assert.equal(other, false)
      assert.ok(input.evidenceItems[0].originalPath); assert.ok(!input.evidenceItems[0].originalUrl)
      assert.ok(verified.has(input.evidenceItems[0].originalPath)); assert.ok(verified.has(input.evidenceItems[0].analysisPath))
      saved = { ...validateCase(input, { user, member: { role: 'officer' } }), serverVersion: 1, serverSealedAt: new Date().toISOString(), serverPayloadHash: 'a'.repeat(64), syncState: 'synced' }
      return json(route, { record: saved })
    }
    if (path === '/api/assignments') return json(route, { assignments: [], nextOffset: null })
    return json(route, { error: 'Unexpected mock API route' }, 404)
  })
  await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-only')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.locator('.workspace-strip').getByText('Test Officer · officer', { exact: true }).waitFor()
  assert.equal(await page.getByText('Controlled test packets').count(), 0)
  // Browser-rendered test fixture, not an unseen real-world OCR benchmark.
  const fixturePage = await context.newPage()
  await fixturePage.setContent('<div style="background:white;width:500px;height:160px;font:24px Arial">TEST SOAP<br>NET QTY 100 g<br>MRP Rs 40.00</div>')
  const fixture = await fixturePage.locator('div').screenshot(); await fixturePage.close()
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-label.png', mimeType: 'image/png', buffer: fixture })
  await page.getByText(/panel ready for OCR/i).waitFor()
  await page.locator('.evidence-editor').fill('TEST SOAP\nNET QTY 100 g\nMRP Rs 40.00')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Finalize inspection', exact: true }).click()
  await page.getByRole('button', { name: 'Start new inspection', exact: true }).waitFor()
  await page.getByText('1 queued change(s)', { exact: true }).waitFor()
  assert.equal(saved, null)
  await context.setOffline(false)
  await page.getByRole('button', { name: 'Sync / retry', exact: true }).click()
  await page.getByText('0 queued change(s)', { exact: true }).waitFor({ timeout: 30000 })
  assert.equal(saved.serverVersion, 1); assert.equal(evidenceChecks, 4); assert.equal(uploadedFiles, 2)
  await page.getByRole('button', { name: 'Officer operations', exact: true }).click()
  await page.getByRole('heading', { name: 'Shared officer operations' }).waitFor()
  assert.equal(await page.locator('.actor-switch').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Review / override', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Evidence', exact: true }).click()
  await page.getByText('Officer-supplied timeline — not independently verified', { exact: true }).waitFor()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const download = await downloadEvent; const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assert.ok(exported.clientAuditChain.length > 0)
  for (const kind of ['original', 'analysis']) {
    const image = exported.evidenceItems[0][`${kind}Url`]
    assert.match(image, /^data:image\/(png|jpeg);base64,/)
    assert.equal(createHash('sha256').update(Buffer.from(image.split(',')[1], 'base64')).digest('hex'), exported.evidenceItems[0][`${kind}Path`].split('-').at(-1))
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  // Leave A's case refresh in flight while signing out and opening B's scope.
  const started = new Promise((resolve) => { readStarted = resolve })
  holdNextRead = true
  await page.getByRole('button', { name: 'Sync / retry', exact: true }).click()
  await started
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  await page.getByLabel('Email', { exact: true }).fill(otherUser.email)
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-only')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.locator('.workspace-strip').getByText('Peer Officer · officer', { exact: true }).waitFor()
  releaseRead()
  await page.getByRole('button', { name: 'Officer operations', exact: true }).click()
  await page.getByRole('heading', { name: 'Shared officer operations' }).waitFor()
  await page.getByText('0 queued change(s)', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Review / override', exact: true }).count(), 0)
  assert.equal(await page.getByText(saved.id, { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ service: 'mocked Auth and upload API; not live Supabase', login: true, realLocalOutbox: true, offlineQueueRetained: true, signedPutUploads: uploadedFiles, verifiedUploadDescriptorContract: true, serverRecomputedCase: true, portableEvidenceExport: true, clientAuditPreserved: true, roleControls: true, accountSwitchDuringRefresh: true, signOut: true, errors }, null, 2))
} finally { await browser.close() }
