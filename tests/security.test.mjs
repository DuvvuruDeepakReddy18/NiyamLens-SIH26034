import test from 'node:test'
import assert from 'node:assert/strict'
import { appendAuditEvent, verifyAuditChain } from '../src/lib/audit.mjs'
import { decryptBundle, encryptBundle } from '../src/lib/secureBundle.mjs'

test('audit chain verifies and exposes tampering', async () => {
  let chain = await appendAuditEvent([], 'inspection_started', { id: 'TEST-01' }, 'officer-01')
  chain = await appendAuditEvent(chain, 'evidence_captured', { sha256: 'abc123' }, 'officer-01')
  assert.equal(await verifyAuditChain(chain), true)

  const tampered = structuredClone(chain)
  tampered[0].payload.id = 'REWRITTEN'
  assert.equal(await verifyAuditChain(tampered), false)
})

test('encrypted evidence bundle round-trips and rejects the wrong passphrase', async () => {
  const source = { id: 'NLM-TEST-01', result: { status: 'manual_review' }, evidence: ['hash-01'] }
  const bundle = await encryptBundle(source, 'field-passphrase')
  assert.equal(bundle.format, 'niyamlens-secure-bundle-v2')
  assert.deepEqual(await decryptBundle(bundle, 'field-passphrase'), source)
  await assert.rejects(() => decryptBundle(bundle, 'incorrect-passphrase'))
})

test('large evidence bundles encrypt without a spread-argument overflow', async () => {
  const source = { id: 'NLM-LARGE', imageUrl: 'x'.repeat(500_000) }
  const bundle = await encryptBundle(source, 'large-field-passphrase')
  assert.deepEqual(await decryptBundle(bundle, 'large-field-passphrase'), source)
})

test('short passphrases are rejected before encryption', async () => {
  await assert.rejects(() => encryptBundle({ id: 1 }, 'short'), /at least 8/i)
})
