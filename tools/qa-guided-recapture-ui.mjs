// Real browser clicks, file picker and capture pipeline; SYNTHETIC mechanics
// only. The close-ups below are generated from the existing labelled fixture,
// not independent physical photographs or a recognition-accuracy benchmark.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { launchTestBrowser } from './browser-runtime.mjs'
import { localPilotOrigin } from './run-browser-field-pilot.mjs'
import { verifyAuditChain } from '../src/lib/audit.mjs'
import { validateOcrHistory } from '../src/lib/ocrHistory.mjs'

const origin = localPilotOrigin(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4195/')
const directory = resolve('reports/guided-recapture-2026-09-06')
const startedAt = new Date().toISOString(), stamp = startedAt.replace(/[:.]/g, '-')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sourcePath = resolve('public/sample-real-label.png')
const original = await readFile(sourcePath), originalSha256 = sha(original)
const metadata = await sharp(original).metadata()
const sourcePaths = ['src/App.jsx', 'src/CaptureCoach.jsx', 'src/PaddleStampRecovery.jsx', 'src/FieldVerification.jsx', 'src/paddle-review.css', 'src/capture-coach.css', 'src/workspace.css', 'src/lib/captureCoach.mjs', 'src/lib/paddleRetryInput.mjs', 'src/lib/paddleOcr.mjs']
const fingerprint = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async name => [name, sha(await readFile(name))])) )
const beforeSources = await fingerprint()
const report = { schemaVersion: 1, kind: 'actual-Chromium-guided-recapture-SYNTHETIC-WORKFLOW-NOT-ACCURACY', startedAt, finishedAt: null, origin, originalSha256, sourceHashes: beforeSources, sourceFilesUnchanged: null,
  checks: [], captures: [], errors: [], screenshots: [], limitations: ['Generated package fixture and software-cropped close-ups, not real independently photographed packages.', 'Real browser OCR is run once solely to test preservation; no recognition-accuracy or generalization claim.', 'File chooser is exercised by an isolated browser automation session, not a new human participant.', 'No typed correction, field confirmation, cloud upload, hosted authentication, legal verdict or physical measurement.'] }
