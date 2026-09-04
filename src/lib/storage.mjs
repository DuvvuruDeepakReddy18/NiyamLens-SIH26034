import { compactOperation } from './syncEngine.mjs'
const STORES = ['inspections', 'drafts', 'outbox', 'settings']

// Request success precedes transaction commit; only oncomplete may report saved.
export function createEvidenceStore(scope = 'local') {
  const name = scope === 'local' ? 'niyamlens-evidence-v1' : `niyamlens-workspace-${scope}`
  const open = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB is unavailable. Evidence has NOT been saved.'))
    const request = indexedDB.open(name, 2)
    request.onupgradeneeded = () => STORES.forEach((store) => {
      if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: 'id' })
    })
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close another NiyamLens tab to upgrade local storage.'))
  })
  const transact = async (stores, mode, action) => {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        let value
        tx.oncomplete = () => resolve(value)
        tx.onabort = () => reject(tx.error || new Error('Evidence transaction aborted. Nothing was saved.'))
        tx.onerror = () => { /* onabort is authoritative */ }
        try { action(tx, (result) => { value = result }) } catch (error) { tx.abort(); reject(error) }
      })
    } finally { db.close() }
  }
  const get = (store, id) => transact([store], 'readonly', (tx, done) => {
    const request = tx.objectStore(store).get(id); request.onsuccess = () => done(request.result || null)
  })
  const all = (store) => transact([store], 'readonly', (tx, done) => {
    const request = tx.objectStore(store).getAll(); request.onsuccess = () => done(request.result)
  })
  const put = (store, record) => transact([store], 'readwrite', (tx, done) => { tx.objectStore(store).put(record); done(record) })
  const remove = (store, id) => transact([store], 'readwrite', (tx) => tx.objectStore(store).delete(id))
  return {
    name, get, all, put, remove, transact,
    async listInspections() { return (await all('inspections')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) },
    saveInspection: (record) => put('inspections', record),
    mergeRemote: (record, merge) => transact(['inspections', 'outbox'], 'readwrite', (tx, done) => {
      const pending = tx.objectStore('outbox').getAll()
      pending.onsuccess = () => {
        if (pending.result.some((operation) => operation.recordId === record.id)) { done(false); return }
        const existing = tx.objectStore('inspections').get(record.id)
        existing.onsuccess = () => { tx.objectStore('inspections').put(merge(existing.result, record)); done(true) }
      }
    }),
    saveAndQueue: (record, operation) => transact(['inspections', 'outbox'], 'readwrite', (tx, done) => {
      tx.objectStore('inspections').put(record); tx.objectStore('outbox').put(compactOperation(operation, record)); done(record)
    }),
    clear: () => transact(STORES, 'readwrite', (tx) => STORES.forEach((store) => tx.objectStore(store).clear())),
  }
}
const local = createEvidenceStore()
export const listInspections = local.listInspections
export const saveInspection = local.saveInspection
