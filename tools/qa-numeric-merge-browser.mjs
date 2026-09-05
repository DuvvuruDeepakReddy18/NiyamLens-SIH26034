// Known-development diagnostic: real Chrome OCR, then compare old/new merge
// algorithms on exactly the same retained raw passes. This is not new accuracy.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchTestBrowser } from './browser-runtime.mjs'
import { localPilotOrigin } from './run-browser-field-pilot.mjs'
import { mergeOcrPassTexts } from '../src/lib/vision.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4195/')
const hash = value => createHash('sha256').update(value).digest('hex')
// Pin the observed pre-fix release: comparing against moving HEAD would turn
// this into a misleading new-vs-new comparison after the fix is committed.
const baselineCommit = 'a8d4fff2323df8ea04ca7b2f021b8128faba076f'
const oldSource = execFileSync('git', ['show', `${baselineCommit}:src/lib/vision.mjs`], { cwd: root, encoding: 'utf8' })
const oldMerge = (await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`)).mergeOcrPassTexts
const visionBytes = await readFile(resolve(root, 'src/lib/vision.mjs'))
const manifestBytes = await readFile(resolve(root, 'datasets/critical-fields.v1.json'))
const manifest = JSON.parse(manifestBytes)
assert.equal(manifest.isHoldout, false)
const samples = manifest.samples.filter(sample => ['CF-005', 'CF-006', 'CF-007'].includes(sample.id))
assert.equal(samples.length, 3)
const startedAt = new Date().toISOString()
const report = { kind: 'real-Chrome-Tesseract-identical-raw-pass-merge-ablation', startedAt, finishedAt: null, baselineCommit,
  baselineMergeSourceSha256: hash(oldSource), currentMergeSourceSha256: hash(visionBytes), manifestSha256: hash(manifestBytes),
  origin, isHoldout: false, humanReviewed: false, accuracyClaim: null,
  policy: 'Actual upload and standard Tesseract OCR on fixed development photos. Old/new merge replay uses the exact same raw observations from this new run, not a historical OCR comparison. No typed corrections, answer lookup, crop or field confirmation.', rows: [] }
let browser
try {
  browser = await launchTestBrowser()
  for (const sample of samples) {
    const bytes = await readFile(resolve(root, sample.sourcePath))
    assert.equal(hash(bytes), sample.sha256)
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
    const blocked = []; const errors = []
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.origin === origin) return route.continue()
      blocked.push(`${url.origin}${url.pathname}`); return route.abort()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const row = { sampleId: sample.id, sourceSha256: sample.sha256, error: null }
    try {
      await page.goto(`${origin}/`, { waitUntil: 'networkidle' })
      await page.getByText('Local workspace', { exact: true }).waitFor()
      await page.locator('input[type="file"]').setInputFiles(resolve(root, sample.sourcePath))
      await page.getByText(/panel ready for OCR/i).waitFor({ timeout: 30000 })
      const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
      row.qualityCaution = await caution.count() > 0
      if (row.qualityCaution) await caution.click()
      const run = page.getByRole('button', { name: 'Run browser OCR', exact: true })
      if (!await run.isVisible()) await page.getByText('More OCR options', { exact: true }).click()
      await run.click()
      await page.getByText(/OCR complete across/i).waitFor({ timeout: 240000 })
      row.workingText = await page.locator('.evidence-editor').inputValue()
      await page.waitForTimeout(1200)
      const saved = await page.evaluate(async () => {
        const draft = await new Promise((resolve, reject) => {
          const opening = indexedDB.open('niyamlens-evidence-v1', 2)
          opening.onerror = () => reject(opening.error)
          opening.onsuccess = () => {
            const db = opening.result; const tx = db.transaction('drafts', 'readonly'); const request = tx.objectStore('drafts').get('active')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
            tx.oncomplete = () => db.close()
          }
        })
        return { text: draft.text, rawText: draft.rawOcrText, panel: { sha256: draft.evidenceItems[0].sha256, ocrText: draft.evidenceItems[0].ocrText, passes: draft.evidenceItems[0].ocrPasses }, fieldReviews: draft.meta.fieldReviews || {} }
      })
      assert.equal(saved.panel.sha256, sample.sha256)
      assert.equal(saved.text, row.workingText)
      assert.equal(saved.rawText, saved.text)
      assert.equal(saved.panel.passes.length, 3)
      assert.ok(Object.values(saved.fieldReviews).every(review => review.state !== 'confirmed'))
      row.rawPasses = saved.panel.passes
      const passes = row.rawPasses.map(pass => pass.text)
      row.oldAlgorithmMerged = oldMerge(passes)
      row.currentMerged = mergeOcrPassTexts(passes)
      assert.equal(row.currentMerged, saved.panel.ocrText)
      const oldLines = new Set(row.oldAlgorithmMerged.split('\n'))
      row.retainedPreviouslyAbsentLines = row.currentMerged.split('\n').filter(line => !oldLines.has(line))
      row.restoredShortNumericFragments = row.retainedPreviouslyAbsentLines.filter(line => /\d/.test(line) && line.length <= 3)
      row.rawPassSha256 = row.rawPasses.map(pass => ({ id: pass.id, sha256: hash(pass.text) }))
      assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
      row.fieldConfirmationsRemainUnset = true
    } catch (error) { row.error = error.message; process.exitCode = 1 }
    finally { await context.close() }
    row.pageErrors = errors; row.blockedRequests = blocked
    report.rows.push(row)
    console.log(JSON.stringify({ sampleId: row.sampleId, restoredShortNumericFragments: row.restoredShortNumericFragments, extraRetainedLines: row.retainedPreviouslyAbsentLines?.length, error: row.error }))
  }
} finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  report.mergeSourceUnchangedDuringRun = hash(await readFile(resolve(root, 'src/lib/vision.mjs'))) === report.currentMergeSourceSha256
  if (!report.mergeSourceUnchangedDuringRun) process.exitCode = 1
  const directory = resolve(root, 'reports/root-cause-2026-09-05')
  await mkdir(directory, { recursive: true })
  const path = resolve(directory, `numeric-merge-browser-${startedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  console.log(JSON.stringify({ outputPath: path, successful: report.rows.filter(row => !row.error).length, planned: 3, mergeSourceUnchangedDuringRun: report.mergeSourceUnchangedDuringRun }))
}
