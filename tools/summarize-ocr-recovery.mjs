import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const inputPaths = [
  'reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T13-10-08-226Z.json',
  'reports/readiness-2026-09-05/paddle-review-browser-dark-ink-2026-09-05T13-12-41-859Z.json',
  'reports/readiness-2026-09-05/paddle-review-browser-dark-ink-90-2026-09-05T13-17-35-762Z.json',
]
const modes = []
for (const path of inputPaths) {
  const bytes = await readFile(path); const input = JSON.parse(bytes)
  assert.equal(input.execution.status, 'complete'); assert.equal(input.execution.appModuleUnchanged, true)
  assert.equal(input.rows.length, 8); assert.equal(input.humanReviewed, false); assert.equal(input.isHoldout, false)
  for (const row of input.rows) {
    assert.equal(row.error, null); assert.deepEqual(row.blockedRequests, []); assert.deepEqual(row.pageErrors, [])
    assert.equal(row.verification.originalFileSha256, row.sourceSha256)
    assert.equal(row.verification.rawPassSha256, sha(row.rawText))
    assert.equal(row.verification.noTypedCorrection, true); assert.equal(row.verification.fieldReviewsUnconfirmed, true)
  }
  modes.push({ mode: input.execution.retryMode || 'original-colour', report: { path, sha256: sha(bytes) }, appModuleSha256: input.execution.appModule.sha256,
    photos: 8, raw: input.rawScoring.runs.map(({ exactMatchCorrect, exactMatchSamples }) => ({ exactMatchCorrect, exactMatchSamples })), selectedWorking: input.selectedWorkingScoring,
    rows: input.rows.map(row => ({ id: row.sampleId, sourceSha256: row.sourceSha256, rawSha256: sha(row.rawText), workingSha256: sha(row.workingText), selectedSuggestions: row.selectedCount, fields: Object.fromEntries(Object.entries(row.workingFields).map(([id, field]) => [id, { value: field.value, status: field.validation?.status || 'not-detected', conflict: field.conflict }])) })),
  })
}
assert.equal(new Set(modes.map(mode => mode.appModuleSha256)).size, 1)
const workflowPath = 'reports/readiness-2026-09-05/stamp-recovery-ui-2026-09-05T13-21-06-944Z.json'
const workflowBytes = await readFile(workflowPath); const workflow = JSON.parse(workflowBytes)
assert.deepEqual(workflow.errors, []); assert.equal(workflow.checks.length, 6)
const result = { schemaVersion: 1, generatedAt: new Date().toISOString(), purpose: 'Known-development diagnosis, not field accuracy or winner-readiness',
  datasetId: 'niyamlens-critical-fields-v1', humanReviewed: false, isHoldout: false, manifestSha256: sha(await readFile('datasets/critical-fields.v1.json')),
  modes, selectedRegionWorkflow: { path: workflowPath, sha256: sha(workflowBytes), checks: workflow.checks },
  limitations: ['All eight photographs were previously used in development; references are AI-provisional.', 'Checkbox selection is automated test policy, not officer verification. Raw and derived measurements are separate.', 'Modes are alternatives, not additive: choosing the best answer per field using the reference is not a valid combined benchmark.', 'Dark-ink upright mode yields one valid quantity in an excluded/illegible reference slot; it is not scored as a success or true negative.', 'Earlier test-harness failures remain retained: wrong case-sensitive button selector and ambiguous screenshot selector. Third workflow run passes.', 'An initial unrestricted-parallel unit run failed a test-file process; isolated rerun passed and the complete bounded-concurrency run passed 617/617. Cause of the process failure is not established.', 'Independent human labels, physical-package timing, qualified legal/measurement review and general real-label accuracy remain unproven.'],
}
await mkdir('reports/ocr-recovery-2026-09-05', { recursive: true })
await writeFile('reports/ocr-recovery-2026-09-05/evidence.json', JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output: 'reports/ocr-recovery-2026-09-05/evidence.json', modes: modes.map(mode => ({ mode: mode.mode, raw: mode.raw, selectedWorking: mode.selectedWorking.exactCandidateMatches })), workflowChecks: workflow.checks.length }))
