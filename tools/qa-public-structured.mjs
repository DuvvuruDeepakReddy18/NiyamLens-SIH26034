// Public rendering only: fresh signed-out context, no autofill/login/account writes.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { launchTestBrowser } from './browser-runtime.mjs'

const args = process.argv.slice(2)
assert.ok(args.length === 4 && args[0] === '--asset' && args[2] === '--expect-sha', 'Usage: node tools/qa-public-structured.mjs --asset /assets/index-HASH.js --expect-sha SHA256')
const asset = args[1]; const expectedSha256 = args[3].toLowerCase()
assert.match(asset, /^\/assets\/index-[\w-]+\.js$/)
assert.match(expectedSha256, /^[a-f0-9]{64}$/)
const origin = 'https://niyamlens-sih26034.vercel.app'
const report = {
  kind: 'public-structured-anonymous-browser-rendering-only', origin, startedAt: new Date().toISOString(),
  asset, expectedSha256, observedSha256: null, checks: [], errors: [], blockedRequests: [],
  limitations: ['No sign-in, OCR execution, private records, email sending or new hosted multi-account validation. Fresh isolated context with no saved account state; only same-origin GET/HEAD requests are allowed.'],
}
let browser
try {
  browser = await launchTestBrowser()
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) { await route.continue(); return }
    if (report.blockedRequests.length < 50) report.blockedRequests.push({ method: request.method(), origin: url.origin, path: url.pathname.slice(0, 500) })
    await route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  page.on('pageerror', error => { if (report.errors.length < 50) report.errors.push(String(error.message).slice(0, 2000)) })
  const bundlePromise = page.waitForResponse(response => response.url() === `${origin}${asset}`, { timeout: 30000 }).catch(() => null)
  const response = await page.goto(origin, { waitUntil: 'networkidle', timeout: 30000 })
  assert.equal(response.status(), 200)
  assert.equal(page.url(), `${origin}/`)
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).waitFor({ timeout: 30000 })
  const observedAsset = await page.locator('script[type="module"][src]').first().getAttribute('src')
  assert.equal(observedAsset, asset, 'Rendered homepage must reference the supplied release asset.')
  const bundleResponse = await bundlePromise
  assert.ok(bundleResponse, 'The browser did not load the supplied release asset.')
  assert.equal(bundleResponse.status(), 200)
  const bundle = await bundleResponse.body()
  assert.ok(bundle.length <= 2000000, 'Public bundle exceeds this bounded smoke-test limit.')
  report.observedSha256 = createHash('sha256').update(bundle).digest('hex')
  assert.equal(report.observedSha256, expectedSha256)
  report.browserVersion = browser.version()
  report.userAgent = await page.evaluate(() => navigator.userAgent)
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    assert.equal(await page.getByRole('button', { name: 'Sign in securely', exact: true }).isVisible(), true)
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), '', 'No email autofill or account is permitted.')
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '', 'No password autofill or account is permitted.')
    const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 }))
    assert.equal(layout.overflow, false)
    report.checks.push({ viewport, signedOutLoginVisible: true, emailEmpty: true, passwordEmpty: true, ...layout })
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.blockedRequests, [], 'Unexpected cross-origin or non-read-only network activity occurred.')
} catch (error) { report.errors.push(String(error.message).slice(0, 2000)); process.exitCode = 1 }
finally {
  if (browser) {
    try { await browser.close() }
    catch (error) { report.errors.push(`Browser cleanup: ${String(error.message).slice(0, 1900)}`); process.exitCode = 1 }
  }
  report.finishedAt = new Date().toISOString()
  const directory = resolve(import.meta.dirname, '../reports/root-cause-2026-09-05')
  await mkdir(directory, { recursive: true })
  const output = resolve(directory, `public-structured-browser-${report.startedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({ output, ...report }, null, 2))
}
