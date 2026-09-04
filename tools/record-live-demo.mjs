import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { launchTestBrowser } from './browser-runtime.mjs'

const root = process.cwd()
const baseUrl = process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:5173/'
const outputDir = path.join(root, 'docs', 'demo-video')
const rawVideo = path.join(outputDir, 'NiyamLens_Live_Prototype_Walkthrough.raw.webm')
const timelinePath = path.join(outputDir, 'narration-timeline.json')
const realPanels = [
  path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels', '8901262260121', '6.jpg'),
  path.join(root, 'datasets', 'openfoodfacts-india', 'real-labels', '8901262260121', '10.jpg'),
]

await fs.mkdir(outputDir, { recursive: true })
await Promise.all(realPanels.map(async (file) => {
  await fs.access(file)
}))

const browser = await launchTestBrowser()
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outputDir, size: { width: 1366, height: 768 } },
})
const page = await context.newPage()
const recordingStarted = Date.now()
const timeline = []

page.on('console', (message) => {
  if (message.type() === 'error') console.error(`browser console: ${message.text()}`)
})
page.on('pageerror', (error) => console.error(`browser page: ${error.message}`))

async function installPresentationLayer() {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.dataset.demoLayer = 'true'
    style.textContent = `
      #demo-cursor { position: fixed; z-index: 2147483647; width: 26px; height: 26px; border-radius: 50%; border: 3px solid #f97316; background: rgba(255,255,255,.92); box-shadow: 0 3px 16px rgba(0,0,0,.35); pointer-events: none; transform: translate(-50%,-50%); transition: left .35s ease, top .35s ease, transform .16s ease, background .16s ease; }
      #demo-cursor.clicking { transform: translate(-50%,-50%) scale(.62); background: #f97316; }
      #demo-caption { position: fixed; z-index: 2147483646; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(1040px, calc(100vw - 72px)); padding: 14px 22px; border: 1px solid rgba(255,255,255,.38); border-radius: 15px; background: rgba(8,24,34,.93); color: white; font: 600 18px/1.4 Inter, Arial, sans-serif; text-align: center; box-shadow: 0 12px 42px rgba(0,0,0,.32); backdrop-filter: blur(10px); pointer-events: none; }
      #demo-badge { position: fixed; z-index: 2147483646; right: 22px; top: 18px; padding: 9px 13px; border-radius: 999px; background: #dc2626; color: white; font: 800 12px/1 Inter, Arial, sans-serif; letter-spacing: .12em; box-shadow: 0 6px 22px rgba(0,0,0,.25); pointer-events: none; }
    `
    document.head.appendChild(style)
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.style.left = '50%'
    cursor.style.top = '50%'
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    const badge = document.createElement('div')
    badge.id = 'demo-badge'
    badge.textContent = 'LIVE PROTOTYPE'
    document.body.append(cursor, caption, badge)
  })
}

async function cue(text, holdMs = 5500) {
  timeline.push({ startMs: Date.now() - recordingStarted, text })
  await page.evaluate((value) => {
    const caption = document.querySelector('#demo-caption')
    if (caption) caption.textContent = value
  }, text)
  await page.waitForTimeout(holdMs)
}