await mkdir(directory, { recursive: true })
const browser = await launchTestBrowser()
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.errors.push(`EXTERNAL_REQUEST_BLOCKED:${new URL(route.request().url()).origin}`), route.abort()))
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => report.errors.push(error.message))
  const pickerUpload = async (button, files) => {
    const chooserReady = page.waitForEvent('filechooser')
    await button.click()
    const chooser = await chooserReady
    await chooser.setFiles(files)
  }
  const readDraft = () => page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('niyamlens-evidence-v1', 2)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('drafts', 'readonly'), get = tx.objectStore('drafts').get('active')
      get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close()
    }
  }))
  const awaitDraft = async predicate => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const draft = await readDraft()
      if (draft && predicate(draft)) return draft
      await page.waitForTimeout(100)
    }
    throw new Error('Auto-saved draft did not contain the completed UI action.')
  }
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.getByText('Local workspace', { exact: true }).waitFor()
  await pickerUpload(page.getByRole('button', { name: 'Capture / upload package', exact: true }), sourcePath)
  await page.getByText(/1 panel ready for OCR/i).waitFor()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) { await caution.click(); report.checks.push('Synthetic initial quality caution explicitly acknowledged by test policy') }
  await page.getByRole('button', { name: 'Run browser OCR', exact: true }).click()
  await page.getByText(/OCR complete across/i).waitFor({ timeout: 180000 })
  const initial = await awaitDraft(draft => draft.evidenceItems?.length === 1 && draft.evidenceItems[0].ocrPasses?.length > 0)
  assert.equal(initial.evidenceItems[0].sha256, originalSha256)
  assert.ok(initial.rawOcrText.trim())
  validateOcrHistory(initial.evidenceItems)
  assert.equal(await verifyAuditChain(initial.auditChain), true)
  const oldPanel = initial.evidenceItems[0]
  const initialReading = { text: initial.text, rawOcrText: initial.rawOcrText, ocrPasses: oldPanel.ocrPasses, ocrWords: oldPanel.ocrWords, originalUrl: oldPanel.originalUrl, analysisUrl: oldPanel.analysisUrl }
  report.initialReading = { provider: oldPanel.ocrPasses.map(pass => pass.provider), rawPassCount: oldPanel.ocrPasses.length, rawSha256: sha(initial.rawOcrText), workingSha256: sha(initial.text) }
  report.checks.push('Original uploaded through a button-triggered picker and scanned by real browser OCR; no transcript typed')
  const coach = page.getByRole('region', { name: 'Capture guidance', exact: true })
  for (const [target, label, y] of [['mrp', 'MRP', .245], ['netQuantity', 'Net quantity', .303], ['packDate', 'Pack date', .36]]) {
    const crop = { left: Math.floor(metadata.width * .09), top: Math.floor(metadata.height * y), width: Math.floor(metadata.width * .82), height: Math.floor(metadata.height * .09) }
    const buffer = await sharp(original).extract(crop).resize({ width: 1640 }).png().toBuffer()
    const file = { name: `SYNTHETIC-${target}-close-up.png`, mimeType: 'image/png', buffer }
    const expectedCount = report.captures.length + 2
    const existingPanelIds = expectedCount === 2 ? [oldPanel.id] : report.latestPanelIds
    assert.equal(await coach.getByRole('button', { name: `Add ${label} close-up photo`, exact: true }).isEnabled(), true)
    await pickerUpload(coach.getByRole('button', { name: `Add ${label} close-up photo`, exact: true }), file)
    await page.getByText('Close-up panel ready for OCR; previous photographs and readings retained. Read the new photo and review any conflict.', { exact: true }).waitFor()
    // Capture quality is a per-panel gate. Acknowledging only the fourth image
    // must not bypass warnings attached to the second or third image.
    const acknowledgedSyntheticQualityCaution = await caution.count() > 0
    if (acknowledgedSyntheticQualityCaution) await caution.click()
    const draft = await awaitDraft(draft => draft.evidenceItems?.length === expectedCount && draft.auditChain?.some(event => event.type === 'evidence_captured' && event.payload.capturePurpose?.target === target))
    const currentOriginal = draft.evidenceItems.find(panel => panel.id === oldPanel.id)
    assert.ok(currentOriginal)
    assert.equal(currentOriginal.sha256, originalSha256)
    assert.deepEqual({ text: draft.text, rawOcrText: draft.rawOcrText, ocrPasses: currentOriginal.ocrPasses, ocrWords: currentOriginal.ocrWords, originalUrl: currentOriginal.originalUrl, analysisUrl: currentOriginal.analysisUrl }, initialReading)
    assert.deepEqual(draft.evidenceItems.slice(0, -1).map(panel => panel.id), existingPanelIds)
    const added = draft.evidenceItems.at(-1), event = draft.auditChain.find(event => event.type === 'evidence_captured' && event.payload.id === added.id)
    assert.equal(added.sha256, sha(buffer))
    assert.notEqual(added.sha256, originalSha256)
    assert.equal(added.ocrPasses?.length || 0, 0)
    assert.equal(added.ocrText || '', '')
    assert.deepEqual(event.payload.capturePurpose, { target, kind: 'officer-requested-additional-close-up', originalEvidencePreserved: true, suppliesOcrAnswer: false })
    assert.equal(Object.hasOwn(event.payload, 'value'), false)
    assert.equal(draft.auditChain.some(event => event.type === 'evidence_replaced_before_seal'), false)
    assert.equal(draft.auditChain.filter(event => event.type === 'ocr_completed').length, initial.auditChain.filter(event => event.type === 'ocr_completed').length)
    assert.ok(Object.values(draft.meta.fieldReviews || {}).every(review => review.state !== 'confirmed'))
    assert.equal(await verifyAuditChain(draft.auditChain), true)
    validateOcrHistory(draft.evidenceItems)
    report.latestPanelIds = draft.evidenceItems.map(panel => panel.id)
    report.captures.push({ target, fileName: file.name, fixtureCrop: crop, sha256: added.sha256, evidenceId: added.id, panelCount: draft.evidenceItems.length, capturePurpose: event.payload.capturePurpose, oldOriginalAndRawPreserved: true, newPanelHasOcrAnswer: false, auditChainValid: true, acknowledgedSyntheticQualityCaution })
  }
  report.checks.push('All three guided buttons open the file chooser and add independently hashed files; originals, raw passes and prior panel IDs remain unchanged')
  for (const label of ['MRP', 'Net quantity', 'Pack date']) assert.equal(await coach.getByRole('button', { name: `Add ${label} close-up photo`, exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Add package panel (4/4)', exact: true }).isDisabled(), true)
  await coach.getByText(/All four image slots are in use/).waitFor()
  report.checks.push('Four-panel capacity disables every guided capture and general upload button; retention warning is visible')
  await coach.getByRole('button', { name: 'Select Pack date region', exact: true }).click()
  await page.getByText('Select opposite corners around the complete declaration, including its heading', { exact: true }).waitFor()
  const layer = page.locator('.image-layer'), box = await layer.boundingBox()
  assert.ok(box && box.width > 0 && box.height > 0)
  await layer.click({ position: { x: box.width * .03, y: box.height * .03 } })
  await layer.click({ position: { x: box.width * .97, y: box.height * .97 } })
  const focusCard = page.getByRole('region', { name: 'Focused OCR rescan', exact: true })
  await focusCard.waitFor()
  await focusCard.getByText('Recover this selected stamp', { exact: true }).click()
  const direction = focusCard.getByLabel('Selected stamp recovery direction', { exact: true })
  const options = await direction.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })))
  assert.deepEqual(options, [
    { value: 'dark-ink', text: 'Already upright' },
    { value: 'dark-ink-90', text: 'Turn 90° clockwise' },
    { value: 'dark-ink-180', text: 'Turn 180° · upside down' },
    { value: 'dark-ink-270', text: 'Turn 270° clockwise · 90° anticlockwise' },
  ])
  if (await caution.count()) await caution.click()
  for (const option of options) { await direction.selectOption(option.value); assert.equal(await direction.inputValue(), option.value) }
  report.stampOptions = options
  report.checks.push('Real two-corner selected-region controls expose and accept all four named stamp directions; no additional recognition was triggered')
  const desktop = resolve(directory, `selected-stamp-desktop-${stamp}.png`)
  await focusCard.screenshot({ path: desktop }); report.screenshots.push(desktop)
  report.mobileLayouts = []
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      overflowingElements: [...document.querySelectorAll('body *')].filter(node => {
        const rect = node.getBoundingClientRect()
        if (!rect.width || rect.right <= innerWidth + 1) return false
        for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX) && ancestor.getBoundingClientRect().right <= innerWidth + 1) return false
        }
        return true
      }).slice(0, 25).map(node => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return { tag: node.tagName, className: typeof node.className === 'string' ? node.className : '', label: node.getAttribute('aria-label'), left: rect.left, right: rect.right, width: rect.width, minWidth: style.minWidth, overflowX: style.overflowX } }) }))
    layout.targetButtonsFit = await coach.locator('button').evaluateAll(buttons => buttons.every(button => { const b = button.getBoundingClientRect(), parent = button.parentElement.getBoundingClientRect(); return b.left >= parent.left - 1 && b.right <= parent.right + 1 }))
    layout.stampDirectionFits = await direction.evaluate(node => { const b = node.getBoundingClientRect(), card = node.closest('.paddle-stamp-recovery').getBoundingClientRect(); return b.left >= card.left - 1 && b.right <= card.right + 1 })
    report.mobileLayouts.push(layout)
    const mobile = resolve(directory, `guided-capture-${width}px-${stamp}.png`)
    await coach.screenshot({ path: mobile }); report.screenshots.push(mobile)
    const mobileStamp = resolve(directory, `selected-stamp-${width}px-${stamp}.png`)
    await focusCard.screenshot({ path: mobileStamp }); report.screenshots.push(mobileStamp)
    assert.equal(layout.overflow, false, `Mobile page overflow: ${JSON.stringify(layout)}`)
    assert.equal(layout.targetButtonsFit, true, `Long guided capture buttons overflow at ${width}px`)
    assert.equal(layout.stampDirectionFits, true, `Stamp direction selector overflows its card at ${width}px`)
  }
  report.checks.push('Guided capture buttons and selected-stamp controls fit their cards without document overflow at both 320px and 390px')
  assert.deepEqual(report.errors, [])
  const afterSources = await fingerprint()
  report.afterSourceHashes = afterSources
  report.sourceFilesUnchanged = JSON.stringify(beforeSources) === JSON.stringify(afterSources)
  assert.equal(report.sourceFilesUnchanged, true, 'Source changed during browser run; rerun for source-bound evidence.')
} catch (error) {
  report.errors.push(error.stack || error.message)
  process.exitCode = 1
} finally {
  await browser.close()
  report.afterSourceHashes = await fingerprint()
  report.sourceFilesUnchanged = JSON.stringify(beforeSources) === JSON.stringify(report.afterSourceHashes)
  if (!report.sourceFilesUnchanged) { report.errors.push('Tracked application sources changed during the run; rerun for source-bound evidence.'); process.exitCode = 1 }
  report.finishedAt = new Date().toISOString()
  const output = resolve(directory, `guided-recapture-${stamp}.json`)
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output, checks: report.checks, captures: report.captures.length, errors: report.errors, sourceFilesUnchanged: report.sourceFilesUnchanged }, null, 2))
}
