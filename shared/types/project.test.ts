import { describe, expect, it } from 'vitest'
import {
  projectAccessCan,
  resolveProjectRolePermissions
} from './project'

describe('project permissions', () => {
  it('resolves preset roles to stable permissions', () => {
    expect(resolveProjectRolePermissions('manager')).toEqual([
      'view',
      'edit',
      'generate',
      'export',
      'manage_members'
    ])
    expect(resolveProjectRolePermissions('viewer')).toEqual(['view'])
  })

  it('filters and checks custom permissions', () => {
    const permissions = resolveProjectRolePermissions('custom', ['view', 'export', 'invalid' as 'view'])
    expect(permissions).toEqual(['view', 'export'])
    expect(projectAccessCan({
      role: 'custom',
      permissions,
      isOwner: false
    }, 'export')).toBe(true)
    expect(projectAccessCan(undefined, 'view')).toBe(false)
  })

  it('makes generated project changes editable and always viewable', () => {
    expect(resolveProjectRolePermissions('custom', ['generate'])).toEqual([
      'view',
      'edit',
      'generate'
    ])
  })
})
