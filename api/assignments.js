import { requireMember, reply, failure, HttpError, uuid, quota } from '../server/security.mjs'
import { pageOffset, pageResult } from '../server/pagination.mjs'
export default async function handler(req, res) {
  try {
    const context = await requireMember(req)
    if (req.method === 'GET') {
      const offset = pageOffset(req.query?.offset)
      let query = context.client.from('assignments').select('*').eq('org_id', context.org).order('created_at', { ascending: false }).order('id').range(offset, offset + 49)
      if (context.member.role === 'officer') query = query.eq('officer_id', context.user.id)
      const { data, error } = await query
      if (error) throw error
      return reply(res, 200, { assignments: data, ...pageResult(offset, data.length, 50) })
    }
    await quota(context, 'assignments', 30, 500)
    if (req.method === 'POST') {
      if (!['admin','supervisor'].includes(context.member.role)) throw new HttpError(403, 'Only supervisors assign work.')
      const { officerId, packageRef, id } = req.body || {}
      if (!uuid(officerId) || !uuid(id) || typeof packageRef !== 'string' || !packageRef.trim() || packageRef.length > 300) throw new HttpError(400, 'Choose an officer and package reference.')
      const member = await context.client.from('memberships').select('user_id').eq('org_id',context.org).eq('user_id',officerId).eq('active',true).maybeSingle()
      if (!member.data || member.error) throw new HttpError(403, 'Assignee is not an active workspace member.')
      const { error } = await context.client.rpc('create_assignment', { p_org: context.org, p_actor: context.user.id, p_id: id, p_officer: officerId, p_reference: packageRef.trim() })
      if (error) throw error
      return reply(res, 200, { saved: true })
    }
    if (req.method === 'PATCH') {
      const { id, status, version } = req.body || {}
      if (!uuid(id) || !Number.isSafeInteger(version) || version < 1 || version > 2147483647 || !['in_progress','submitted','closed'].includes(status)) throw new HttpError(400,'Invalid assignment update.')
      if (status === 'closed' && context.member.role === 'officer') throw new HttpError(403,'Supervisor must close the assignment.')
      const { error } = await context.client.rpc('update_assignment', { p_org: context.org, p_actor: context.user.id, p_id: id, p_version: version, p_status: status })
      if (error) throw error
      return reply(res,200,{saved:true})
    }
    return reply(res,405,{error:'Method not allowed.'})
  } catch(error) { return failure(res,error) }
}
