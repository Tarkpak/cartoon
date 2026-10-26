import { describe, expect, it } from 'vitest'
import { projectLastOpenedStorageKey, resolveProjectProgress } from './projects-page'

describe('projectLastOpenedStorageKey', () => {
  it('isolates the last project by authenticated user', () => {
    expect(projectLastOpenedStorageKey('user-a')).toBe('playlet:last-project-id:user-a')
    expect(projectLastOpenedStorageKey('user-b')).toBe('playlet:last-project-id:user-b')
  })

  it('does not expose a shared key without an authenticated user', () => {
    expect(projectLastOpenedStorageKey()).toBeNull()
    expect(projectLastOpenedStorageKey('  ')).toBeNull()
  })
})

describe('resolveProjectProgress', () => {
  it('reports projects that have no scenes yet', () => {
    expect(resolveProjectProgress({ totalScenes: 0 })).toEqual({ done: 0, total: 0, percent: 0, label: '尚未解析剧本' })
  })

  it('reports partial and complete progress', () => {
    expect(resolveProjectProgress({ totalScenes: 36, completedScenes: 9 })).toMatchObject({ percent: 25, label: '已出片 9 / 36' })
    expect(resolveProjectProgress({ totalScenes: 4, completedScenes: 4 }).label).toBe('已全部出片 · 4 个场景')
  })

  it('clamps inconsistent counts', () => {
    expect(resolveProjectProgress({ totalScenes: 3, completedScenes: 7 }).done).toBe(3)
    expect(resolveProjectProgress({ totalScenes: 3, completedScenes: -1 }).done).toBe(0)
  })
})
