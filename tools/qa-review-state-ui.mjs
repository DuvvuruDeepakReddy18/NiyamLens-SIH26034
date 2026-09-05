// Isolated React-component browser regression with synthetic props, not an OCR,
// physical-officer, hosted-account, or complete-app acceptance test.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { launchTestBrowser } from './browser-runtime.mjs'

const origin = new URL(process.env.NIYAMLENS_BASE_URL || 'http://127.0.0.1:4191').origin
if (!['http://127.0.0.1:4191', 'http://localhost:4191'].includes(origin)) throw new Error('This component fixture requires the local development server on port 4191.')
const startedAt = new Date().toISOString()
const files = ['src/PlacementReview.jsx', 'src/lib/placementReviewState.mjs', 'src/InspectionClarity.jsx', 'src/lib/inspectionPresentation.mjs', 'src/lib/captureCoach.mjs']
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])) )
const report = { kind: 'synthetic-React-component-Chrome-regression-NOT-OCR-OR-FIELD-VALIDATION', startedAt, sourceHashes: await hashes(), checks: [], errors: [] }
const browser = await launchTestBrowser()
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (report.errors.push('EXTERNAL_REQUEST_BLOCKED'), route.abort()))
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDom } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: PlacementReview } = await import('/src/PlacementReview.jsx')
    const { InspectionProgress, EvidenceTracePanel } = await import('/src/InspectionClarity.jsx')
    document.getElementById('root').hidden = true
    const fixture = document.createElement('main'); fixture.id = 'review-state-fixture'; document.body.append(fixture)
    const h = React.createElement
    function Fixture() {
      const [value, setValue] = React.useState('40.00')
      const [invalid, setInvalid] = React.useState(false)
      const [meta, setMeta] = React.useState({ classificationConfirmed: true,
        fieldReviews: { mrp: { value: '40.00', state: 'confirmed', reason: 'Synthetic component fixture source checked.' } },
        placementReviews: { mrp: { value: '40.00', state: 'outside_pdp', panelId: 'synthetic-panel', reason: 'Synthetic rear panel placement observation.' } },
      })
      const field = { id: 'mrp', label: 'MRP', detected: true, value, validation: { status: invalid ? 'invalid' : 'valid' } }
      const extraction = { fields: [field], byId: { mrp: field }, raw: `MRP Rs ${value}` }
      const result = { checks: [{ id: 'mrp', rule: 'Synthetic check', status: 'review' }], context: {} }
      const evidenceItems = [{ id: 'synthetic-panel', name: 'synthetic component fixture', panelRole: 'front' }]
      return h(React.Fragment, null,
        h('h1', null, 'Synthetic review-state component test'),
        h('button', { onClick: () => setValue('49.00') }, 'Change synthetic reading'),
        h('button', { onClick: () => setMeta(current => ({ ...current, fieldReviews: { mrp: { value, state: 'unreadable', reason: 'Synthetic unreadable observation.' } } })) }, 'Mark synthetic reading unreadable'),
        h('button', { onClick: () => setInvalid(true) }, 'Mark synthetic reading invalid'),
        h(InspectionProgress, { evidenceItems, extraction, meta, result, provenance: { hasRun: false } }),
        h(EvidenceTracePanel, { fieldId: 'mrp', extraction, meta, result, evidenceItems }),
        h(PlacementReview, { extraction, meta, result, evidenceItems, onChange: (key, next) => setMeta(current => ({ ...current, [key]: next })) }),
        h('output', { id: 'review-state-meta' }, JSON.stringify(meta)),
      )
    }
    ReactDom.createRoot(fixture).render(h(Fixture))
  })
  const fixture = page.locator('#review-state-fixture')
  await fixture.getByRole('heading', { name: 'Synthetic review-state component test' }).waitFor()
  await fixture.locator('.placement-review summary').click()
  const placement = fixture.getByRole('combobox', { name: 'MRP placement', exact: true })
  assert.equal(await placement.inputValue(), 'outside_pdp')
  await fixture.getByRole('button', { name: 'Change synthetic reading', exact: true }).click()
  assert.equal(await placement.inputValue(), 'unreviewed')
  await fixture.getByText('Reading changed — reconfirm', { exact: true }).waitFor()
  await fixture.getByLabel('MRP placement note', { exact: true }).fill('Updated synthetic note only; no placement reconfirmation.')
  assert.equal(await placement.inputValue(), 'unreviewed')
  const edited = JSON.parse(await fixture.locator('#review-state-meta').textContent())
  assert.equal(edited.placementReviews.mrp.state, 'unreviewed')
  assert.equal(edited.placementReviews.mrp.value, '49.00')
  report.checks.push('actual React note edit cannot rebind a stale placement decision', 'trace explicitly marks prior field confirmation stale')
  await placement.selectOption('inside_pdp')
  assert.equal(await placement.inputValue(), 'inside_pdp')
  await fixture.getByRole('button', { name: 'Mark synthetic reading unreadable', exact: true }).click()
  await fixture.getByText('Unreadable — retake required', { exact: true }).waitFor()
  assert.match(await fixture.locator('.inspection-progress').innerText(), /0\/1 fields reviewed/)
  report.checks.push('explicit placement reconfirmation remains possible', 'unreadable evidence leaves verification incomplete')
  await fixture.getByRole('button', { name: 'Mark synthetic reading invalid', exact: true }).click()
  assert.equal(await placement.locator('option[value="inside_pdp"]').isDisabled(), true)
  assert.equal(await placement.locator('option[value="outside_pdp"]').isDisabled(), true)
  report.checks.push('invalid reading disables decisive placement choices')
  assert.deepEqual(report.errors, [])
  report.sourceFilesUnchanged = JSON.stringify(report.sourceHashes) === JSON.stringify(await hashes())
  assert.equal(report.sourceFilesUnchanged, true)
} catch (error) { report.errors.push(error.message); process.exitCode = 1 }
finally {
  await browser.close()
  report.finishedAt = new Date().toISOString()
  const directory = resolve('reports/review-state-2026-09-05'); await mkdir(directory, { recursive: true })
  const outputPath = resolve(directory, `component-chrome-${startedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(outputPath, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ outputPath, ...report }, null, 2))
}
