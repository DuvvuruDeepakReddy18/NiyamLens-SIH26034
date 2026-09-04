import { createClient } from '@supabase/supabase-js'
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
export const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
export const caseId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(value)
export function adminClient({ signal, timeoutMs = 50000 } = {}) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new HttpError(503, 'Shared backend is not configured.')
  // One client is created per handler invocation. Bound the entire sequence of
  // provider I/O as well as each individual request, leaving decode/response time
  // below the 60-second evidence/case function budget.
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, options = {}) => fetch(input, { ...options, signal: AbortSignal.any([deadline, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(30000)]) }) },
  })
}
export async function requireMember(req, roles = [], client = adminClient()) {
  const token = String(req.headers?.authorization || '').match(/^Bearer (\S+)$/)?.[1]
  if (!token) throw new HttpError(401, 'Sign in to use the shared service.')
  const org = req.headers?.['x-workspace-id']
  if (!uuid(org)) throw new HttpError(400, 'A valid workspace is required.')
  const { data, error } = await client.auth.getUser(token)
  if (error && ![400, 401, 403].includes(Number(error.status))) throw new HttpError(503, 'Sign-in verification is temporarily unavailable. Retry without discarding local evidence.')
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
export function failure(res, error) {
  const databaseStatus = { '40001': 409, '23505': 409, '42501': 403, '22P02': 400, '22003': 400, '22001': 400, '23514': 400, '23503': 422 }[error.code]
  const status = error.status || databaseStatus || 500
  const message = error.status || error.code === '40001' ? error.message : databaseStatus === 409 ? 'This operation conflicts with an existing record. Refresh and review before retrying.' : databaseStatus === 400 || databaseStatus === 422 ? 'The submitted data does not match the required schema.' : 'Request failed. No success was recorded.'
  return reply(res, status, { error: message })
}
export async function accessibleCase(context, id) {
  if (!caseId(id)) throw new HttpError(400, 'Invalid case ID.')
  let query = context.client.from('cases').select('*').eq('org_id', context.org).eq('id', id)
  if (context.member.role === 'officer') query = query.eq('owner_id', context.user.id)
  const { data, error } = await query.maybeSingle()
  if (error) throw new HttpError(503, 'Case store unavailable.')
  if (!data) throw new HttpError(404, 'Case not found or not accessible.')
  return data
}
