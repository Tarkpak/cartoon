import { describe, expect, it } from 'vitest'
import { tosAdminAssetPrefix, tosUserScopeComponent } from './tos-path'

describe('tosUserScopeComponent', () => {
  it('matches the backend user scope encoding', () => {
    expect(tosUserScopeComponent(' team/member\\editor ')).toBe('team_member_editor')
  })

  it('removes control characters', () => {
    expect(tosUserScopeComponent('user\n\u0000name\u007f')).toBe('username')
  })
})

describe('tosAdminAssetPrefix', () => {
  it('keeps member assets under their user scope', () => {
    expect(tosAdminAssetPrefix('team/member', 'images')).toBe('users/team_member/images')
    expect(tosAdminAssetPrefix('__all__', 'all')).toBe('users')
  })
})
