import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { launchTestBrowser } from './browser-runtime.mjs'
import { validateStudy, scoreWorkflowStudy } from '../src/lib/workflowStudy.mjs'
const browser = await launchTestBrowser()
const html = await readFile('docs/validation-kit/observer.html', 'utf8')
try {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  // Serve the exact observer document in an isolated, synthetic test origin.
  await page.route('http://127.0.0.1:4399/**', route => route.fulfill({ contentType: 'text/html', body: html }))
  await page.goto('http://127.0.0.1:4399/')
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.locator('#participant').fill('TESTP01'); await page.locator('#package').fill('TESTPKG01')
  await page.locator('#start').click()
  await page.locator('#stage').selectOption('read_or_transcribe')
  await page.locator('#finish').click()
  assert.equal(await page.locator('#history li').count(), 0, 'Missing outcome must not create an observation.')
  await page.locator('#corrections').fill('2'); await page.locator('#outcome').selectOption('failed')
  await page.locator('#finish').click()
  assert.equal(await page.locator('#history li').count(), 0, 'Failure requires a reason.')
  await page.locator('#notes').fill('AUTOMATED SOFTWARE TEST ONLY. No physical participant or package.')
  await page.locator('#finish').click()
  assert.equal(await page.locator('#history li').count(), 1)
  const download = page.waitForEvent('download'); await page.locator('#export').click()
  const result = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  validateStudy(result)
  assert.equal(result.trials.length, 1); assert.equal(result.trials[0].outcome, 'failed')
  assert.equal(result.trials[0].qualityReview, null); assert.equal(result.trials[0].corrections, 2)
  assert.equal(scoreWorkflowStudy(result).medianVerifiedSecondsSaved, null)
  assert.ok(result.trials[0].totalSeconds > 0)
  await page.reload(); assert.equal(await page.locator('#history li').count(), 1)
  await page.evaluate(() => localStorage.setItem('niyamlens-observer-v1', '{broken'))
  await page.reload(); assert.equal(await page.locator('#start').isDisabled(), true)
  assert.equal(await page.evaluate(() => localStorage.getItem('niyamlens-observer-v1')), '{broken')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, syntheticSoftwareTestOnly: true, checks: ['measured-monotonic-stage-durations', 'incomplete-attempt-not-saved', 'failed-attempt-retained-with-reason', 'export-compatible-with-study-validator', 'no-invented-quality-review-or-time-savings', 'reload-retains-finished-attempt', 'corrupt-storage-preserved-and-blocked'], humanStudyPerformed: false }))
} finally { await browser.close() }
