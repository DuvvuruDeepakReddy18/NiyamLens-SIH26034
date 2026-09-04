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
const assertWorkspaceLayout = async (width, height = 900) => {
  await page.setViewportSize({ width, height })
  const geometry = await page.evaluate(() => {
    const strip = document.querySelector('.workspace-strip')
    const sidebar = document.querySelector('.sidebar')
    const shell = document.querySelector('.app-shell')
    assertElements(strip, sidebar, shell)
    const stripRect = strip.getBoundingClientRect()
    const sidebarRect = sidebar.getBoundingClientRect()
    const shellRect = shell.getBoundingClientRect()
    return {
      stripLeft: stripRect.left,
      stripRight: stripRect.right,
      stripBottom: stripRect.bottom,
      sidebarLeft: sidebarRect.left,
      sidebarRight: sidebarRect.right,
      shellTop: shellRect.top,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('body *')].flatMap((element) => {
        const rect = element.getBoundingClientRect()
        return rect.right > window.innerWidth + 0.5 || rect.left < -0.5
          ? [`${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${[...element.classList].map((name) => `.${name}`).join('')}[${Math.round(rect.left)},${Math.round(rect.right)}]`]
          : []
      }).slice(0, 12),
      childrenInViewport: [...strip.children].every((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= -0.5 && rect.right <= window.innerWidth + 0.5
      }),
    }

    function assertElements(...elements) {
      if (elements.some((element) => !element)) throw new Error('Workspace layout elements are missing.')
    }
  })
  assert.ok(geometry.stripRight <= width + 0.5, `Workspace strip exceeds ${width}px viewport.`)
  assert.ok(geometry.childrenInViewport, `Workspace strip content is clipped at ${width}px.`)
  assert.ok(geometry.scrollWidth <= width, `Horizontal overflow exists at ${width}px (document width ${geometry.scrollWidth}px): ${geometry.overflowing.join(', ')}`)
  if (width > 820) {
    assert.ok(Math.abs(geometry.stripLeft - geometry.sidebarRight) <= 0.5, `Workspace strip does not clear the sidebar at ${width}px.`)
    assert.ok(Math.abs(geometry.stripLeft - 258) <= 0.5, `Desktop rail width changed unexpectedly at ${width}px.`)
  } else {
    assert.ok(Math.abs(geometry.stripLeft) <= 0.5, `Mobile workspace strip does not start at the viewport edge at ${width}px.`)
    assert.ok(geometry.sidebarRight <= 0.5, `Closed mobile sidebar remains visible at ${width}px.`)
    assert.ok(geometry.shellTop + 0.5 >= geometry.stripBottom, `App shell overlaps the wrapped workspace strip at ${width}px.`)
  }
}
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
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-only')
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click()
  await page.locator('.workspace-strip').getByText('Test Officer · officer', { exact: true }).waitFor()
  for (const width of [1280, 821, 820, 560, 390]) await assertWorkspaceLayout(width, width <= 560 ? 844 : 900)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.locator('.menu-scrim').waitFor()
  const scrimCoversWorkspaceControls = await page.evaluate(() => {
    const strip = document.querySelector('.workspace-strip')
    if (!strip) throw new Error('Workspace strip is missing.')
    const rect = strip.getBoundingClientRect()
    const target = document.elementFromPoint(300, Math.min(rect.bottom - 1, rect.top + 10))
    return Boolean(target?.closest('.menu-scrim'))
  })
  assert.equal(scrimCoversWorkspaceControls, true, 'Mobile navigation scrim must cover workspace controls outside the drawer.')
  await page.locator('.menu-scrim').evaluate((scrim) => scrim.click())
  await page.setViewportSize({ width: 1440, height: 1000 })
  assert.equal(await page.getByText('Controlled test packets').count(), 0)
  // Browser-rendered test fixture, not an unseen real-world OCR benchmark.
  const fixturePage = await context.newPage()
  await fixturePage.setContent('<div style="background:white;width:500px;height:160px;font:24px Arial">TEST SOAP<br>NET QTY 100 g<br>MRP Rs 40.00</div>')
  const fixture = await fixturePage.locator('div').screenshot(); await fixturePage.close()
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-label.png', mimeType: 'image/png', buffer: fixture })
  await page.getByText(/panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) await caution.click()
  await page.getByRole('button', { name: /Run browser OCR/i }).click()
  await page.getByText(/OCR complete across 1 panel/i).waitFor({ timeout: 120000 })
  assert.ok(await page.locator('.extraction-grid > button').filter({ hasText: 'View source' }).count(), 'OCR must produce at least one source-linked declaration before managed sealing.')
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
  assert.ok(saved.regions.length > 0, 'Managed case must retain bounded source regions.')
  assert.ok(saved.regions.every((region) => region.label !== 'Client-controlled fake label'))
  await page.getByRole('button', { name: 'Officer operations', exact: true }).click()
  await page.getByRole('heading', { name: 'Shared officer operations' }).waitFor()
  assert.equal(await page.locator('.actor-switch').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Review / override', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: 'Evidence', exact: true }).click()
  await page.getByText('Officer-supplied timeline — not independently verified', { exact: true }).waitFor()
  await page.getByRole('heading', { name: 'Trace a parsed value to its captured pixels.', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const browserDownload = page.getByRole('link', { name: 'Download with browser', exact: true })
  await browserDownload.waitFor()
  const downloadEvent = page.waitForEvent('download')
  await browserDownload.click()
  const download = await downloadEvent; const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assert.ok(exported.clientAuditChain.length > 0)
  assert.deepEqual(exported.regions, saved.regions)
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
  await page.getByRole('heading', { name: 'Officer sign in', exact: true }).waitFor()
  await page.getByLabel('Email', { exact: true }).fill(otherUser.email)
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-only')
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).click()
  await page.locator('.workspace-strip').getByText('Peer Officer · officer', { exact: true }).waitFor()
  releaseRead()
  await page.getByRole('button', { name: 'Officer operations', exact: true }).click()
  await page.getByRole('heading', { name: 'Shared officer operations' }).waitFor()
  await page.getByText('0 queued change(s)', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Review / override', exact: true }).count(), 0)
  assert.equal(await page.getByText(saved.id, { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('heading', { name: 'Officer sign in', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ service: 'mocked Auth and upload API; not live Supabase', login: true, workspaceLayoutViewports: [1280, 821, 820, 560, 390], mobileScrimLayering: true, realLocalOutbox: true, offlineQueueRetained: true, signedPutUploads: uploadedFiles, verifiedUploadDescriptorContract: true, serverRecomputedCase: true, sourceRegionRoundTrip: true, sealedSourceReplay: true, portableEvidenceExport: true, clientAuditPreserved: true, roleControls: true, accountSwitchDuringRefresh: true, signOut: true, errors }, null, 2))
} finally { await browser.close() }
