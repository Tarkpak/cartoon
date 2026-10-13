import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProjectSyncConflict } from './useProjectSyncConflict'

const backup = { backupId: 'backup-1', localUpdatedAt: 'local-v1', remoteUpdatedAt: 'remote-v1', localSceneCount: 2, remoteSceneCount: 3 }

afterEach(() => vi.unstubAllGlobals())

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
      method: 'POST', body: { strategy: 'local', backupId: 'backup-1' }
    })
  })

  it('retains the backup and exposes a version conflict without reporting success', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ success: true, data: backup })
      .mockRejectedValueOnce({ data: { message: '云端项目已变化' } }))
    const conflict = useProjectSyncConflict()
    await conflict.prepare('p1')
    expect(await conflict.resolve('p1', 'remote')).toBe(false)
    expect(conflict.error.value).toBe('云端项目已变化')
    expect(conflict.backup.value?.backupId).toBe('backup-1')
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
    conflict.reset()
    finish({ success: true, data: backup })
    await pending
    expect(conflict.backup.value).toBeNull()
    expect(await conflict.resolve('p2', 'remote')).toBe(false)
  })
})
