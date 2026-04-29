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

  it('keeps latest reference error visible on environment cards', () => {
    const scenes = [
      createScene({
        id: 'scene_1',
        title: '书房白天',
        description: '顾深在书房里沉思。',
        setting: {
          location: '顾深书房',
          timeOfDay: 'day'
        },
        firstFrame: 'https://example.com/env-ready.png',
        referenceStatus: 'done'
      }),
      createScene({
        id: 'scene_2',
        title: '书房夜晚',
        description: '书房内光线昏暗。',
        setting: {
          location: '顾深书房',
          timeOfDay: 'day'
        },
        referenceStatus: 'error',
        referenceError: 'Input data may contain inappropriate content.'
      })
    ]

    const cards = buildEnvironmentAssetCards({
      scenes,
      resolveSceneDescriptionWithoutAssetMentions
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]?.referenceStatus).toBe('done')
    expect(cards[0]?.referenceError).toBe('Input data may contain inappropriate content.')
  })

  it('merges sibling locations into one root environment card while reading legacy state aliases', () => {
    const ancestralHall = createScene({
      id: 'scene_1',
      title: '祠堂夜祭',
      description: '顾家老宅祠堂里烛火摇曳。',
      setting: {
        location: '顾家老宅祠堂',
        timeOfDay: 'night'
      },
      referenceStatus: 'pending'
    })
    const sideRoom = createScene({
      id: 'scene_2',
      title: '侧室密谈',
      description: '顾家老宅祠堂侧室里有人低声密谈。',
      setting: {
        location: '顾家老宅祠堂侧室',
        timeOfDay: 'night'
      },
      referenceStatus: 'done'
    })

    const cards = buildEnvironmentAssetCards({
      scenes: [ancestralHall, sideRoom],
      environmentPanoramaStates: {
        'env:顾家老宅祠堂侧室||夜晚': {
          panoramaImage: 'https://example.com/legacy-panorama.png'
        }
      },
      resolveSceneDescriptionWithoutAssetMentions
    })

    expect(cards).toHaveLength(1)
    expect(cards[0]?.name).toBe('顾家老宅 / 夜晚')
    expect(cards[0]?.sceneIds).toEqual(['scene_1', 'scene_2'])
    expect(cards[0]?.panoramaImage).toBe('https://example.com/legacy-panorama.png')
  })
})
