import test from 'node:test'
import assert from 'node:assert/strict'
import { BROWSER_PILOT_MODES, validateBrowserMode, localPilotOrigin, runBrowserPilot } from '../tools/run-browser-field-pilot.mjs'
test('browser pilot accepts only exact registered modes and local preview origins', () => {
  assert.equal(validateBrowserMode(BROWSER_PILOT_MODES['browser-paddle']).manualRoi, false)
  assert.throws(() => validateBrowserMode({ ...BROWSER_PILOT_MODES['browser-standard'], manualRoi: true }), /Register/)
  assert.throws(() => validateBrowserMode({ ...BROWSER_PILOT_MODES['browser-deep'], version: 'best-new-model' }), /Register/)
  assert.equal(localPilotOrigin('http://127.0.0.1:4190/'), 'http://127.0.0.1:4190')
  for (const url of ['https://niyamlens-sih26034.vercel.app/', 'http://user:password@localhost/', 'http://127.0.0.1/?key=secret']) assert.throws(() => localPilotOrigin(url))
})
test('unlabelled/unfrozen input is rejected before browser launch or output creation', async () => {
  await assert.rejects(runBrowserPilot({ manifest: { schemaVersion: 1, kind: 'prospective-field-pilot', state: 'draft' }, output: 'never-created.json' }), /requires|Expected|must/)
})
