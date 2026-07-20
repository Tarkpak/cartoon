import { describe, expect, test } from 'bun:test'
import { projectOwnerScope, projectSyncOwnerId } from './admin-resource-scope'

describe('admin resource scope', () => {
  test('lets admins query all projects while members stay owner-scoped', () => {
    expect(projectOwnerScope('admin', 'admin-1')).toEqual({ where: '', params: [] })
    expect(projectOwnerScope('user', 'user-1')).toEqual({
      where: 'WHERE p.user_id = ?',
      params: ['user-1']
    })
  })

  test('only admins can preserve another member as the project owner', () => {
    expect(projectSyncOwnerId({
      role: 'admin',
      authenticatedUserId: 'admin-1',
      requestedOwnerId: 'user-1'
    })).toBe('user-1')
    expect(projectSyncOwnerId({
      role: 'user',
      authenticatedUserId: 'user-2',
      requestedOwnerId: 'user-1'
    })).toBe('user-2')
  })
})
