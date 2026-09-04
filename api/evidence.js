import { requireMember, quota, reply, failure, accessibleCase, HttpError, caseId, uuid } from '../server/security.mjs'
import { MAX_IMAGE_BYTES, verifyStoredImage } from '../server/imageValidation.mjs'
export { detectedMime } from '../server/imageValidation.mjs'
export default async function handler(req, res) {
  try {
    const context = await requireMember(req)
    if (req.method === 'GET') {
      await quota(context, 'evidence-read', 60, 2000)
      const row = await accessibleCase(context, req.query?.caseId)
      const files = row.payload.evidenceItems.flatMap((panel) => [panel.originalPath, panel.analysisPath])
      if (!files.includes(req.query?.path)) throw new HttpError(404, 'Evidence not found.')
      const registered = await context.client.from('evidence_objects').select('*').eq('org_id', context.org).eq('owner_id', row.owner_id).eq('case_id', row.id).eq('path', req.query.path).maybeSingle()
      if (registered.error || !registered.data) throw new HttpError(422, 'Evidence is not registered for this case.')
      // Also cover registrations produced by older, magic-byte-only validators.
      await verifyStoredImage(context, registered.data)
      const { data, error } = await context.client.storage.from('evidence').createSignedUrl(req.query.path, 60)
      if (error) throw new HttpError(503, 'Unable to retrieve private evidence.')
      return reply(res, 200, { url: data.signedUrl })
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' })
    await quota(context, 'evidence', 60, 2000)
    const { action, caseId: id, panelId, kind, sha256, bytes, mime } = req.body || {}
    if (!['prepare','verify'].includes(action) || typeof id !== 'string' || !caseId(id) || typeof panelId !== 'string' || !uuid(panelId) || !['original','analysis'].includes(kind) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(bytes) || bytes < 1 || bytes > MAX_IMAGE_BYTES || !['image/jpeg','image/png','image/webp'].includes(mime)) throw new HttpError(400, 'Invalid evidence descriptor. Use JPEG, PNG or WebP up to 15 MB.')
    const path = `${context.org}/${context.user.id}/${id}/${panelId}/${kind}-${sha256}`
    const existing = await context.client.from('evidence_objects').select('path').eq('path', path).maybeSingle()
    if (existing.error) throw new HttpError(503, 'Evidence register unavailable.')
    if (!existing.data && action === 'prepare') {
      const { data, error } = await context.client.storage.from('evidence').createSignedUploadUrl(path, { upsert: false })
      if (error) throw new HttpError(503, 'Unable to prepare the private upload.')
      return reply(res, 200, { path, token: data.token, uploadUrl: data.signedUrl, verified: false })
    }
    await verifyStoredImage(context, { path, bytes, sha256, mime })
    if (existing.data) return reply(res, 200, { path, verified: true })
    const stored = await context.client.from('evidence_objects').insert({ path, org_id: context.org, owner_id: context.user.id, case_id: id, panel_id: panelId, kind, sha256, bytes, mime })
    if (stored.error && stored.error.code !== '23505') throw new HttpError(503, 'Could not register verified evidence.')
    return reply(res, 200, { path, verified: true })
  } catch (error) { return failure(res, error) }
}
