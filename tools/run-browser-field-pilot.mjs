import { open } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchTestBrowser } from './browser-runtime.mjs'
import { readBoundedFile } from './verify-cloud-export.mjs'
import { verifyPilotFiles, recordPilotObservation, pilotHash } from './field-pilot.mjs'
import { validatePilotManifest } from '../src/lib/fieldPilot.mjs'

// Register these exact configurations BEFORE labels are frozen. Guided/manual
// crops are a different study arm and are intentionally not automated here.
export const BROWSER_PILOT_MODES = Object.freeze({
  'browser-standard': { id: 'browser-standard', engine: 'tesseract.js', version: '7.0.0/bundled-fast', configuration: 'English; default three-pass browser preprocessing; no manual crop, rotation, edits or pass selection', manualRoi: false },
  'browser-deep': { id: 'browser-deep', engine: 'tesseract.js', version: '7.0.0/bundled-fast', configuration: 'English; deep browser preprocessing and tiles; no manual crop, rotation, edits or pass selection', manualRoi: false },
  'browser-paddle': { id: 'browser-paddle', engine: 'paddleocr-js', version: 'PP-OCRv6_small@0.4.2', configuration: 'Bundled fixed PP-OCRv6 small; full-image raw preview; no reviewed reading-order suggestions or manual crop', manualRoi: false },
})
export function validateBrowserMode(mode) {
  const expected = BROWSER_PILOT_MODES[mode?.id]
  if (!expected || Object.entries(expected).some(([key, value]) => mode[key] !== value)) throw new Error('Register an exact supported browser mode before freeze; do not change configurations after seeing results.')
  return expected
}
export function localPilotOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a dedicated local preview origin; hosted operational accounts are not used by this runner.')
  return url.origin
}

export async function recognizeThroughUi(page, imagePath, mode, baseUrl) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 })
  await page.getByText('Local workspace', { exact: true }).waitFor({ timeout: 15000 })
  await page.locator('input[type="file"]').setInputFiles(imagePath)
  await page.getByText(/panel ready for OCR/i).waitFor({ timeout: 30000 })
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  const qualityCaution = await caution.count() > 0
  if (qualityCaution) await caution.click() // Evaluation policy, not a human quality attestation.
  if (mode !== 'browser-standard') await page.getByText('More OCR options', { exact: true }).click()
  const done = mode === 'browser-paddle' ? page.getByRole('region', { name: 'Paddle OCR preview' }) : page.getByText(mode === 'browser-deep' ? /Deep scan complete across/i : /OCR complete across/i)
  await page.getByRole('button', { name: mode === 'browser-standard' ? 'Run browser OCR' : mode === 'browser-deep' ? 'Deep scan small text' : 'Try Paddle OCR · local', exact: true }).click()
  const outcome = await Promise.race([
    done.waitFor({ timeout: 245000 }).then(() => 'complete'),
    page.locator('.ocr-progress small').filter({ hasText: /failed|unable|timed out|cancelled/i }).waitFor({ timeout: 245000 }).then(() => 'failed'),
  ])
  if (outcome !== 'complete') throw new Error('OCR_RUN_FAILED')
  const rawText = mode === 'browser-paddle' ? await page.locator('.paddle-review details > pre').first().innerText() : await page.locator('.evidence-editor').inputValue()
  if (rawText.length > 100000) throw new Error('OCR_TEXT_EXCEEDS_LIMIT')
  const editor = await page.locator('.evidence-editor').inputValue()
  if (mode === 'browser-paddle' && editor !== '') throw new Error('PADDLE_PREVIEW_WAS_NOT_RAW')
  return { rawText, qualityCaution, manuallyEdited: false }
}

export async function runBrowserPilot({ manifest, photoRoot, mode, baseUrl, output, root = resolve(dirname(fileURLToPath(import.meta.url)), '..') }) {
  validatePilotManifest(manifest, { requireFrozen: true })
  validateBrowserMode(manifest.modes.find(item => item.id === mode))
  const origin = localPilotOrigin(baseUrl)
  // No browser starts and no holdout image is exposed before all human-label,
  // freeze, inventory and original-byte checks succeed.
  await verifyPilotFiles(manifest, { root, photoRoot })
  const file = await open(output, 'wx')
  let browser
  let result = { schemaVersion: 1, kind: 'field-pilot-ocr-runs', datasetId: manifest.datasetId, freezeSha256: manifest.freeze.payloadSha256, rows: [], execution: { runner: 'actual-Chrome-UI', mode, origin, appBundleSha256: null, qualityPolicy: 'Runner proceeds on every image-quality warning; not a human quality attestation.', status: 'running', humanCorrectionsApplied: false } }
  const checkpoint = async () => { await file.truncate(0); await file.write(`${JSON.stringify(result, null, 2)}\n`, 0, 'utf8'); await file.sync() }
  try {
    await checkpoint()
    browser = await launchTestBrowser()
    for (const sample of manifest.samples) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        return url.origin === origin ? route.continue() : route.abort()
      })
      const page = await context.newPage()
      let pageFailed = false
      page.on('pageerror', () => { pageFailed = true })
      page.on('response', async response => {
        if (/\/assets\/index-[^/]+\.js$/.test(new URL(response.url()).pathname) && !result.execution.appBundleSha256) {
          try { result.execution.appBundleSha256 = pilotHash(await response.body()) } catch { /* inability to fingerprint is stated in output */ }
        }
      })
      const startedAt = new Date().toISOString()
      let rawText = ''; let error = null; let qualityCaution = null
      try {
        const observed = await recognizeThroughUi(page, resolve(photoRoot, sample.sourcePath), mode, `${origin}/`)
        if (pageFailed) throw new Error('BROWSER_PAGE_ERROR')
        rawText = observed.rawText; qualityCaution = observed.qualityCaution
      } catch (issue) { error = issue.message === 'BROWSER_PAGE_ERROR' ? issue.message : 'BROWSER_OCR_FAILED_OR_TIMED_OUT' }
      finally { await context.close() }
      const observation = { sampleId: sample.id, mode, sourceSha256: sample.sha256, rawText, error, startedAt, finishedAt: new Date().toISOString(), manuallyEdited: false, transcriptKind: 'raw-ocr-unedited', qualityCaution, review: null }
      result = recordPilotObservation(manifest, observation, result)
      await checkpoint()
      console.log(`${sample.id}: ${error ? 'failed (retained)' : 'raw output recorded'}; no correctness result inferred`)
    }
    result.execution.status = 'complete'; await checkpoint()
    return result
  } finally { await browser?.close(); await file.close() }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--modes')) { console.log(JSON.stringify(Object.values(BROWSER_PILOT_MODES), null, 2)); return }
  if (!args.includes('--run')) throw new Error('Explicit --run required. Use --modes to print pre-registration configurations.')
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run') continue
    if (!['--manifest', '--photo-root', '--mode', '--base-url', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) throw new Error('Invalid or duplicated argument.')
    options[args[i]] = args[++i]
  }
  if (Object.keys(options).length !== 5) throw new Error('Required: --manifest FROZEN.json --photo-root PHOTOS --mode REGISTERED-MODE --base-url http://127.0.0.1:4191/ --output NEW-RUNS.json')
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedFile(options['--manifest'], 20_000_000)))
  await runBrowserPilot({ manifest, photoRoot: resolve(options['--photo-root']), mode: options['--mode'], baseUrl: options['--base-url'], output: resolve(options['--output']) })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
