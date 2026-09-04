import { createHash } from 'node:crypto'
import { requireMember, quota, reply, failure, accessibleCase, HttpError, caseId, uuid } from '../server/security.mjs'
export const detectedMime = (bytes) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null
export default async function handler(req, res) {
  try {
    const context = await requireMember(req)
    if (req.method === 'GET') {
      const row = await accessibleCase(context, req.query?.caseId)
      const files = row.payload.evidenceItems.flatMap((panel) => [panel.originalPath, panel.analysisPath])
      if (!files.includes(req.query?.path)) throw new HttpError(404, 'Evidence not found.')
      const { data, error } = await context.client.storage.from('evidence').createSignedUrl(req.query.path, 60)
      if (error) throw new HttpError(503, 'Unable to retrieve private evidence.')
      return reply(res, 200, { url: data.signedUrl })
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' })
    await quota(context, 'evidence', 60, 2000)
    const { action, caseId: id, panelId, kind, sha256, bytes, mime } = req.body || {}
    if (!caseId(id) || !uuid(panelId) || !['original','analysis'].includes(kind) || !/^[a-f0-9]{64}$/.test(sha256 || '') || !Number.isInteger(bytes) || bytes < 1 || bytes > 15728640 || !['image/jpeg','image/png','image/webp'].includes(mime)) throw new HttpError(400, 'Invalid evidence descriptor. Use JPEG, PNG or WebP up to 15 MB.')
    const path = `${context.org}/${context.user.id}/${id}/${panelId}/${kind}-${sha256}`
    const existing = await context.client.from('evidence_objects').select('path').eq('path', path).maybeSingle()
    if (existing.error) throw new HttpError(503, 'Evidence register unavailable.')
    if (existing.data) return reply(res, 200, { path, verified: true })
    if (action === 'prepare') {
      const { data, error } = await context.client.storage.from('evidence').createSignedUploadUrl(path, { upsert: false })
      if (error) throw new HttpError(503, 'Unable to prepare the private upload.')
      return reply(res, 200, { path, token: data.token, uploadUrl: data.signedUrl, verified: false })
    }
    if (action !== 'verify') throw new HttpError(400, 'Unknown evidence operation.')
    const { data, error } = await context.client.storage.from('evidence').download(path)
    if (error || !data) throw new HttpError(422, 'Upload is incomplete. Retry this panel.')
    const content = Buffer.from(await data.arrayBuffer())
    if (content.length !== bytes || detectedMime(content) !== mime || createHash('sha256').update(content).digest('hex') !== sha256) throw new HttpError(422, 'Uploaded evidence failed size, type or hash verification.')
    const stored = await context.client.from('evidence_objects').insert({ path, org_id: context.org, owner_id: context.user.id, case_id: id, panel_id: panelId, kind, sha256, bytes, mime })
    if (stored.error && stored.error.code !== '23505') throw new HttpError(503, 'Could not register verified evidence.')
    return reply(res, 200, { path, verified: true })
  } catch (error) { return failure(res, error) }
}
