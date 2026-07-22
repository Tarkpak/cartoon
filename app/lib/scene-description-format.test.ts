import { describe, expect, it } from 'vitest'
import { formatSceneDescriptionTimelineBreaks } from './scene-description-format'

describe('formatSceneDescriptionTimelineBreaks', () => {
  it('places consecutive timeline segments on separate lines', () => {
    expect(formatSceneDescriptionTimelineBreaks(
      '0-3秒，大远景固定机位。画外音：“一切正常。”3-8秒，摄影机侧向跟拍。8-11秒：中景缓慢推进。'
    )).toBe(
      '0-3秒，大远景固定机位。画外音：“一切正常。”\n3-8秒，摄影机侧向跟拍。\n8-11秒：中景缓慢推进。'
    )
  })

  it('does not split an inline duration reference', () => {
    expect(formatSceneDescriptionTimelineBreaks(
      '这个动作通常持续3-8秒，然后自然结束。'
    )).toBe('这个动作通常持续3-8秒，然后自然结束。')
  })
})
