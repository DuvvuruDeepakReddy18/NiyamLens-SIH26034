import { requireMember, quota, reply, failure, accessibleCase, HttpError, uuid } from '../server/security.mjs'
import { hydrateCase } from '../server/caseService.mjs'
import { DISPOSITIONS } from '../src/lib/caseRecords.mjs'
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' })
    const context = await requireMember(req, ['supervisor', 'admin'])
    await quota(context, 'review', 30, 500)
    const { caseId, operationId, baseVersion, status, reason } = req.body || {}
    if (!uuid(operationId) || !Number.isSafeInteger(baseVersion) || baseVersion < 1 || baseVersion > 2147483647 || !DISPOSITIONS.includes(status) || typeof reason !== 'string' || reason.trim().length < 12 || reason.length > 4000) throw new HttpError(400, 'A versioned review with a clear reason is required.')
    await accessibleCase(context, caseId)
    const { error } = await context.client.rpc('review_case', { p_org: context.org, p_actor: context.user.id, p_id: caseId, p_operation: operationId, p_version: baseVersion, p_status: status, p_reason: reason.trim() })
    if (error) throw error
    return reply(res, 200, { record: await hydrateCase(context, await accessibleCase(context, caseId)) })
  } catch (error) { return failure(res, error) }
}
