import { requireMember, quota, reply, failure, accessibleCase, HttpError } from '../server/security.mjs'
import { validateCase, hashPayload, hydrateCase } from '../server/caseService.mjs'
export default async function handler(req, res) {
  try {
    const context = await requireMember(req)
    if (req.method === 'GET') {
      if (req.query?.id) return reply(res, 200, { record: await hydrateCase(context, await accessibleCase(context, req.query.id)) })
      const offset = Math.max(0, Math.min(100000, Math.floor(Number(req.query?.offset) || 0)))
      let query = context.client.from('cases').select('*').eq('org_id', context.org).order('created_at', { ascending: false }).order('id').range(offset, offset + 19)
      if (context.member.role === 'officer') query = query.eq('owner_id', context.user.id)
      const { data, error } = await query
      if (error) throw new HttpError(503, 'Unable to load cases.')
      return reply(res, 200, { records: await Promise.all(data.map((row) => hydrateCase(context, row))), nextOffset: data.length === 20 ? offset + 20 : null })
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' })
    await quota(context, 'case', 20, 500)
    const record = validateCase(req.body?.record, context)
    for (const panel of record.evidenceItems) {
      for (const [kind, path] of [['original', panel.originalPath], ['analysis', panel.analysisPath]]) {
        const { data, error } = await context.client.from('evidence_objects').select('*').eq('org_id', context.org).eq('owner_id', context.user.id).eq('case_id', record.id).eq('panel_id', panel.id).eq('kind', kind).eq('path', path || '').maybeSingle()
        if (error || !data || (kind === 'original' && data.sha256 !== panel.sha256)) throw new HttpError(422, 'An evidence file is missing or its server-verified digest does not match.')
      }
    }
    const { error } = await context.client.rpc('commit_case', { p_org: context.org, p_actor: context.user.id, p_id: record.id, p_payload: record, p_hash: hashPayload(record) })
    if (error) throw error
    return reply(res, 200, { record: await hydrateCase(context, await accessibleCase(context, record.id)) })
  } catch (error) { return failure(res, error) }
}
