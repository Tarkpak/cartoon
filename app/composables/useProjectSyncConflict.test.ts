import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectSyncConflict } from './useProjectSyncConflict'

const backup = { backupId: 'backup-1', localUpdatedAt: 'local-v1', remoteUpdatedAt: 'remote-v1', localSceneCount: 2, remoteSceneCount: 3 }

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useProjectSyncConflict', () => {
  it('resolves only after a durable backup and passes the reviewed backup id', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ success: true, data: backup }).mockResolvedValueOnce({ success: true })
    vi.stubGlobal('$fetch', fetch)
    const conflict = useProjectSyncConflict()
    expect(await conflict.resolve('p1', 'local')).toBe(false)
    await conflict.prepare('p1')
    expect(conflict.backup.value).toEqual(backup)
    expect(await conflict.resolve('p1', 'local')).toBe(true)
    expect(fetch).toHaveBeenLastCalledWith('/api/project/p1/sync-conflict/resolve', {
      method: 'POST', body: { strategy: 'local', backupId: 'backup-1' }, timeout: 150_000, retry: 0
    })
  })

  it('requires reviewing versions again after a failed resolution without reporting success', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ success: true, data: backup })
      .mockRejectedValueOnce({ data: { message: '云端项目已变化' } }))
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    expect(await conflict.resolve('p1', 'remote')).toBe(false)
    expect(conflict.error.value).toContain('云端项目已变化')
    expect(conflict.backup.value).toBeNull()
    expect(await conflict.resolve('p1', 'remote')).toBe(false)
    expect(conflict.resolving.value).toBeNull()
  })

  it('does not enable overwrite when backup creation fails', async () => {
    const fetch = vi.fn().mockRejectedValue({ data: { message: '备份写入失败' } })
    vi.stubGlobal('$fetch', fetch)
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    expect(conflict.error.value).toBe('备份写入失败')
    expect(await conflict.resolve('p1', 'local')).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('discards late backup results after closing or switching projects', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('$fetch', vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve })))
    const conflict = useProjectSyncConflict()
    const pending = conflict.prepare('p1')
    await Promise.resolve()
    conflict.reset()
    finish({ success: true, data: backup })
    await pending
    expect(conflict.backup.value).toBeNull()
    expect(await conflict.resolve('p2', 'remote')).toBe(false)
  })

  it('renews the conflict lease while the user reviews the backup', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ success: true, data: backup })
      .mockResolvedValue({ data: { editable: true } })
    vi.stubGlobal('$fetch', fetch)
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    await vi.advanceTimersByTimeAsync(100_000)
    expect(fetch.mock.calls.filter(([, options]) => options.body?.action === 'heartbeat')).toHaveLength(5)
    expect(conflict.backup.value).toEqual(backup)
  })

  it('disables resolution after a lease takeover', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ data: backup }).mockResolvedValue({ data: { editable: false } })
    vi.stubGlobal('$fetch', fetch)
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(conflict.backup.value).toBeNull()
    expect(conflict.error.value).toContain('接管')
    expect(await conflict.resolve('p1', 'local')).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('releases editing rights on close and stops renewals', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ data: backup }).mockResolvedValue({ data: {} })
    vi.stubGlobal('$fetch', fetch)
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    conflict.reset()
    await vi.advanceTimersByTimeAsync(100_000)
    expect(fetch).toHaveBeenLastCalledWith('/api/project/p1/edit-session', {
      method: 'POST', body: { action: 'release' }, timeout: 15_000, retry: 0
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('ignores a late resolution after closing the dialog', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ data: backup })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValue({ data: {} }))
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    const pending = conflict.resolve('p1', 'remote')
    conflict.reset()
    finish({ success: true })
    expect(await pending).toBe(false)
    expect(conflict.resolving.value).toBeNull()
  })
})
