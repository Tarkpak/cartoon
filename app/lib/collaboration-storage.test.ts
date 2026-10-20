import { afterEach, expect, it, vi } from 'vitest'
import { createCollaborationStorage } from './collaboration-storage'

afterEach(() => vi.unstubAllGlobals())

function setup(failWrites = false) {
  const legacy = new Map<string, string>([['workbench-collaboration-draft:old', 'unsaved']])
  const durable = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    get length() { return legacy.size },
    key: (index: number) => [...legacy.keys()][index] ?? null,
    getItem: (key: string) => legacy.get(key) ?? null,
    setItem: () => { throw new DOMException('full', 'QuotaExceededError') },
    removeItem: (key: string) => legacy.delete(key)
  })
  const database = {
    createObjectStore: vi.fn(),
    transaction: (_name: string, mode: string) => {
      const transaction = {
        error: new Error('disk full'),
        oncomplete: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
        objectStore: () => ({
          openCursor: () => {
            const request = { result: null, onsuccess: undefined as (() => void) | undefined }
            queueMicrotask(() => { request.onsuccess?.(); transaction.oncomplete?.() })
            return request
          },
          put: (value: string, key: string) => { if (!failWrites) durable.set(key, value) },
          delete: (key: string) => durable.delete(key)
        })
      }
      if (mode === 'readwrite') queueMicrotask(() => failWrites ? transaction.onerror?.() : transaction.oncomplete?.())
      return transaction
    }
  }
  vi.stubGlobal('indexedDB', { open: () => {
    const request = { result: database, onsuccess: undefined as (() => void) | undefined }
    queueMicrotask(() => request.onsuccess?.())
    return request
  } })
  return { legacy, durable }
}

it('migrates legacy drafts and durably saves large drafts even when localStorage is full', async () => {
  const { legacy, durable } = setup()
  const storage = createCollaborationStorage()
  await storage.initialize()
  expect(storage.getItem('workbench-collaboration-draft:old')).toBe('unsaved')
  expect(legacy.size).toBe(0)
  const large = 'x'.repeat(6 * 1024 * 1024)
  storage.setItem('workbench-collaboration-draft:large', large)
  await storage.flush()
  expect(durable.get('workbench-collaboration-draft:large')).toBe(large)
  storage.removeItem('workbench-collaboration-draft:large')
  expect(storage.getItem('workbench-collaboration-draft:large')).toBeNull()
  await storage.flush()
  expect(durable.has('workbench-collaboration-draft:large')).toBe(false)
})

it('keeps the legacy backup and blocks cloud submission when durable migration fails', async () => {
  const { legacy } = setup(true)
  const storage = createCollaborationStorage()
  await expect(storage.initialize()).rejects.toThrow('协作草稿未能写入本机')
  expect(legacy.get('workbench-collaboration-draft:old')).toBe('unsaved')
  await expect(storage.flush()).rejects.toThrow('协作草稿未能写入本机')
})
