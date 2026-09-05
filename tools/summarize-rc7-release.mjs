// Compact, create-only evidence index. Original reports/photos remain local.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { RULE_PACK } from '../src/lib/rules.mjs'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const paths = {
  capture: 'reports/capture-first-2026-09-05/chrome-2026-09-05T14-32-51-544Z.json',
  review: 'reports/review-state-2026-09-05/component-chrome-2026-09-05T14-20-29-102Z.json',
  recognition: 'reports/readiness-2026-09-05/paddle-review-browser-2026-09-05T14-32-37-364Z.json',
  rejectedExperiment: 'reports/readiness-2026-09-05/paddle-resolution-focus960-2026-09-05T14-13-39-915Z.json',
}
const inputs = {}
for (const [key, path] of Object.entries(paths)) {
  const bytes = await readFile(path)
  inputs[key] = { path, sha256: hash(bytes), data: JSON.parse(bytes) }
}
for (const key of ['capture', 'review']) {
  assert.deepEqual(inputs[key].data.errors, [])
  // The component runner uses a singular hash-comparison field.
  const data = inputs[key].data
  assert.equal(data.sourceFilesUnchanged ?? data.sourceUnchanged, true)
  for (const [path, digest] of Object.entries(data.sourceHashes)) assert.equal(hash(await readFile(path)), digest, path)
}
const recognition = inputs.recognition.data
assert.equal(recognition.execution.status, 'complete')
assert.equal(recognition.rows.length, 8)
assert.ok(recognition.rows.every(row => !row.error))
assert.equal(recognition.execution.appModule.sha256, inputs.capture.data.appBundleSha256)
assert.equal(RULE_PACK.id, 'LMPC-RC-2026.09-RC7')
const report = {
  release: '0.4.5', rulePack: RULE_PACK.id, createdAt: new Date().toISOString(),
  evidence: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, { path: value.path, sha256: value.sha256 }])),
  localBundleSha256: inputs.capture.data.appBundleSha256,
  capture: { kind: inputs.capture.data.kind, source: inputs.capture.data.source, checks: inputs.capture.data.checks, errors: [], readings: inputs.capture.data.readings.map(row => ({ mode: row.mode, rawTextSha256: hash(row.rawText), characters: row.rawText.length })) },
  review: { kind: inputs.review.data.kind, checks: inputs.review.data.checks, errors: [] },
  recognition: { kind: recognition.kind, photos: 8, raw: recognition.rawScoring.runs.map(run => ({ exact: run.exactMatchCorrect, eligible: run.exactMatchSamples })), selectedWorking: recognition.selectedWorkingScoring, humanReviewed: false, isHoldout: false },
  rejectedExperiment: { kind: inputs.rejectedExperiment.data.kind, profile: 'focus960', derivedPotential: inputs.rejectedExperiment.data.derivedPotential, decision: 'Not enabled automatically: fixed extra crop readings reduce resolved development fields by retaining conflicts.' },
  limitations: ['Known development photos and AI-provisional references only; no blind/general accuracy estimate.', 'Automated layout checkbox selection is test behavior, not officer verification.', 'Component test uses synthetic props; crop workflow uses actual model inference and a real known photo.', 'No human field timing, independent labels, qualified legal/measurement review, or new hosted multi-account test was performed in this release.'],
}
await mkdir('reports/rc7-release-2026-09-05', { recursive: true })
const output = 'reports/rc7-release-2026-09-05/evidence.json'
await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output, release: report.release, raw: report.recognition.raw, selectedWorking: report.recognition.selectedWorking.exactCandidateMatches }))
