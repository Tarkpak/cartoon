import { describe, expect, it } from 'vitest'
import { resolveAtMentionState } from './contenteditable-mention'

describe('resolveAtMentionState', () => {
  it('opens mention state for ascii at sign', () => {
    expect(resolveAtMentionState('引用 @阿强', 6, { maxQueryLength: 32 })).toEqual({
      open: true,
      query: '阿强',
      start: 3
    })
  })

  it('opens mention state for full-width at sign from Chinese IMEs', () => {
    expect(resolveAtMentionState('引用 ＠阿强', 6, { maxQueryLength: 32 })).toEqual({
      open: true,
      query: '阿强',
      start: 3
    })
  })
})
