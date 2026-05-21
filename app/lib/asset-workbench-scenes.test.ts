import { describe, expect, it } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import {
  mergeScenesInList,
  resetSceneGenerationState,
  splitSceneInList
} from './asset-workbench-scenes'

function createScene(input: Partial<SceneData> & Pick<SceneData, 'id' | 'title' | 'description'>): SceneData {
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    characters: input.characters || [],
    dialogues: input.dialogues || [],
    narration: input.narration,
    duration: input.duration || 8,
    setting: input.setting,
    active: input.active ?? false,
    shotType: input.shotType,
    cameraMovement: input.cameraMovement,
    cameraNote: input.cameraNote,
    environmentCaptureMode: input.environmentCaptureMode,
    transitionIn: input.transitionIn,
    transitionOut: input.transitionOut,
    transitionDuration: input.transitionDuration,
    firstFrame: input.firstFrame,
    lastFrame: input.lastFrame,
    videoUrl: input.videoUrl,
    videoHistory: input.videoHistory,
    referenceError: input.referenceError,
    videoError: input.videoError,
    referenceStatus: input.referenceStatus || 'pending',
    videoStatus: input.videoStatus || 'pending'
  }
}

describe('asset-workbench-scenes', () => {
  it('moves current video into history when resetting generation state', () => {
    const scene = createScene({
      id: 'scene_reset',
      title: '重置场景',
      description: '需要重置的视频场景',
      videoUrl: 'https://example.com/current-video.mp4',
      videoStatus: 'done',
      referenceStatus: 'done'
    })

    const reset = resetSceneGenerationState(scene)
    expect(reset.videoUrl).toBeUndefined()
    expect(reset.videoStatus).toBe('pending')
    expect(reset.videoHistory).toBeDefined()
    expect(reset.videoHistory).toHaveLength(1)
    expect(reset.videoHistory?.[0]?.videoUrl).toBe('https://example.com/current-video.mp4')
  })

  it('preserves generated video history from both scenes when merging', () => {
    const sceneA = createScene({
      id: 'scene_a',
      title: '场景A',
      description: '第一段。',
      duration: 6,
      videoUrl: 'https://example.com/scene-a-current.mp4',
      videoHistory: [
        {
          id: 'hist_a_old',
          videoUrl: 'https://example.com/scene-a-old.mp4',
          createdAt: '2026-05-01T10:00:00.000Z',
          source: 'generated'
        }
      ],
      videoStatus: 'done',
      referenceStatus: 'done'
    })
    const sceneB = createScene({
      id: 'scene_b',
      title: '场景B',
      description: '第二段。',
      duration: 7,
      videoUrl: 'https://example.com/scene-b-current.mp4',
      videoHistory: [
        {
          id: 'hist_b_old',
          videoUrl: 'https://example.com/scene-b-old.mp4',
          createdAt: '2026-05-02T10:00:00.000Z',
          source: 'generated'
        }
      ],
      videoStatus: 'done',
      referenceStatus: 'done'
    })

    const merged = mergeScenesInList([sceneA, sceneB], 0)
    expect(merged).not.toBeNull()
    expect(merged).toHaveLength(1)

    const mergedScene = merged![0]
    expect(mergedScene).toBeDefined()
    expect(mergedScene?.videoUrl).toBeUndefined()
    expect(mergedScene?.videoStatus).toBe('pending')

    const urls = new Set((mergedScene?.videoHistory || []).map(item => item.videoUrl))
    expect(urls.has('https://example.com/scene-a-old.mp4')).toBe(true)
    expect(urls.has('https://example.com/scene-b-old.mp4')).toBe(true)
    expect(urls.has('https://example.com/scene-a-current.mp4')).toBe(true)
    expect(urls.has('https://example.com/scene-b-current.mp4')).toBe(true)
  })

  it('keeps generated video history for both split scenes', () => {
    const scene = createScene({
      id: 'scene_source',
      title: '原场景',
      description: '第一句。第二句。',
      videoHistory: [
        {
          id: 'hist_1',
          videoUrl: 'https://example.com/scene-source-1.mp4',
          createdAt: '2026-05-03T10:00:00.000Z',
          source: 'generated'
        },
        {
          id: 'hist_2',
          videoUrl: 'https://example.com/scene-source-2.mp4',
          createdAt: '2026-05-04T10:00:00.000Z',
          source: 'generated'
        }
      ],
      videoStatus: 'done',
      referenceStatus: 'done'
    })

    const split = splitSceneInList([scene], 0)
    expect(split).not.toBeNull()
    expect(split).toHaveLength(2)

    const first = split![0]
    const second = split![1]
    expect(first?.videoHistory).toBeDefined()
    expect(second?.videoHistory).toBeDefined()
    expect(first?.videoHistory).toHaveLength(2)
    expect(second?.videoHistory).toHaveLength(2)
    expect(first?.videoHistory).not.toBe(second?.videoHistory)
    expect(first?.videoUrl).toBeUndefined()
    expect(second?.videoUrl).toBeUndefined()
  })
})
