import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareProjectCollaboration } from './project-collaboration-entry'
import { resolveProjectDetailPath, resolveProjectWorkbenchPath } from '../../shared/types/project'

afterEach(() => vi.unstubAllGlobals())
describe('default collaboration entrance', () => {
  it('routes all projects and workbench stages through collaboration', () => {
    expect(resolveProjectDetailPath('p/1')).toBe('/projects/p%2F1/collaboration')
    expect(resolveProjectWorkbenchPath('p1', 'videos')).toBe('/projects/p1/collaboration?stage=videos')
  })
  it('prepares migration without automatically repeating a write', async () => {
    const request = vi.fn().mockResolvedValue({ data: { enabled: true } })
    vi.stubGlobal('$fetch', request)
    await prepareProjectCollaboration('p/1')
    expect(request).toHaveBeenCalledWith('/api/project/p%2F1/collaboration/prepare', { method: 'POST', retry: 0, timeout: 180_000 })
  })
  it('keeps the editor closed when migration is not acknowledged', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ data: { enabled: false } }))
    await expect(prepareProjectCollaboration('p1')).rejects.toThrow('协作迁移尚未确认完成')
  })
})
