import { describe, expect, it } from 'vitest'
import { summarizeProjectPresence } from './project-presence'

describe('collaboration bar members', () => {
  it('combines a person’s windows and prefers editing locations over idle presence', () => {
    const members = summarizeProjectPresence([
      { userId: 'a', displayName: 'ceshi', activity: '正在查看', locked: false },
      { userId: 'a', displayName: 'ceshi', activity: '正在查看', locked: false }
    ], [
      { userId: 'a', displayName: 'ceshi', locations: ['第2集'] },
      { userId: 'a', displayName: 'ceshi', locations: ['第2集', '公共角色'] }
    ])
    expect(members).toEqual([{ userId: 'a', displayName: 'ceshi', activity: '正在编辑 第2集、公共角色', locked: false }])
  })

  it('keeps separate accounts with the same display name and prioritizes occupied resources', () => {
    expect(summarizeProjectPresence([
      { userId: 'a', displayName: 'ceshi', activity: '正在查看', locked: false },
      { userId: 'b', displayName: 'ceshi', activity: '占用 第1集', locked: true }
    ], [{ userId: 'b', displayName: 'ceshi', locations: ['第1集'] }])).toEqual([
      { userId: 'b', displayName: 'ceshi', activity: '占用 第1集', locked: true },
      { userId: 'a', displayName: 'ceshi', activity: '正在查看', locked: false }
    ])
    expect(summarizeProjectPresence()).toEqual([])
  })
})
