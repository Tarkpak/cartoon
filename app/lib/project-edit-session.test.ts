import { describe, expect, it } from 'vitest'
import { createProjectDraftSession } from './project-edit-session'

describe('project draft session identity', () => {
  it('gives a copied tab its own writable identity while keeping the recovery source', () => {
    const firstStorage = new Map<string, string>()
    const storage = (values: Map<string, string>) => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } })
    const first = createProjectDraftSession('first-runtime', storage(firstStorage))
    const copiedStorage = new Map(firstStorage)
    const copied = createProjectDraftSession('copied-runtime', storage(copiedStorage))
    expect(copied.windowId).not.toBe(first.windowId)
    expect(copied.recoveryKey('draft:', 'actor', 'project')).toBe('draft:["actor","project","first-runtime"]')
    expect(copied.recoveryKey('draft:', 'actor', 'project')).toBeUndefined()
    expect(firstStorage.get('workbench-collaboration-window')).toBe(first.windowId)
    const reloaded = createProjectDraftSession('reloaded-copy', storage(copiedStorage))
    expect(reloaded.recoveryKey('draft:', 'actor', 'project')).toBe('draft:["actor","project","copied-runtime"]')
    // Repeated reloads outside the workbench must retain the project's pointer.
    createProjectDraftSession('homepage', storage(copiedStorage))
    const later = createProjectDraftSession('later-runtime', storage(copiedStorage))
    expect(later.recoveryKey('draft:', 'actor', 'project')).toBe('draft:["actor","project","reloaded-copy"]')
  })

  it('keeps an isolated identity when session storage is unavailable', () => {
    const session = createProjectDraftSession('runtime', { getItem: () => { throw new Error('denied') }, setItem: () => {} })
    expect(session.windowId).toBe('runtime')
    expect(session.recoveryKey('draft:', 'actor', 'project')).toBeUndefined()
  })
})
