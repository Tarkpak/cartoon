import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDirectoryChange } from '../lib/project-collaboration-directory'
import { splitProjectSnapshot } from '../../shared/utils/project-collaboration'
import { useProjectCollaboration } from './useProjectCollaboration'

vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onBeforeUnmount: vi.fn() }))
const resource = (id: string) => ({ type: 'episode', id, revision: 1, deleted: false, body: { title: id } })
const scope = { type: 'episode' as const, id: 'e1' }
let storage: Map<string, string>
let durable: Map<string, string>
beforeEach(() => {
  vi.useFakeTimers()
  storage = new Map()
  durable = new Map()
  vi.stubGlobal('localStorage', { get length() { return durable.size }, key: (index: number) => [...durable.keys()][index] ?? null, getItem: (key: string) => durable.get(key) ?? null, setItem: (key: string, value: string) => durable.set(key, value), removeItem: (key: string) => durable.delete(key) })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const read = { data: { enabled: true, protocolVersion: 1, cursor: 0, resources: [resource('e1'), resource('e2')] } }

describe('collaboration sessions', () => {
  it('durably queues an uncertain operation and automatically replays it after reopening', async () => {
    let online = false
    const operations: string[] = []
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return read
      if (body.action === 'changes') return { data: { changes: [], cursor: 0, hasMore: false } }
      if (body.action === 'write') {
        expect(durable.size).toBe(1)
        operations.push(body.operationId)
        if (!online) throw new Error('offline')
        return { data: { resources: [{ ...resource('e1'), revision: 2, body: { title: 'offline draft' } }] } }
      }
      return { data: { editable: true, expiresAt: Date.now() + 90000 } }
    }))
    const session = useProjectCollaboration()
    await session.open('p', 'actor')
    await session.acquire(scope)
    session.client.value!.edit('episode', 'e1', { title: 'offline draft' })
    await expect(session.save([scope])).rejects.toThrow('offline')
    await session.close()
    storage.clear() // Simulate closing the browser window; the durable outbox remains.
    await session.open('p', 'other')
    expect(session.client.value!.hasPendingSave).toBe(false)
    await session.close()
    online = true
    await session.open('p', 'actor')
    expect(session.recovery.value).toBeUndefined()
    expect(session.queued.value).toBe(true)
    await session.refresh()
    expect(operations).toHaveLength(2)
    expect(operations[0]).toBe(operations[1])
    expect(durable.size).toBe(0)
    expect(session.client.value!.hasUnsavedChanges).toBe(false)
    await session.close()
  })

  it('stops automatic retries after a version conflict and preserves the local draft', async () => {
    let writes = 0
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return read
      if (body.action === 'changes') return { data: { changes: [], cursor: 0, hasMore: false } }
      if (body.action === 'write') { writes++; throw Object.assign(new Error('changed'), { statusCode: 409 }) }
      return { data: { editable: true, expiresAt: Date.now() + 90000 } }
    }))
    const session = useProjectCollaboration()
    await session.open('p', 'actor')
    await session.acquire(scope)
    session.client.value!.edit('episode', 'e1', { title: 'keep' })
    await expect(session.save([scope])).rejects.toThrow('changed')
    await session.refresh()
    expect(writes).toBe(1)
    expect(session.client.value!.get('episode', 'e1')).toMatchObject({ body: { title: 'keep' }, dirty: true, conflict: true })
    expect(durable.size).toBe(1)
    expect([...durable.values()][0]).toContain('keep')
    await session.close()
  })

  it('keeps separate operations from two windows and drains them one at a time', async () => {
    let online = false
    const writes: string[] = []
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return read
      if (body.action === 'changes') return { data: { changes: [], cursor: 0, hasMore: false } }
      if (body.action === 'write') {
        if (!online) throw new Error('offline')
        writes.push(body.operationId)
        return { data: { resources: body.mutations.map((item: { id: string, expectedRevision: number, body: unknown }) => ({ ...resource(item.id), revision: item.expectedRevision + 1, body: item.body })) } }
      }
      return { data: { editable: true, expiresAt: Date.now() + 90000 } }
    }))
    const first = useProjectCollaboration()
    const second = useProjectCollaboration()
    await first.open('p', 'actor')
    await second.open('p', 'actor')
    await first.acquire(scope)
    await second.acquire({ ...scope, id: 'e2' })
    first.client.value!.edit('episode', 'e1', { title: 'first window' })
    second.client.value!.edit('episode', 'e2', { title: 'second window' })
    await expect(first.save([scope])).rejects.toThrow('offline')
    await expect(second.save([{ ...scope, id: 'e2' }])).rejects.toThrow('offline')
    expect(durable.size).toBe(2)
    await first.close()
    await second.close()
    online = true
    const reopened = useProjectCollaboration()
    await reopened.open('p', 'actor')
    await reopened.refresh()
    await reopened.refresh()
    expect(writes).toHaveLength(2)
    expect(new Set(writes).size).toBe(2)
    expect(durable.size).toBe(0)
    expect(reopened.client.value!.get('episode', 'e1')?.body).toEqual({ title: 'first window' })
    expect(reopened.client.value!.get('episode', 'e2')?.body).toEqual({ title: 'second window' })
    await reopened.close()
  })

  it('does not send a new operation if durable queue storage fails', async () => {
    const fetch = vi.fn(async (_path, { body }) => body.action === 'read' ? read : { data: { editable: true, expiresAt: Date.now() + 90000 } })
    vi.stubGlobal('$fetch', fetch)
    const session = useProjectCollaboration()
    await session.open('p', 'actor')
    await session.acquire(scope)
    session.client.value!.edit('episode', 'e1', { title: 'keep' })
    const original = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    await expect(session.save([scope])).rejects.toThrow('quota')
    expect(fetch.mock.calls.some(([, options]) => options.body.action === 'write')).toBe(false)
    expect(session.client.value!.hasPendingSave).toBe(true)
    localStorage.setItem = original
    await session.close()
  })

  it('requires every group lease even when saving only the directory selection', async () => {
    const resources = splitProjectSnapshot({ project: { id: 'p' }, script: { episodePlan: [{ id: 'a', index: 1, title: 'A' }] }, scenes: [], characters: [] })
    const writes: unknown[] = []
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return { data: { enabled: true, protocolVersion: 1, cursor: 0, resources } }
      if (body.action === 'write') {
        writes.push(body)
        return { data: { resources: body.mutations.map((item: { expectedRevision: number }) => ({ ...item, revision: item.expectedRevision + 1, deleted: false })) } }
      }
      return { data: { editable: true, expiresAt: Date.now() + 90000, canTakeover: false } }
    }))
    const session = useProjectCollaboration()
    await session.open('p', 'actor')
    const directory = { type: 'directory' as const, id: 'directory' }
    await session.acquire(directory)
    session.client.value!.stageStructure(buildDirectoryChange(resources, { kind: 'add', id: 'b' }))
    await expect(session.save([directory])).rejects.toThrow('编辑权')
    expect(writes).toHaveLength(0)
    await session.acquire({ type: 'episode', id: 'b' })
    await session.save([directory])
    expect(writes).toHaveLength(1)
    expect(session.client.value!.structureScopes).toEqual([])
    await session.close()
  })

  it('loses only the affected object lease and keeps a recoverable draft', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return read
      if (body.action === 'changes') return { data: { changes: [], cursor: 0, hasMore: false } }
      return { data: { editable: body.leaseAction === 'acquire' || body.id === 'e2', expiresAt: Date.now() + 90000, canTakeover: false } }
    }))
    const session = useProjectCollaboration()
    await session.open('p1', 'user1')
    await session.acquire(scope)
    await session.acquire({ ...scope, id: 'e2' })
    session.client.value!.edit('episode', 'e1', { title: 'local' })
    await session.refresh()
    expect(session.canEdit(scope)).toBe(false)
    expect(session.canEdit({ ...scope, id: 'e2' })).toBe(true)
    expect(storage.size).toBe(1)
    expect([...storage.values()][0]).toContain('local')
    await session.close()
    await session.open('p1', 'user2')
    expect(session.recovery.value).toBeUndefined()
    await session.close()
    await session.open('p1', 'user1')
    expect(session.recovery.value).toBeDefined()
    session.recover()
    expect(session.client.value?.get('episode', 'e1')?.body).toEqual({ title: 'local' })
    await session.close()
  })

  it('does not let a slow previous project release replace a newer session', async () => {
    let finish!: () => void
    const slowRelease = new Promise<void>(resolve => { finish = resolve })
    vi.stubGlobal('$fetch', vi.fn(async (path, { body }) => {
      if (body.action === 'read') return read
      if (path.includes('/p0/') && body.leaseAction === 'release') await slowRelease
      return { data: { editable: true, expiresAt: Date.now() + 90000 } }
    }))
    const session = useProjectCollaboration()
    await session.open('p0', 'user')
    await session.acquire(scope)
    const first = session.open('p1', 'user')
    let secondOpened = false
    const second = session.open('p2', 'user').then(() => { secondOpened = true })
    await Promise.resolve()
    expect(secondOpened).toBe(false)
    finish()
    await Promise.all([first, second])
    expect(session.client.value).toBeDefined()
    expect(secondOpened).toBe(true)
    await session.close()
  })

  it('stops edits at lease expiration even before the next heartbeat', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => body.action === 'read' ? read : { data: { editable: true, expiresAt: Date.now() + 1000 } }))
    const session = useProjectCollaboration()
    await session.open('p1', 'user')
    await session.acquire(scope)
    expect(session.canEdit(scope)).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.canEdit(scope)).toBe(false)
    await expect(session.save([scope])).rejects.toThrow('编辑权')
    await session.close()
  })
  it('ignores late heartbeat success after the resource has been released', async () => {
    let finish!: (value: unknown) => void
    const heartbeat = new Promise(resolve => { finish = resolve })
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return read
      if (body.leaseAction === 'heartbeat') return heartbeat
      if (body.action === 'changes') return { data: { changes: [], cursor: 0, hasMore: false } }
      return { data: { editable: body.leaseAction === 'acquire', expiresAt: Date.now() + 90000 } }
    }))
    const session = useProjectCollaboration()
    await session.open('p1', 'user')
    await session.acquire(scope)
    const refreshing = session.refresh()
    await session.release(scope)
    finish({ data: { editable: true, expiresAt: Date.now() + 90000 } })
    await refreshing
    expect(session.canEdit(scope)).toBe(false)
    await session.close()
  })

  it('confirms an uncertain save even when reacquiring the lease is denied', async () => {
    let writes = 0
    vi.stubGlobal('$fetch', vi.fn(async (_path, { body }) => {
      if (body.action === 'read') return read
      if (body.action === 'write') {
        if (++writes === 1) throw new Error('timeout')
        return { data: { resources: [{ ...resource('e1'), revision: 2, body: { title: 'local' } }] } }
      }
      return { data: { editable: writes === 0, expiresAt: Date.now() + 90000 } }
    }))
    const session = useProjectCollaboration()
    await session.open('p1', 'user')
    await session.acquire(scope)
    session.client.value!.edit('episode', 'e1', { title: 'local' })
    await expect(session.save([scope])).rejects.toThrow('timeout')
    await session.release(scope)
    await session.retrySave()
    expect(session.client.value?.hasPendingSave).toBe(false)
    expect(writes).toBe(2)
    await session.close()
  })

})
