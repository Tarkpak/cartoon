export interface TimelineSegmentInput {
  startTime: number
  duration: number
}

export interface TimelineSegment {
  index: number
  startTime: number
  duration: number
}

/**
 * Finds the segment that plays at `time`. The very end of the timeline
 * belongs to the last segment so the preview keeps showing it.
 */
export function resolveTimelineSegment(segments: TimelineSegmentInput[], time: number): TimelineSegment | null {
  if (segments.length === 0) return null
  const index = segments.findIndex(segment => time < segment.startTime + segment.duration)
  const resolvedIndex = index === -1 ? segments.length - 1 : index
  const segment = segments[resolvedIndex]!
  return { index: resolvedIndex, startTime: segment.startTime, duration: segment.duration }
}

/** Returns a copy with the item at `from` moved to position `to`. */
export function moveListItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items.slice()
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as T)
  return next
}
