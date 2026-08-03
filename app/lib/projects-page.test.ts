import { describe, expect, it } from 'vitest'
import { projectLastOpenedStorageKey } from './projects-page'

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
