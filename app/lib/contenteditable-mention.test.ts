import { describe, expect, it } from 'vitest'
import { resolveAtMentionState, resolveMentionPopoverPosition } from './contenteditable-mention'

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

describe('resolveMentionPopoverPosition', () => {
  const container = { top: 100, bottom: 210, left: 50, right: 650 }

  it('places the popover below the caret relative to the container', () => {
    expect(resolveMentionPopoverPosition({
      caret: { top: 120, bottom: 140, left: 200, right: 200 },
      container,
      viewport: { top: 0, bottom: 900 },
      popoverWidth: 320,
      popoverHeight: 300
    })).toEqual({ left: 150, top: 46, placement: 'bottom' })
  })

  it('clamps horizontally so the popover stays inside the container', () => {
    const position = resolveMentionPopoverPosition({
      caret: { top: 120, bottom: 140, left: 640, right: 640 },
      container,
      viewport: { top: 0, bottom: 900 },
      popoverWidth: 320,
      popoverHeight: 300
    })
    expect(position.left).toBe(280)
  })

  it('flips above the caret when there is not enough room below', () => {
    expect(resolveMentionPopoverPosition({
      caret: { top: 500, bottom: 520, left: 60, right: 60 },
      container: { top: 400, bottom: 540, left: 50, right: 650 },
      viewport: { top: 0, bottom: 600 },
      popoverWidth: 320,
      popoverHeight: 300
    })).toEqual({ left: 10, top: 94, placement: 'top' })
  })
})
