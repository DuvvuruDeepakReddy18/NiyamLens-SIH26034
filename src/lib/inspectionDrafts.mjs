export const archivedDraftId = inspectionId => `saved:${inspectionId}`

const checkedSnapshot = snapshot => {
  if (!snapshot?.inspectionId || !Array.isArray(snapshot.evidenceItems) || !snapshot.evidenceItems.length) throw new Error('Capture a package before saving its draft.')
  return { ...snapshot, savedAt: new Date().toISOString() }
}

// Read/check/write in one transaction: a failed archive must never clear the
// active slot. The existing "active" key remains compatible with reassessment.
async function changeDrafts(store, inspectionIds, change) {
  let failure
  try {
    return await store.transact(['drafts', 'inspections'], 'readwrite', (tx, done) => {
      const drafts = tx.objectStore('drafts')
      const ids = [...new Set(inspectionIds.filter(Boolean))]
      const keys = [...new Set(['active', ...ids.map(archivedDraftId)])]
      let remaining = ids.length + keys.length
      const rows = []
      const sealed = new Set()
      const finish = () => {
        if (--remaining) return
        try { done(change(drafts, rows, sealed)) } catch (error) { failure = error; tx.abort() }
      }
      // Do not deserialize every archived photo on each keystroke/autosave.
      for (const key of keys) {
        const request = drafts.get(key)
        request.onsuccess = () => { if (request.result) rows.push(request.result); finish() }
      }
      for (const id of ids) {
        const existing = tx.objectStore('inspections').getKey(id)
        existing.onsuccess = () => { if (existing.result !== undefined) sealed.add(id); finish() }
      }
    })
  } catch (error) { throw failure || error }
}

function checkOwner(active, inspectionId) {
  if (active && active.inspectionId !== inspectionId) throw new Error('Another inspection is active in this workspace. Your current evidence was not cleared. Reopen the workspace to recover its drafts.')
}

export async function saveActiveDraft(store, snapshot) {
  const next = checkedSnapshot(snapshot)
  return changeDrafts(store, [next.inspectionId], (drafts, rows, sealed) => {
    // An autosave queued just before sealing must not resurrect that case.
    if (sealed.has(next.inspectionId)) return false
    if (rows.some(row => row.id === archivedDraftId(next.inspectionId))) throw new Error('This inspection was saved separately in another tab. Resume its saved draft before editing; it has not been overwritten.')
    checkOwner(rows.find(row => row.id === 'active'), next.inspectionId)
    drafts.put({ ...next, id: 'active' })
    return true
  })
}

export async function parkInspectionDraft(store, snapshot) {
  const next = checkedSnapshot(snapshot)
  return changeDrafts(store, [next.inspectionId], (drafts, rows, sealed) => {
    if (sealed.has(next.inspectionId)) throw new Error('This inspection is already sealed. Its saved evidence was not changed.')
    const active = rows.find(row => row.id === 'active')
    checkOwner(active, next.inspectionId)
    if (rows.some(row => row.id === archivedDraftId(next.inspectionId))) throw new Error('This inspection already has a saved draft. Resume it first; the stored evidence has not been overwritten.')
    const archived = { ...next, id: archivedDraftId(next.inspectionId) }
    drafts.put(archived)
    if (active) drafts.delete('active')
    return archived
  })
}

export async function activateInspectionDraft(store, selected, currentSnapshot = null, challengeId = null) {
  if (!selected?.inspectionId) throw new Error('Select a saved inspection draft.')
  const current = currentSnapshot ? checkedSnapshot(currentSnapshot) : null
  return changeDrafts(store, [selected.inspectionId, current?.inspectionId], (drafts, rows, sealed) => {
    const target = rows.find(row => row.id === selected.id && row.inspectionId === selected.inspectionId)
    if (!target) throw new Error('This draft changed in another tab. Refresh the draft list; current evidence was not cleared.')
    checkedSnapshot(target)
    if (challengeId && target.challengeId !== challengeId) throw new Error('This draft is outside the active blind challenge. Exit the challenge to recover it; it cannot be used as blind-run evidence.')
    if (sealed.has(target.inspectionId)) throw new Error('This draft is already a sealed case. Open it from Inspection history.')
    const active = rows.find(row => row.id === 'active')
    checkOwner(active, current?.inspectionId || target.inspectionId)
    if (current && current.inspectionId !== target.inspectionId) {
      if (sealed.has(current.inspectionId)) throw new Error('The current inspection was sealed in another tab. Reopen its saved record before switching.')
      if (rows.some(row => row.id === archivedDraftId(current.inspectionId))) throw new Error('The current inspection already has a saved draft. Resume that draft first; its stored evidence was not overwritten.')
      drafts.put({ ...current, id: archivedDraftId(current.inspectionId) })
    }
    const next = { ...target, id: 'active', savedAt: new Date().toISOString() }
    drafts.put(next)
    if (target.id !== 'active') drafts.delete(target.id)
    return next
  })
}

export function removeInspectionDraft(store, inspectionId) {
  return changeDrafts(store, [], (drafts, rows) => {
    if (rows.some(row => row.id === 'active' && row.inspectionId === inspectionId)) drafts.delete('active')
    drafts.delete(archivedDraftId(inspectionId))
  })
}

// Serialize old autosaves before switching/sealing and synchronously suppress
// new ones while a transition is in flight (including double-clicks).
export function createDraftWriter(store) {
  let tail = Promise.resolve()
  let busy = false
  const enqueue = action => {
    const result = tail.then(action)
    tail = result.catch(() => {})
    return result
  }
  return {
    get busy() { return busy },
    save(snapshot) { return busy ? Promise.resolve(false) : enqueue(() => saveActiveDraft(store, snapshot)) },
    transition(action) {
      if (busy) return Promise.reject(new Error('A draft operation is already in progress.'))
      busy = true
      return enqueue(action).finally(() => { busy = false })
    },
  }
}
