import { RULE_PACK } from './rules.mjs'
import { validateOcrHistory } from './ocrHistory.mjs'
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']
const cancelled = () => Object.assign(new Error('Workspace changed. Synchronization stopped; local evidence is retained.'), { status: 401 })
const hexDigest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
const dataUrl = (bytes, mime) => {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384))
  return `data:${mime};base64,${btoa(binary)}`
}
const imageMime = (bytes) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
  : [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ? 'image/png'
    : String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP' ? 'image/webp' : null

async function boundedImage(response, signal) {
  if (!response.ok) throw Object.assign(new Error(`Private evidence download failed (${response.status}).`), { status: response.status })
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw Object.assign(new Error('Evidence exceeds the 15 MB limit.'), { status: 413 })
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (!IMAGE_MIMES.includes(mime)) throw Object.assign(new Error('Private evidence is not a supported image.'), { status: 422 })
  const reader = response.body?.getReader()
  if (!reader) throw Object.assign(new Error('Private evidence response is empty.'), { status: 422 })
  const chunks = []; let total = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_IMAGE_BYTES) throw Object.assign(new Error('Evidence exceeds the 15 MB limit.'), { status: 413 })
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  signal.throwIfAborted()
  const bytes = new Uint8Array(total); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  if (!total || imageMime(bytes) !== mime) throw Object.assign(new Error('Private evidence failed image-type verification.'), { status: 422 })
  return { bytes, mime }
}
export function mergeCloudRecord(local, remote) {
  return { ...remote, imageUrl: local?.imageUrl || '', evidenceItems: remote.evidenceItems.map((panel) => {
    const cached = local?.evidenceItems?.find((item) => item.id === panel.id)
    return { ...cached, ...panel }
  }) }
}
export function createWorkspaceClient(client, org, expectedUserId) {
  if (!expectedUserId) throw new Error('Workspace clients must be bound to an authenticated user.')
  let controller = new AbortController()
  let disposed = false
  const ensureCurrent = async (signal = controller.signal) => {
    if (disposed || signal.aborted) throw cancelled()
    const { data, error } = await client.auth.getSession()
    if (error || !data.session) throw Object.assign(new Error('Sign in again to synchronize. Local evidence is retained.'), { status: 401 })
    if (disposed || signal.aborted || data.session.user?.id !== expectedUserId) throw cancelled()
    return data.session
  }
  const headers = async (signal = controller.signal) => {
    const session = await ensureCurrent(signal)
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, 'X-Workspace-Id': org }
  }
  const request = async (path, options = {}) => {
    const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(60000)])
    const response = await fetch(`/api/${path}`, { ...options, headers: await headers(signal), cache: 'no-store', signal })
    const result = await response.json().catch(() => ({}))
    await ensureCurrent(signal)
    if (!response.ok) throw Object.assign(new Error(result.error || `Request failed (${response.status}).`), { status: response.status })
    return result
  }
  const upload = async (record, panel, kind, signal) => {
    await ensureCurrent(signal)
    const url = panel[`${kind}Url`]
    if (!url?.startsWith('data:image/')) throw Object.assign(new Error('Original image missing from local evidence. Re-capture before sealing.'), { status: 422 })
    const blob = await (await fetch(url, { signal })).blob()
    const sha256 = await hexDigest(await blob.arrayBuffer())
    const descriptor = { caseId: record.id, panelId: panel.id, kind, sha256, bytes: blob.size, mime: blob.type }
    const prepared = await request('evidence', { method: 'POST', body: JSON.stringify({ ...descriptor, action: 'prepare' }), signal })
    if (!prepared.verified) {
      if (!prepared.uploadUrl) throw Object.assign(new Error('Private upload service must be updated before synchronization.'), { status: 503 })
      await ensureCurrent(signal)
      const uploaded = await fetch(prepared.uploadUrl, {
        method: 'PUT', body: blob, headers: { 'Content-Type': blob.type, 'x-upsert': 'false', 'Cache-Control': 'max-age=0' },
        cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      })
      await ensureCurrent(signal)
      // A previous attempt may have uploaded successfully before the response was lost.
      if (!uploaded.ok && ![409, 400].includes(uploaded.status)) throw Object.assign(new Error(`Private evidence upload failed (${uploaded.status}).`), { status: uploaded.status })
      await request('evidence', { method: 'POST', body: JSON.stringify({ ...descriptor, action: 'verify' }), signal })
    }
    return prepared.path
  }
  return { headers, request, expectedUserId, ensureCurrent,
    get signal() { return controller.signal },
    cancelPending() { controller.abort(cancelled()); if (!disposed) controller = new AbortController() },
    dispose() { disposed = true; controller.abort(cancelled()) },
    async transport(operation) {
      const signal = controller.signal
      await ensureCurrent(signal)
      if (operation.kind === 'review') {
        const result = await request('reviews', { method: 'POST', body: JSON.stringify({ ...operation.payload, caseId: operation.recordId, operationId: operation.id, baseVersion: operation.baseVersion }), signal })
        return { record: result.record }
      }
      if (operation.kind !== 'seal') throw Object.assign(new Error('Unknown queued operation.'), { status: 422 })
      const record = operation.payload
      try { validateOcrHistory(record?.evidenceItems) } catch (error) { throw Object.assign(error, { status: 422 }) }
      const panels = []
      for (const panel of record.evidenceItems) {
        const originalPath = await upload(record, panel, 'original', signal)
        const analysisPath = await upload(record, panel, 'analysis', signal)
        const { originalUrl, analysisUrl, perspectiveBaseUrl, ocrWords, ...metadata } = panel
        panels.push({ ...metadata, originalPath, analysisPath })
      }
      const { imageUrl, regions, ...metadata } = record
      const result = await request('cases', { method: 'POST', body: JSON.stringify({ record: { ...metadata, evidenceItems: panels, rulePack: RULE_PACK.id } }), signal })
      return { record: mergeCloudRecord(record, result.record) }
    },
    async openRecord(record, { source = 'available', signal: callerSignal } = {}) {
      if (!['available', 'cloud'].includes(source)) throw Object.assign(new Error('Unknown evidence retrieval source.'), { status: 422 })
      const signal = AbortSignal.any([controller.signal, ...(callerSignal ? [callerSignal] : [])])
      await ensureCurrent(signal)
      if (source === 'cloud') {
        if (typeof record?.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(record.id)) throw Object.assign(new Error('A valid managed case ID is required.'), { status: 422 })
        const result = await request(`cases?id=${encodeURIComponent(record.id)}`, { signal })
        const fresh = result.record
        if (!fresh || fresh.id !== record.id || !Number.isSafeInteger(fresh.serverVersion) || fresh.serverVersion < 1 || typeof fresh.serverPayloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(fresh.serverPayloadHash) || typeof fresh.serverSealedAt !== 'string' || !Number.isFinite(Date.parse(fresh.serverSealedAt)) || fresh.syncState !== 'synced') throw Object.assign(new Error('The server did not return a valid managed receipt. Cached evidence was not substituted.'), { status: 422 })
        // Inspect a fresh server snapshot without overwriting a local draft,
        // queued review, or cached image. Failure must never fall back to cache.
        record = fresh
      }
      if (!Array.isArray(record.evidenceItems) || record.evidenceItems.length < 1 || record.evidenceItems.length > 4) throw Object.assign(new Error('A managed case requires one to four evidence panels.'), { status: 422 })
      const panels = []
      for (const panel of record.evidenceItems) {
        const next = { ...panel }
        for (const kind of ['original', 'analysis']) {
          let url = next[`${kind}Url`]
          // Signed URLs are transient transport credentials, never an exported image.
          if (source === 'cloud' || !url?.startsWith('data:image/')) {
            if (!panel[`${kind}Path`]) throw Object.assign(new Error('Private evidence path is missing.'), { status: 422 })
            const result = await request(`evidence?caseId=${encodeURIComponent(record.id)}&path=${encodeURIComponent(panel[`${kind}Path`])}`, { signal })
            url = result.url
          }
          const imageSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)])
          const response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: imageSignal })
          const { bytes, mime } = await boundedImage(response, imageSignal)
          const expected = kind === 'original' ? panel.sha256 : panel.analysisPath?.match(/analysis-([a-f0-9]{64})$/)?.[1]
          if (!/^[a-f0-9]{64}$/.test(expected || '') || await hexDigest(bytes) !== expected) throw Object.assign(new Error(`${kind === 'original' ? 'Original' : 'Analysis'} evidence failed SHA-256 verification. Export was stopped.`), { status: 422 })
          await ensureCurrent(signal)
          next[`${kind}Url`] = dataUrl(bytes, mime)
        }
        // Old clients may have left another signed URL on a cached panel.
        if (next.perspectiveBaseUrl && !next.perspectiveBaseUrl.startsWith('data:image/')) delete next.perspectiveBaseUrl
        panels.push(next)
      }
      await ensureCurrent(signal)
      return { ...record, evidenceItems: panels, imageUrl: panels[0]?.analysisUrl || '' }
    },
  }
}
