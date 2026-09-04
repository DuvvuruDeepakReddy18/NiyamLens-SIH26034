export function createOperation(kind, recordId, payload, baseVersion = 0) {
  return { id: crypto.randomUUID(), kind, recordId, payload, baseVersion, state: 'pending', attempts: 0, nextAttempt: 0, createdAt: new Date().toISOString() }
}
// Retain the immutable metadata snapshot, but do not duplicate large image data
// URLs already committed in the same IndexedDB transaction as this operation.
export function compactOperation(operation, record) {
  if (operation.kind !== 'seal' || !Array.isArray(operation.payload?.evidenceItems) || operation.recordId !== record.id) return operation
  const { imageUrl, ...payload } = operation.payload
  return { ...operation, mediaRef: record.id, payload: { ...payload, evidenceItems: payload.evidenceItems.map(({ originalUrl, analysisUrl, perspectiveBaseUrl, ...panel }) => panel) } }
}
async function resolveMedia(operation, store) {
  if (!operation.mediaRef) return operation // Earlier persisted full-payload queues remain supported.
  const record = await store.get('inspections', operation.mediaRef)
  if (!record || record.id !== operation.recordId) throw Object.assign(new Error('Queued evidence is unavailable. Restore the original images before retrying.'), { status: 422 })
  const evidenceItems = operation.payload.evidenceItems.map((panel) => {
    const cached = record.evidenceItems?.find((item) => item.id === panel.id)
    if (!cached || cached.sha256 !== panel.sha256) throw Object.assign(new Error('Queued evidence no longer matches its immutable image reference.'), { status: 422 })
    return { ...panel, originalUrl: cached.originalUrl, analysisUrl: cached.analysisUrl, perspectiveBaseUrl: cached.perspectiveBaseUrl }
  })
  return { ...operation, payload: { ...operation.payload, imageUrl: record.imageUrl, evidenceItems } }
}
export function createSyncEngine({ store, transport, now = Date.now, onChange = () => {} }) {
  let active = null
  const run = async (force = false) => {
    const operations = (await store.all('outbox')).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const blocked = new Set()
    for (const operation of operations) {
      if (['conflict', 'blocked'].includes(operation.state)) { blocked.add(operation.recordId); continue }
      if (blocked.has(operation.recordId)) continue
      if (!force && operation.nextAttempt > now()) { blocked.add(operation.recordId); continue }
      try {
        const result = await transport(await resolveMedia(operation, store))
        await store.transact(['outbox', 'inspections'], 'readwrite', (tx) => {
          const outbox = tx.objectStore('outbox')
          const pending = outbox.getAll()
          pending.onsuccess = () => {
            if (!pending.result.some((item) => item.id === operation.id)) return
            // The transport may have been in flight while another tab queued a
            // review. Inspect current state inside this atomic acknowledgement.
            const remaining = pending.result.filter((item) => item.id !== operation.id && item.recordId === operation.recordId)
            outbox.delete(operation.id)
            if (!result?.record) return
            if (!remaining.length) { tx.objectStore('inspections').put(result.record); return }
            const current = tx.objectStore('inspections').get(operation.recordId)
            current.onsuccess = () => {
              if (current.result) tx.objectStore('inspections').put({ ...current.result, syncState: remaining.some((item) => item.kind === 'review') ? 'pending-review' : 'pending' })
            }
          }
        })
      } catch (error) {
        const status = error.status || 0
        const state = status === 409 ? 'conflict' : [400, 403, 413, 422].includes(status) ? 'blocked' : 'pending'
        const attempts = operation.attempts + 1
        await store.transact(['outbox'], 'readwrite', (tx) => {
          const outbox = tx.objectStore('outbox'); const current = outbox.get(operation.id)
          current.onsuccess = () => {
            if (current.result) outbox.put({ ...current.result, state, attempts, lastError: error.message, nextAttempt: now() + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)) })
          }
        })
        blocked.add(operation.recordId)
        if ([0, 401, 429, 503].includes(status)) break
      }
    }
    await onChange()
  }
  return { run(force = false) {
    if (active) return active
    const work = () => run(force)
    active = (globalThis.navigator?.locks ? navigator.locks.request(`sync:${store.name}`, work) : work()).finally(() => { active = null })
    return active
  } }
}
