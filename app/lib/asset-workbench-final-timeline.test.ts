import { describe, expect, it } from 'vitest'
import { moveListItem, resolveTimelineSegment } from './asset-workbench-final-timeline'

const segments = [
  { startTime: 0, duration: 15 },
  { startTime: 15, duration: 6 },
  { startTime: 21, duration: 10 }
]

describe('resolveTimelineSegment', () => {
  it('returns null without segments', () => {
    expect(resolveTimelineSegment([], 3)).toBeNull()
  })

  it('finds the segment playing at a time, switching exactly at boundaries', () => {
    expect(resolveTimelineSegment(segments, 0)?.index).toBe(0)
    expect(resolveTimelineSegment(segments, 14.9)?.index).toBe(0)
    expect(resolveTimelineSegment(segments, 15)?.index).toBe(1)
    expect(resolveTimelineSegment(segments, 22)).toEqual({ index: 2, startTime: 21, duration: 10 })
  })

  it('keeps the last segment at and past the end', () => {
    expect(resolveTimelineSegment(segments, 31)?.index).toBe(2)
    expect(resolveTimelineSegment(segments, 99)?.index).toBe(2)
  })
})

describe('moveListItem', () => {
  it('moves an item forward and backward', () => {
    expect(moveListItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveListItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns an unchanged copy for invalid or no-op moves', () => {
    const items = ['a', 'b']
    expect(moveListItem(items, 1, 1)).toEqual(['a', 'b'])
    expect(moveListItem(items, 0, 5)).toEqual(['a', 'b'])
    expect(moveListItem(items, 0, 1)).not.toBe(items)
  })
})
