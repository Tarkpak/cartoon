/** Keep synchronous draft capture while serializing durable writes before cloud saves. */
export function createCollaborationStorage() {
  const cache = new Map<string, string>()
  let database: IDBDatabase | undefined
  let queue = Promise.resolve()
  let failure: unknown
  const isCollaborationKey = (key: string) => /^workbench-collaboration-(draft|pending):/u.test(key)
  function enqueue(key: string, value: string | null) {
    queue = queue.then(() => new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction('drafts', 'readwrite')
      const store = transaction.objectStore('drafts')
      if (value === null) store.delete(key)
      else store.put(value, key)
      transaction.oncomplete = () => {
        // Remove the small-storage copy only after its replacement is durable.
        try { localStorage.removeItem(key) } catch { /* IndexedDB owns this key now. */ }
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })).catch(cause => { failure = cause })
  }
  return {
    async initialize() {
      if (database) { await this.flush(); return }
      if (typeof indexedDB === 'undefined') return
      database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('workbench-collaboration', 1)
        request.onupgradeneeded = () => { request.result.createObjectStore('drafts') }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = database!.transaction('drafts', 'readonly')
        const request = transaction.objectStore('drafts').openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          // A draft captured during initialization takes precedence.
          if (!cache.has(String(cursor.key))) cache.set(String(cursor.key), cursor.value)
          cursor.continue()
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      // Preserve all legacy windows, including pending operations and archives.
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index)
        if (!key || !isCollaborationKey(key) || cache.has(key)) continue
        const value = localStorage.getItem(key)
        if (value !== null) { cache.set(key, value); enqueue(key, value) }
      }
      await this.flush()
    },
    getItem(key: string) { return database ? cache.get(key) ?? null : localStorage.getItem(key) },
    setItem(key: string, value: string) {
      if (!database) { localStorage.setItem(key, value); return }
      cache.set(key, value)
      enqueue(key, value)
    },
    removeItem(key: string) {
      cache.delete(key)
      if (database) enqueue(key, null)
      else localStorage.removeItem(key)
    },
    async flush() {
      await queue
      if (failure) throw new Error('协作草稿未能写入本机，请保留当前窗口并释放磁盘空间后重试。', { cause: failure })
    }
  }
}
