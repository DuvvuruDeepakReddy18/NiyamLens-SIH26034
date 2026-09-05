import test from 'node:test'
import assert from 'node:assert/strict'
import { CASE_LIST_PAGE_SIZE, CASE_SUMMARY_SELECT, MAX_CASE_LIST_BYTES, summarizeCase, listCaseSummaries } from '../server/caseSummary.mjs'
import { normalizeCase, effectiveStatus } from '../src/lib/caseRecords.mjs'

const row = (index = 0) => ({ id: `summary-case-${index}`, created_at: '2026-09-05T12:00:00Z', version: 3, payload_hash: 'a'.repeat(64), captured_at: '2026-09-05T11:00:00Z', sealed_at: '2026-09-05T11:30:00Z', rule_pack: 'LMPC-TEST', product_name: 'Test product', category: 'general', quantity: '100', unit: 'g', barcode: '12345678', automated_status: 'manual_review', score: '75' })
const review = { id: 'review-latest', status: 'non_compliant', actor_id: 'reviewer', created_at: '2026-09-05T13:00:00Z' }

test('case summaries expose register fields and latest disposition without transcripts, images or audit history', () => {
  const source = { ...row(), payload: { text: 'x'.repeat(90000), evidenceItems: [{ originalUrl: 'data:image/png;private', ocrPasses: Array(3).fill({ text: 'x'.repeat(80000) }) }], auditChain: [{ payload: 'private' }] } }
  const summary = normalizeCase(summarizeCase(source, { ...review, reason: 'private full review reason' }))
  assert.equal(effectiveStatus(summary), 'non_compliant')
  assert.equal(summary.result.status, 'manual_review'); assert.equal(summary.result.score, 75)
  assert.equal(summary.meta.productName, 'Test product'); assert.equal(summary.serverVersion, 3)
  assert.equal(summary.recordKind, 'summary'); assert.equal(summary.detailsStale, true)
  assert.deepEqual(summary.evidenceItems, []); assert.equal(summary.text, undefined)
  assert.doesNotMatch(JSON.stringify(summary), /private|ocrPasses|originalUrl|auditChain/)
  assert.ok(Buffer.byteLength(JSON.stringify(Array.from({ length: CASE_LIST_PAGE_SIZE }, () => summary))) < MAX_CASE_LIST_BYTES)
})

test('summary field lengths keep a full UTF-8 page bounded even with oversized legacy metadata', () => {
  const source = { ...row(), product_name: '界'.repeat(90000), barcode: '9'.repeat(90000), unit: '界'.repeat(90000) }
  const summary = summarizeCase(source)
  assert.equal(summary.meta.productName.length, 300); assert.equal(summary.meta.barcode.length, 64)
  assert.ok(Buffer.byteLength(JSON.stringify(Array.from({ length: 20 }, () => summary))) < MAX_CASE_LIST_BYTES)
})

const context = ({ role = 'officer', failure = false } = {}) => {
  const queries = []
  return { queries, org: 'test-org', user: { id: 'test-officer' }, member: { role }, client: { from(table) {
    const entry = { table, filters: [], orders: [] }; queries.push(entry)
    return {
      select(value) { entry.select = value; return this }, eq(key, value) { entry.filters.push([key, value]); return this },
      order(key, options) { entry.orders.push([key, options]); return this }, range(from, to) { entry.range = [from, to]; return this }, limit(value) { entry.limit = value; return this },
      then(resolve, reject) { return Promise.resolve(failure ? { error: new Error('unavailable') } : { data: table === 'cases' ? Array.from({ length: 20 }, (_, index) => row(index)) : [review] }).then(resolve, reject) },
    }
  } } }
}

test('list query projects compact fields, enforces officer scope and bounds each latest-review query', async () => {
  const ctx = context(); const page = await listCaseSummaries(ctx, 20)
  assert.equal(page.recordKind, 'summary'); assert.equal(page.records.length, 20); assert.equal(page.nextOffset, 40)
  assert.equal(ctx.queries[0].select, CASE_SUMMARY_SELECT); assert.doesNotMatch(CASE_SUMMARY_SELECT, /\*|ocr|audit|evidence/i)
  assert.deepEqual(ctx.queries[0].range, [20, 39]); assert.ok(ctx.queries[0].filters.some(([key, value]) => key === 'owner_id' && value === ctx.user.id))
  for (const query of ctx.queries.slice(1)) { assert.equal(query.limit, 1); assert.equal(query.select, 'id,status,actor_id,created_at'); assert.ok(query.filters.some(([key, value]) => key === 'org_id' && value === ctx.org)) }
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < MAX_CASE_LIST_BYTES)
})

test('supervisor summary reads remain organization-scoped and provider failure is explicit', async () => {
  const ctx = context({ role: 'supervisor' }); await listCaseSummaries(ctx, 0)
  assert.equal(ctx.queries[0].filters.some(([key]) => key === 'owner_id'), false)
  assert.ok(ctx.queries[0].filters.some(([key, value]) => key === 'org_id' && value === ctx.org))
  await assert.rejects(listCaseSummaries(context({ failure: true }), 0), { status: 503 })
})
