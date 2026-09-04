import test from 'node:test'
import assert from 'node:assert/strict'
import { requireMember, quota, HttpError } from '../server/security.mjs'
import { validateCase, hashPayload } from '../server/caseService.mjs'
import { createOcrHandler } from '../api/ocr.js'
import { RULE_PACK } from '../src/lib/rules.mjs'
const org = '12345678-1234-4234-8234-123456789abc'
const fakeClient = (member, user = { id: 'real-user' }) => ({ auth: { getUser: async () => ({ data: { user } }) }, from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: member }) }) })
const req = { headers: { authorization: 'Bearer real-token', 'x-workspace-id': org } }
test('API ignores self-asserted role and derives membership from the verified user', async () => {
  const client = fakeClient({ role: 'officer', active: true })
  await assert.rejects(requireMember({ ...req, body: { role: 'admin' } }, ['supervisor'], client), { status: 403 })
  const result = await requireMember(req, [], client)
  assert.equal(result.user.id, 'real-user'); assert.equal(result.member.role, 'officer')
})
test('missing identity, expired sessions and non-members fail closed', async () => {
  await assert.rejects(requireMember({}, [], fakeClient(null)), { status: 401 })
  await assert.rejects(requireMember(req, [], fakeClient(null)), { status: 403 })
  await assert.rejects(requireMember(req, [], fakeClient(null, null)), { status: 401 })
})
test('provider quota fails closed when exhausted or database is unavailable', async () => {
  await assert.rejects(quota({ org, user: { id: 'u' }, client: { rpc: async () => ({ data: false }) } }, 'ocr'), { status: 429 })
  await assert.rejects(quota({ org, user: { id: 'u' }, client: { rpc: async () => ({ error: new Error('down') }) } }, 'ocr'), { status: 503 })
})
test('connected OCR cannot call the provider without authorized membership', async () => {
  const previous = process.env.GOOGLE_CLOUD_VISION_API_KEY; process.env.GOOGLE_CLOUD_VISION_API_KEY = 'test'
  try {
    const handler = createOcrHandler({ authorize: async () => { throw new HttpError(403, 'Not a member') }, limit: async () => { throw new Error('Should not run') } })
    const res = { setHeader() {}, status(code) { this.code = code; return this }, json(body) { this.body = body } }
    await handler({ method: 'POST', body: {} }, res)
    assert.equal(res.code, 403); assert.match(res.body.error, /member/)
  } finally { if (previous === undefined) delete process.env.GOOGLE_CLOUD_VISION_API_KEY; else process.env.GOOGLE_CLOUD_VISION_API_KEY = previous }
})
const input = { id: 'test-case-123', meta: { quantity: 100, unit: 'g' }, text: 'SHAMPOO', rawOcrText: 'SHAMP00', createdAt: '2026-09-04', sealedAt: '2026-09-04', rulePack: RULE_PACK.id, evidenceItems: [{ id: org, originalPath: 'private/a', analysisPath: 'private/b', sha256: 'a'.repeat(64) }] }
const context = { user: { id: 'real-user', email: 'officer@example.test' }, member: { role: 'officer' } }
test('server recomputes findings and overwrites client-supplied actor and verdict', () => {
  const result = validateCase({ ...input, result: { status: 'compliant' }, actor: { role: 'admin' } }, context)
  assert.equal(result.result.status, 'manual_review'); assert.equal(result.actor.id, 'real-user'); assert.equal(result.actor.role, 'officer'); assert.equal(result.rawOcrText, 'SHAMP00')
})
test('server rejects controlled fixtures, missing rule versions and malformed timestamps', () => {
  assert.throws(() => validateCase({ ...input, controlledFixture: true }, context), { status: 422 })
  assert.throws(() => validateCase({ ...input, rulePack: undefined }, context), { status: 409 })
  assert.throws(() => validateCase({ ...input, createdAt: 'bad' }, context), { status: 400 })
})
test('case payload hash is independent of property insertion order', () => {
  assert.equal(hashPayload({ b: 2, a: { d: 4, c: 3 } }), hashPayload({ a: { c: 3, d: 4 }, b: 2 }))
})
