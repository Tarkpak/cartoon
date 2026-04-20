import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import { resolveSceneDescriptionWithoutAssetMentions } from '~/lib/asset-workbench-mention-tokens'
import { useAssetWorkbenchPageState } from './useAssetWorkbenchPageState'

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

describe('useAssetWorkbenchPageState', () => {
  it('resolves scene reference image from environment asset history when scene frames are empty', () => {
    const scene = createScene({
      id: 'scene_1',
      title: '雨夜走廊',
      description: '医院走廊里一片寂静。',
      setting: {
        location: '医院-走廊',
        timeOfDay: 'night'
      }
    })

    const pageState = useAssetWorkbenchPageState({
      scenes: ref([scene]),
      characters: ref([]),
      propAssets: ref([]),
      environmentAssetHistories: ref({
        'env:医院-走廊||夜晚': [
          {
            id: 'history_1',
            image: 'https://example.com/history-preview.png',
            createdAt: '2026-04-20T10:00:00.000Z',
            source: 'legacy'
          }
        ]
      }),
      environmentPanoramaStates: ref({}),
      sceneConfigs: ref({}),
      selectedSceneId: ref('scene_1'),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.environmentAssetCards.value[0]?.referenceImage).toBe(
      'https://example.com/history-preview.png'
    )
    expect(pageState.resolveSceneReferenceImage(scene)).toBe(
      'https://example.com/history-preview.png'
    )
  })
})
