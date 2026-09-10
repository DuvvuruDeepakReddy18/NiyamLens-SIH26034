import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { BLIND_CHALLENGE_ENABLED } from '../src/lib/features.mjs'

test('blind challenge is hidden reversibly; no destructive migration replaces its implementation', async () => {
  assert.equal(BLIND_CHALLENGE_ENABLED, false)
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  assert.match(source, /function BlindChallengePage\(/)
  assert.match(source, /function ChallengeClock\(/)
  assert.match(source, /filter\(item => item.id !== 'challenge' \|\| BLIND_CHALLENGE_ENABLED\)/)
  assert.match(source, /challenge=\{BLIND_CHALLENGE_ENABLED && challenge\?\.active \? challenge : null\}/)
  assert.match(source, /BLIND_CHALLENGE_ENABLED && route === 'challenge'/)
  assert.match(source, /if \(!BLIND_CHALLENGE_ENABLED\) return\s+if \(challenge\) localStorage.setItem/)
  assert.match(source, /challengeId: challenge\?\.id \|\| draftChallengeId \|\| null/)
  assert.match(source, /setDraftChallengeId\(restored.challengeId \|\| null\)/)
  assert.match(source, /sourceChallengeId: draftChallengeId/)
  const trust = await readFile(new URL('../src/SystemTrust.jsx', import.meta.url), 'utf8')
  assert.match(trust, /BLIND_CHALLENGE_ENABLED && <button[^\r\n]+?onNavigate\('challenge'\)/)
})
