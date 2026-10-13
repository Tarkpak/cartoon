import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProjectEditSession } from './useProjectEditSession'
import { nextTick } from 'vue'
import { noteProjectLeaseLost } from '../lib/project-edit-session'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('useProjectEditSession', () => {
  it('ignores a late acquire response after switching projects', async () => {
    let resolveFirst!: (value: unknown) => void
    const first = new Promise(resolve => { resolveFirst = resolve })
    const fetch = vi.fn().mockImplementation((path: string, options: { body: { action: string } }) => {
      if (path.includes('/p1/') && options.body.action === 'acquire') return first
      return Promise.resolve({ data: { editable: false, canTakeover: false, holderName: '第二个项目' } })
    })
    vi.stubGlobal('$fetch', fetch)
    const lease = useProjectEditSession(vi.fn())
    const opening = lease.openEditSession('p1')
    await lease.openEditSession('p2')
    resolveFirst({ data: { editable: true, canTakeover: true } })
    await opening
    expect(lease.projectEditable.value).toBe(false)
    expect(lease.editSession.value.holderName).toBe('第二个项目')
    await lease.releaseEditSession()
  })

  it('only stops editing for a rejected write to the active project', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ data: { editable: true, canTakeover: false } }))
    const backup = vi.fn(async () => 'backup')
    const lease = useProjectEditSession(backup)
    await lease.openEditSession('p1')
    noteProjectLeaseLost(423, '/api/project/p2')
    await nextTick()
    expect(lease.projectEditable.value).toBe(true)
    noteProjectLeaseLost(423, '/api/video/generate', JSON.stringify({ projectId: 'p1' }))
    await nextTick()
    expect(lease.projectEditable.value).toBe(false)
    expect(backup).toHaveBeenCalledWith('p1')
    await lease.releaseEditSession()
  })

  it('opens a busy project read-only without claiming successful editing', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ data: { editable: false, canTakeover: false, holderName: '小王' } }))
    const backup = vi.fn()
    const lease = useProjectEditSession(backup)
    await lease.openEditSession('p1')
    expect(lease.projectEditable.value).toBe(false)
    expect(lease.editSession.value.holderName).toBe('小王')
    expect(backup).not.toHaveBeenCalled()
    await lease.releaseEditSession()
  })

  it('backs up unsaved edits once and stops editing when heartbeat loses the lease', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ data: { editable: true, canTakeover: true, expiresAt: Date.now() + 90_000 } })
      .mockResolvedValue({ data: { editable: false, canTakeover: true, holderName: '管理员' } })
    vi.stubGlobal('$fetch', fetch)
    const backup = vi.fn(async () => 'saved-backup')
    const lease = useProjectEditSession(backup)
    await lease.openEditSession('p1')
    await lease.heartbeat()
    expect(lease.projectEditable.value).toBe(false)
    expect(lease.editSession.value.backupId).toBe('saved-backup')
    expect(backup).toHaveBeenCalledWith('p1')
    await lease.heartbeat()
    expect(backup).toHaveBeenCalledTimes(1)
    await lease.releaseEditSession()
  })

  it('stops on network loss and tells the user when durable backup fails', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ data: { editable: true, canTakeover: true } }).mockRejectedValue(new Error('offline')))
    const lease = useProjectEditSession(async () => { throw new Error('disk unavailable') })
    await lease.openEditSession('p1')
    await lease.heartbeat()
    expect(lease.projectEditable.value).toBe(false)
    expect(lease.editSession.value.reason).toContain('请勿关闭页面')
    await lease.releaseEditSession()
  })

  it('requests takeover explicitly and releases the previous project on switch', async () => {
    const fetch = vi.fn().mockResolvedValue({ data: { editable: true, canTakeover: true } })
    vi.stubGlobal('$fetch', fetch)
    const lease = useProjectEditSession(vi.fn())
    await lease.openEditSession('p1')
    await lease.openEditSession('p2', true)
    expect(fetch).toHaveBeenCalledWith('/api/project/p1/edit-session', { method: 'POST', body: { action: 'release' } })
    expect(fetch).toHaveBeenLastCalledWith('/api/project/p2/edit-session', { method: 'POST', body: { action: 'takeover' } })
    await lease.releaseEditSession()
  })
})
