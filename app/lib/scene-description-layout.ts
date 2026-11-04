import type { SceneDescriptionRenderSegment } from './asset-workbench-types'

interface SceneDescriptionBlock {
  label?: string
  segments: SceneDescriptionRenderSegment[]
}

const SECTION_LABEL = /^(场景功能\/情绪定位|场景功能|情绪定位|镜头设计|声音设计|台词节奏|表演关键点)\s*[：:]\s*/u

// Lay out the rendered segments so inline asset links survive paragraph splitting.
export function buildSceneDescriptionBlocks(segments: SceneDescriptionRenderSegment[]): SceneDescriptionBlock[] {
  const lines: SceneDescriptionRenderSegment[][] = [[]]
  for (const segment of segments) {
    if (segment.type !== 'text') {
      lines[lines.length - 1]!.push(segment)
      continue
    }
    const parts = (segment.text || '').split(/\r?\n/u)
    parts.forEach((text, index) => {
      if (index > 0) lines.push([])
      if (text) lines[lines.length - 1]!.push({ type: 'text', text })
    })
  }

  return lines.filter(line => line.some(segment => segment.type === 'asset' || segment.text?.trim()))
    .map((line) => {
      const first = line[0]
      const heading = first?.type === 'text' ? first.text?.trimStart().match(SECTION_LABEL) : null
      if (!heading || !first?.text) return { segments: line }
      return {
        label: heading[1],
        segments: [
          { type: 'text' as const, text: first.text.trimStart().slice(heading[0].length) },
          ...line.slice(1)
        ]
      }
    })
}
