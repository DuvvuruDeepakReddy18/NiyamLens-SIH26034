const DB_NAME = 'niyamlens-evidence-v1'
const STORE = 'inspections'

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(new Error('IndexedDB is unavailable in this browser.'))
    return
  }
  const request = globalThis.indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: 'id' })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Unable to open the evidence register.'))
})

const transactionRequest = async (mode, operation) => {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode)
      const store = transaction.objectStore(STORE)
      const request = operation(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Evidence register operation failed.'))
      transaction.onerror = () => reject(transaction.error || new Error('Evidence register transaction failed.'))
    })
  } finally {
    database.close()
  }
}

export const listInspections = async () => {
  const records = await transactionRequest('readonly', (store) => store.getAll())
  return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export const saveInspection = async (record) => {
  await transactionRequest('readwrite', (store) => store.put(record))
  return record
}

