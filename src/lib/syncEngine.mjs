export function createOperation(kind, recordId, payload, baseVersion = 0) {
  return { id: crypto.randomUUID(), kind, recordId, payload, baseVersion, state: 'pending', attempts: 0, nextAttempt: 0, createdAt: new Date().toISOString() }
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
        const result = await transport(operation)
        await store.transact(['outbox', 'inspections'], 'readwrite', (tx) => {
          tx.objectStore('outbox').delete(operation.id)
          if (result?.record) tx.objectStore('inspections').put(result.record)
        })
      } catch (error) {
        const status = error.status || 0
        const state = status === 409 ? 'conflict' : [400, 403, 413, 422].includes(status) ? 'blocked' : 'pending'
        const attempts = operation.attempts + 1
        await store.put('outbox', { ...operation, state, attempts, lastError: error.message, nextAttempt: now() + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)) })
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
