const TIMELINE_SEGMENT_BOUNDARY_REGEX = /([。！？!?；;”’"'])[\t ]*(?=(?:["“]?\d+(?:\.\d+)?\s*(?:-|–|—|~|～|至)\s*\d+(?:\.\d+)?\s*秒\s*[，,:：]))/gu

export function formatSceneDescriptionTimelineBreaks(value: string): string {
  return value.replace(TIMELINE_SEGMENT_BOUNDARY_REGEX, '$1\n')
}
