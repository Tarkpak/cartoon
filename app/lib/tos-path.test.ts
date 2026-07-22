import { describe, expect, it } from 'vitest'
import { tosUserScopeComponent } from './tos-path'

describe('tosUserScopeComponent', () => {
  it('matches the backend user scope encoding', () => {
    expect(tosUserScopeComponent(' team/member\\editor ')).toBe('team_member_editor')
  })

  it('removes control characters', () => {
    expect(tosUserScopeComponent('user\n\u0000name\u007f')).toBe('username')
  })
})
