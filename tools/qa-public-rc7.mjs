// Read-only public rendering smoke test. No account, password, login or writes.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'
const origin = 'https://niyamlens-sih26034.vercel.app'
const startedAt = new Date().toISOString()
const report = { kind: 'public-RC7-anonymous-Chrome-rendering-only', startedAt, checks: [], errors: [], bundleSha256: null, limitations: ['No sign-in, hosted OCR, private records, email sending or new hosted multi-account validation.'] }
const browser = await launchTestBrowser()
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('response', async response => {
    if (new URL(response.url()).origin === origin && new URL(response.url()).pathname === '/assets/index-DLqs9TZ3.js') report.bundleSha256 = createHash('sha256').update(await response.body()).digest('hex')
  })
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sign in securely', exact: true }).waitFor()
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), '')
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '')
  assert.equal(report.bundleSha256, 'eeece0a1ea4ecca198329f1629b2e8c2b0b401be8d0a0519874d817cdbc170ea')
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    assert.equal(await page.getByRole('button', { name: 'Sign in securely', exact: true }).isVisible(), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    report.checks.push(`signed-out ${viewport.width}px login renders without horizontal overflow`)
  }
  assert.deepEqual(report.errors, [])
} catch (error) { report.errors.push(error.message); process.exitCode = 1 }
finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  await mkdir('reports/rc7-release-2026-09-05', { recursive: true })
  const output = `reports/rc7-release-2026-09-05/public-chrome-${startedAt.replace(/[:.]/g, '-')}.json`
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output, ...report }, null, 2))
}
