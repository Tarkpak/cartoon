import { describe, expect, it } from 'vitest'
import { createSceneSplitDraft, normalizeSplitTimeline, splitDescriptionUnits } from './scene-split'
import { splitSceneInList } from './asset-workbench-scenes'
import type { SceneData } from './asset-workbench-models'

const scene: SceneData = {
  id: 's1', title: '原场景', description: '0-4秒：他问：“走吗？等等！”\n4-8秒：她点头。',
  narration: '他们准备出发。', duration: 8, characters: [], active: true,
  videoUrl: 'original.mp4', videoStatus: 'done', referenceStatus: 'done',
  descriptionHistory: [{ id: 'old', description: '完整旧描述', createdAt: 1 }],
  transitionIn: 'fade', transitionOut: 'fade'
}

describe('scene split preview', () => {
  it('keeps dialogue intact and rebases each timeline', () => {
    const draft = createSceneSplitDraft(scene)!
    expect(splitDescriptionUnits(scene.description)).toHaveLength(2)
    expect(draft[0].description).toContain('“走吗？等等！”')
    expect(draft[1].description).toBe('0-4秒：她点头。')
    expect(draft[0].narration).toBe(scene.narration)
    expect(draft[1].narration).toBe('')
    expect(draft[0].duration + draft[1].duration).toBe(scene.duration)
  })

  it('applies edited narration and removes stale history and internal transitions', () => {
    const draft = createSceneSplitDraft(scene)!
    draft[0].narration = ''
    draft[1].narration = scene.narration!
    const result = splitSceneInList([scene], 0, draft)!
    expect(result[0]!.narration).toBeUndefined()
    expect(result[1]!.narration).toBe(scene.narration)
    expect(result.every(part => !part.videoUrl && part.videoStatus === 'pending' && !part.descriptionHistory)).toBe(true)
    expect(result[0]!.transitionOut).toBe('cut')
    expect(result[1]!.transitionIn).toBe('cut')
    expect(result[0]!.videoHistory?.[0]?.videoUrl).toBe('original.mp4')
  })

  it('rejects invalid duration totals or empty descriptions', () => {
    const draft = createSceneSplitDraft(scene)!
    draft[0].duration = 5
    expect(splitSceneInList([scene], 0, draft)).toBeNull()
    draft[0].duration = 4
    draft[1].description = ' '
    expect(splitSceneInList([scene], 0, draft)).toBeNull()
    expect(createSceneSplitDraft({ ...scene, duration: NaN })).toBeNull()
  })

  it('scales decimal timestamps without treating decimal points as sentences', () => {
    expect(splitDescriptionUnits('0-2.5秒：等待。2.5-8秒：离开。')).toHaveLength(2)
    expect(normalizeSplitTimeline('4-6秒：等待。6-8秒：走。', 6)).toBe('0-3秒：等待。3-6秒：走。')
  })
})