async function pointTo(locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) return
  await page.evaluate(({ x, y }) => {
    const cursor = document.querySelector('#demo-cursor')
    if (!cursor) return
    cursor.style.left = `${x}px`
    cursor.style.top = `${y}px`
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await page.waitForTimeout(650)
}

async function visibleClick(locator) {
  await pointTo(locator)
  await page.evaluate(() => document.querySelector('#demo-cursor')?.classList.add('clicking'))
  await page.waitForTimeout(180)
  await locator.click()
  await page.waitForTimeout(220)
  await page.evaluate(() => document.querySelector('#demo-cursor')?.classList.remove('clicking'))
}

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.getByRole('heading', { name: 'From package image to defensible evidence.', exact: true }).waitFor()
await installPresentationLayer()

await cue('NiyamLens is a working local-first inspection console for SIH26034—not a slideshow or a pre-rendered dashboard.', 6500)
await cue('This run starts with two untouched declaration-panel photographs of a real Amul Taaza package from the frozen Open Food Facts benchmark.', 7000)

const uploadButton = page.getByRole('button', { name: /Capture \/ upload package/i })
await pointTo(uploadButton)
await page.locator('input[type="file"]').setInputFiles(realPanels)
await page.getByText(/2 panels ready for OCR/i).waitFor()
await cue('Both originals are now registered as evidence. NiyamLens hashes each original before preprocessing and keeps the panels separate for auditability.', 7000)
let cautionsRecorded = 0
for (const panel of await page.locator('.evidence-strip > button').all()) {
  await panel.click()
  const caution = page.getByRole('button', { name: 'Continue with caution', exact: true })
  if (await caution.count()) { await visibleClick(caution); cautionsRecorded += 1 }
}
if (cautionsRecorded) await cue(`The image heuristic requested review on ${cautionsRecorded} panel${cautionsRecorded === 1 ? '' : 's'}. The officer explicitly recorded “continue with caution,” so that limitation becomes audit evidence instead of being bypassed.`, 7000)

const ocrButton = page.getByRole('button', { name: /Run browser OCR/i })
await visibleClick(ocrButton)
timeline.push({
  startMs: Date.now() - recordingStarted,
  text: 'The OCR is running live inside the browser. No corrected text is pasted into the evidence box, and no real-label transcription is injected.',
})
await page.evaluate(() => {
  const caption = document.querySelector('#demo-caption')
  if (caption) caption.textContent = 'Live browser OCR is processing both real photographs. No corrected text is being pasted.'
})
await page.getByText(/OCR complete across 2 panels/i).waitFor({ timeout: 180000 })
await cue('The engine has finished both real photographs and exposed its reliability score. Imperfect or incomplete evidence is preserved as uncertainty—not silently repaired.', 7500)

const applyContext = page.getByRole('button', { name: /Apply detected context/i })
if (await applyContext.isEnabled()) {
  await visibleClick(applyContext)
  await cue('Detected declarations are mapped into structured fields. Officer-entered interpretation is stored separately and can never overwrite original OCR evidence.', 6500)
}

const evidenceReport = page.getByRole('button', { name: /Evidence report/i })
await visibleClick(evidenceReport)
await page.getByText('EVIDENCE PACKET').waitFor()
await cue('The evidence packet shows the source image, hashes, extracted text, rule checks and review state. A real low-confidence label correctly remains in manual review.', 7500)
await visibleClick(page.getByRole('button', { name: /Close/i }))

await page.getByText('Controlled test packets').click()
await cue('Now a clearly labelled controlled violation fixture is loaded. This validates deterministic rule behavior; it is not presented as a real-label accuracy result.', 7000)
await visibleClick(page.getByRole('button', { name: /Violation packet/i }))
await page.getByText('FLAG', { exact: true }).first().waitFor()
await cue('The rules engine flags missing declarations and typography failures, including panel-area tiers and the one-third character-width rule.', 6500)
await visibleClick(page.getByRole('button', { name: /Evidence report/i }))
await page.getByText('EVIDENCE PACKET').waitFor()
await cue('Every finding is traceable to evidence and a source-encoded rule. The language model is not allowed to decide compliance.', 6000)
await visibleClick(page.getByRole('button', { name: /Close/i }))
await visibleClick(page.getByRole('button', { name: /Finalize inspection/i }))

await visibleClick(page.getByRole('button', { name: /Command view/i }))
await page.getByText('What requires an officer’s attention?').waitFor()
await cue('The command view aggregates sealed inspections and prioritizes officer attention without hiding abstentions or overrides.', 6500)

await visibleClick(page.getByRole('button', { name: /Rule library/i }))
await page.getByText('The law is the source of truth—not the language model.').waitFor()
await cue('The RC4 rule library exposes all seventeen encoded applicability entries, seven boundary regressions, source links and the still-pending external approval register.', 7500)

await visibleClick(page.getByRole('button', { name: /Validation lab/i }))
await page.getByText('Prove accuracy—or label the evidence gap.').waitFor()
await cue('The validation lab keeps synthetic verdict regressions separate from real-photo OCR benchmarks. Current real-photo recall is reported honestly in the release evidence.', 7500)

await visibleClick(page.getByRole('button', { name: /Officer operations/i }))
await page.getByText('Assign, inspect, review and transfer evidence.').waitFor()
await cue('Officer operations demonstrates assignments, role-aware review, supervisor disposition and an append-only audit trail for accountability.', 6500)

await visibleClick(page.getByRole('button', { name: /Blind challenge/i }))
await page.getByText('No canned image. No hidden tuning. One sealed run.').waitFor()
await visibleClick(page.getByRole('button', { name: /Start blind challenge/i }))
await page.locator('.challenge-ribbon').waitFor()
await cue('Blind-challenge mode disables controlled packets and seals the session, so judges can hand the team an unseen package and test the real pipeline live.', 7500)

await cue('This is a deployable decision-support prototype. Production enforcement still requires department legal review, measurement calibration, security approval and a labelled inspector field pilot.', 8500)

const video = page.video()
await context.close()
const savedVideo = await video.path()
await browser.close()
await fs.copyFile(savedVideo, rawVideo)
await fs.writeFile(timelinePath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  durationMs: Date.now() - recordingStarted,
  segments: timeline,
}, null, 2))

console.log(JSON.stringify({ rawVideo, timelinePath, segments: timeline.length }, null, 2))
