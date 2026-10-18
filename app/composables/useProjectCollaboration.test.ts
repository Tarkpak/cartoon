import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectCollaboration } from './useProjectCollaboration'

vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), onBeforeUnmount: vi.fn() }))
const resource = (id: string) => ({ type: 'episode', id, revision: 1, deleted: false, body: { title: id } })
const scope = { type: 'episode' as const, id: 'e1' }
let storage: Map<string, string>
beforeEach(() => {
  vi.useFakeTimers()
  storage = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const read = { data: { enabled: true, protocolVersion: 1, cursor: 0, resources: [resource('e1'), resource('e2')] } }

describe('collaboration sessions', () => {
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
