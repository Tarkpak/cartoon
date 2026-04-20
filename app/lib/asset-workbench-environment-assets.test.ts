import { describe, expect, it } from 'vitest'
import type { SceneData } from './asset-workbench-models'
import { resolveSceneDescriptionWithoutAssetMentions } from './asset-workbench-mention-tokens'
import {
  buildEnvironmentAssetCards,
  buildEnvironmentDisplayAssets
} from './asset-workbench-environment-assets'
import { resolveSceneEnvironmentAssetId } from './asset-workbench-environment-core'

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

describe('buildEnvironmentAssetCards', () => {
  it('falls back to environment history preview when scene reference image was reset', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '雨夜走廊',
      description: '医院走廊里一片寂静。',
      setting: {
        location: '医院-走廊',
        timeOfDay: 'night'
      },
      referenceStatus: 'pending'
    })
    const assetId = resolveSceneEnvironmentAssetId(scene)

    const cards = buildEnvironmentAssetCards({
      scenes: [scene],
      environmentAssetHistories: {
        [assetId]: [
          {
            id: 'history_1',
            image: 'https://example.com/history-preview.png',
            createdAt: '2026-04-20T10:00:00.000Z',
            source: 'legacy'
          }
        ]
      },
      resolveSceneDescriptionWithoutAssetMentions
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]?.referenceImage).toBe('https://example.com/history-preview.png')
    expect(cards[0]?.assetHistory?.[0]?.image).toBe('https://example.com/history-preview.png')

    const displayAssets = buildEnvironmentDisplayAssets(cards)
    expect(displayAssets[0]?.referenceImage).toBe('https://example.com/history-preview.png')
  })
})
