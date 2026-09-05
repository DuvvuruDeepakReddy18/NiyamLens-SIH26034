import { requireMember, quota, reply, failure, accessibleCase, HttpError } from '../server/security.mjs'
import { validateCase, hashPayload, hydrateCase } from '../server/caseService.mjs'
import { pageOffset } from '../server/pagination.mjs'
import { listCaseSummaries } from '../server/caseSummary.mjs'
import { verifyStoredImage } from '../server/imageValidation.mjs'
export default async function handler(req, res) {
  try {
    const context = await requireMember(req)
    if (req.method === 'GET') {
      if (req.query?.id) return reply(res, 200, { record: await hydrateCase(context, await accessibleCase(context, req.query.id)) })
      const offset = pageOffset(req.query?.offset)
      return reply(res, 200, await listCaseSummaries(context, offset))
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' })
    await quota(context, 'case', 20, 500)
    const record = validateCase(req.body?.record, context)
    for (const panel of record.evidenceItems) {
      for (const [kind, path] of [['original', panel.originalPath], ['analysis', panel.analysisPath]]) {
        const { data, error } = await context.client.from('evidence_objects').select('*').eq('org_id', context.org).eq('owner_id', context.user.id).eq('case_id', record.id).eq('panel_id', panel.id).eq('kind', kind).eq('path', path || '').maybeSingle()
        if (error || !data || (kind === 'original' && data.sha256 !== panel.sha256)) throw new HttpError(422, 'An evidence file is missing or its server-verified digest does not match.')
        await verifyStoredImage(context, data)
      }
    }
    const { error } = await context.client.rpc('commit_case', { p_org: context.org, p_actor: context.user.id, p_id: record.id, p_payload: record, p_hash: hashPayload(record) })
    if (error) throw error
    return reply(res, 200, { record: await hydrateCase(context, await accessibleCase(context, record.id)) })
  } catch (error) {
    if (error.code === 'RULE_PACK_MISMATCH') return reply(res, 409, { error: error.message, code: error.code })
    return failure(res, error)
  }
}
