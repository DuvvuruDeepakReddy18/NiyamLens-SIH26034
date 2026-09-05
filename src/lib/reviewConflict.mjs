import { mergeCloudRecord } from './workspaceClient.mjs'

// Reconcile against current IndexedDB state, not a pre-fetch snapshot. Another
// tab may have already handled this conflict or committed a newer disposition.
export function archiveReviewConflict(store, operation, serverRecord, archivedAt = new Date().toISOString()) {
  if (operation?.kind !== 'review' || !operation.id || !operation.recordId || serverRecord?.id !== operation.recordId || !Number.isSafeInteger(serverRecord.serverVersion) || serverRecord.serverVersion < 1 || !Array.isArray(serverRecord.evidenceItems) || serverRecord.recordKind === 'summary' || serverRecord.detailsStale) throw new Error('A matching queued review and complete server record are required.')
  return store.transact(['settings', 'outbox', 'inspections'], 'readwrite', (tx, done) => {
    const outbox = tx.objectStore('outbox')
    const pending = outbox.getAll()
    pending.onsuccess = () => {
      const currentOperation = pending.result.find(item => item.id === operation.id)
      if (!currentOperation || currentOperation.kind !== 'review' || currentOperation.state !== 'conflict'
        || currentOperation.recordId !== operation.recordId || currentOperation.baseVersion !== operation.baseVersion
        || currentOperation.payload?.status !== operation.payload?.status || currentOperation.payload?.reason !== operation.payload?.reason) { done(false); return }
      const current = tx.objectStore('inspections').get(operation.recordId)
      current.onsuccess = () => {
        const remaining = pending.result.filter(item => item.id !== operation.id && item.recordId === operation.recordId)
        tx.objectStore('settings').put({ id: `archived-review:${operation.id}`, operation: currentOperation, archivedAt })
        outbox.delete(operation.id)
        if (remaining.length) {
          // Keeping this server revision must not erase a separately queued
          // newer review. Its own retry/conflict workflow remains available.
          if (current.result) tx.objectStore('inspections').put({ ...current.result, syncState: remaining.some(item => item.kind === 'review') ? 'pending-review' : 'pending' })
        } else {
          tx.objectStore('inspections').put(mergeCloudRecord(current.result, serverRecord))
        }
        done(true)
      }
    }
  })
}
