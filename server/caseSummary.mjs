import { HttpError } from './security.mjs'
import { pageResult } from './pagination.mjs'

export const CASE_LIST_PAGE_SIZE = 20
export const MAX_CASE_LIST_BYTES = 128 * 1024
// Project only register fields at the database boundary. Raw OCR, image paths,
// region geometry, audit payloads and full review histories are detail-only.
export const CASE_SUMMARY_SELECT = 'id,created_at,version,payload_hash,captured_at:payload->>createdAt,sealed_at:payload->>sealedAt,rule_pack:payload->>rulePack,product_name:payload->meta->>productName,category:payload->meta->>category,quantity:payload->meta->>quantity,unit:payload->meta->>unit,barcode:payload->meta->>barcode,automated_status:payload->automatedResult->>status,score:payload->automatedResult->>score'
const boundedText = (value, length) => typeof value === 'string' ? value.slice(0, length) : ''
const status = (value) => ['compliant', 'non_compliant', 'manual_review', 'exempt'].includes(value) ? value : 'manual_review'

export function summarizeCase(row, review = null) {
  const result = { status: status(row.automated_status), score: Number.isFinite(Number(row.score)) ? Math.max(0, Math.min(100, Number(row.score))) : 0, context: { rulePack: boundedText(row.rule_pack, 100) } }
  const latest = review ? { id: boundedText(review.id, 100), status: status(review.status), actor: { id: boundedText(review.actor_id, 100) }, at: boundedText(review.created_at, 40), automatedStatus: result.status } : null
  return {
    schemaVersion: 2, recordKind: 'summary', detailsStale: true,
    id: boundedText(row.id, 100), createdAt: boundedText(row.captured_at, 40) || boundedText(row.created_at, 40), sealedAt: boundedText(row.sealed_at, 40),
    meta: { productName: boundedText(row.product_name, 300), category: boundedText(row.category, 40), quantity: boundedText(row.quantity, 40), unit: boundedText(row.unit, 20), barcode: boundedText(row.barcode, 64) },
    result, automatedResult: result, supervisorReview: latest, reviewHistory: latest ? [latest] : [],
    rulePack: boundedText(row.rule_pack, 100), evidenceItems: [],
    serverVersion: row.version, serverPayloadHash: boundedText(row.payload_hash, 64), serverSealedAt: boundedText(row.created_at, 40), syncState: 'synced',
  }
}

export async function listCaseSummaries(context, offset) {
  let query = context.client.from('cases').select(CASE_SUMMARY_SELECT).eq('org_id', context.org).order('created_at', { ascending: false }).order('id').range(offset, offset + CASE_LIST_PAGE_SIZE - 1)
  if (context.member.role === 'officer') query = query.eq('owner_id', context.user.id)
  const { data, error } = await query
  if (error || !Array.isArray(data)) throw new HttpError(503, 'Unable to load cases.')
  const records = await Promise.all(data.map(async (row) => {
    const { data: reviews, error: issue } = await context.client.from('case_reviews').select('id,status,actor_id,created_at').eq('org_id', context.org).eq('case_id', row.id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1)
    if (issue || !Array.isArray(reviews)) throw new HttpError(503, 'Review summary unavailable.')
    return summarizeCase(row, reviews[0])
  }))
  const page = { records, recordKind: 'summary', ...pageResult(offset, records.length, CASE_LIST_PAGE_SIZE) }
  // This ceiling catches schema regressions before the platform's 4.5 MB limit.
  if (Buffer.byteLength(JSON.stringify(page), 'utf8') > MAX_CASE_LIST_BYTES) throw new HttpError(503, 'Case summaries exceed the register response budget. Full evidence remains available by case ID.')
  return page
}
