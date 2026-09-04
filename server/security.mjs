import { createClient } from '@supabase/supabase-js'
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
export const uuid = (value) => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value || ''))
export const caseId = (value) => /^[A-Za-z0-9_-]{8,100}$/.test(String(value || ''))
export function adminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new HttpError(503, 'Shared backend is not configured.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
export async function requireMember(req, roles = [], client = adminClient()) {
  const token = String(req.headers?.authorization || '').match(/^Bearer (\S+)$/)?.[1]
  if (!token) throw new HttpError(401, 'Sign in to use the shared service.')
  const org = req.headers?.['x-workspace-id']
  if (!uuid(org)) throw new HttpError(400, 'A valid workspace is required.')
  const { data, error } = await client.auth.getUser(token)
  if (error || !data?.user) throw new HttpError(401, 'Your session expired. Sign in again.')
  const membership = await client.from('memberships').select('*').eq('org_id', org).eq('user_id', data.user.id).eq('active', true).maybeSingle()
  if (membership.error) throw new HttpError(503, 'Unable to verify workspace membership.')
  if (!membership.data || (roles.length && !roles.includes(membership.data.role))) throw new HttpError(403, 'This account cannot perform this action.')
  return { client, org, user: data.user, member: membership.data }
}
export async function quota(context, resource, perMinute = 30, perDay = 500) {
  for (const [seconds, limit] of [[60, perMinute], [86400, perDay]]) {
    const { data, error } = await context.client.rpc('consume_quota', { p_key: `${context.org}:${context.user.id}:${resource}`, p_limit: limit, p_seconds: seconds })
    if (error) throw new HttpError(503, 'Quota service unavailable; request was not sent to the provider.')
    if (!data) throw new HttpError(429, 'Request limit reached. Retry later.')
  }
}
export function reply(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (status === 429) res.setHeader('Retry-After', '60')
  return res.status(status).json(payload)
}
export function failure(res, error) { return reply(res, error.status || (error.code === '40001' ? 409 : error.code === '42501' ? 403 : 500), { error: error.status || error.code === '40001' ? error.message : 'Request failed. No success was recorded.' }) }
export async function accessibleCase(context, id) {
  if (!caseId(id)) throw new HttpError(400, 'Invalid case ID.')
  let query = context.client.from('cases').select('*').eq('org_id', context.org).eq('id', id)
  if (context.member.role === 'officer') query = query.eq('owner_id', context.user.id)
  const { data, error } = await query.maybeSingle()
  if (error) throw new HttpError(503, 'Case store unavailable.')
  if (!data) throw new HttpError(404, 'Case not found or not accessible.')
  return data
}
