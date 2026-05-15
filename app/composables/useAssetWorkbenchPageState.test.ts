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
      episodePlan: ref([]),
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

  it('does not resolve scene reference image from non-identical panorama state keys', () => {
    const scene = createScene({
      id: 'scene_alias_1',
      title: '办公室冲突',
      description: '办公室内争执升级。',
      setting: {
        location: '星耀科技公司办公室',
        timeOfDay: 'day'
      }
    })

    const pageState = useAssetWorkbenchPageState({
      scenes: ref([scene]),
      characters: ref([]),
      episodePlan: ref([]),
      propAssets: ref([]),
      environmentAssetHistories: ref({}),
      environmentPanoramaStates: ref({
        'env:星耀科技公司/办公室||白天': {
          singleViewImage: 'https://example.com/slash-alias.png'
        }
      }),
      sceneConfigs: ref({}),
      selectedSceneId: ref('scene_alias_1'),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.resolveSceneReferenceImage(scene)).toBeUndefined()
    expect(pageState.environmentAssetCards.value[0]?.referenceImage).toBeUndefined()
  })

  it('merges environment hints from episode plan into environment cards', () => {
    const pageState = useAssetWorkbenchPageState({
      scenes: ref([]),
      characters: ref([]),
      episodePlan: ref([
        {
          id: 'episode_001',
          title: '第1集：雨夜追踪',
          index: 1,
          startOffset: 0,
          endOffset: 1200,
          charCount: 1200,
          episodeAssets: {
            characters: [],
            props: [],
            environments: [
              {
                location: '医院走廊',
                timeOfDay: '夜晚',
                mood: '冷白灯光，紧张压抑'
              }
            ]
          }
        }
      ]),
      propAssets: ref([]),
      environmentAssetHistories: ref({}),
      environmentPanoramaStates: ref({}),
      sceneConfigs: ref({}),
      selectedSceneId: ref(''),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.environmentAssetCards.value).toHaveLength(1)
    expect(pageState.environmentAssetCards.value[0]?.id).toBe('env:医院走廊||夜晚')
    expect(pageState.environmentAssetCards.value[0]?.description).toBe('冷白灯光，紧张压抑')
  })

  it('normalizes night variants in episode hints into one environment asset', () => {
    const pageState = useAssetWorkbenchPageState({
      scenes: ref([]),
      characters: ref([]),
      episodePlan: ref([
        {
          id: 'episode_001',
          title: '第1集：雨夜追踪',
          index: 1,
          startOffset: 0,
          endOffset: 1200,
          charCount: 1200,
          episodeAssets: {
            characters: [],
            props: [],
            environments: [
              {
                location: '医院走廊',
                timeOfDay: '夜里',
                mood: '冷白灯光'
              }
            ]
          }
        },
        {
          id: 'episode_002',
          title: '第2集：追查加深',
          index: 2,
          startOffset: 1200,
          endOffset: 2400,
          charCount: 1200,
          episodeAssets: {
            characters: [],
            props: [],
            environments: [
              {
                location: '医院走廊',
                timeOfDay: '深夜',
                mood: '压抑紧张的追查'
              }
            ]
          }
        }
      ]),
      propAssets: ref([]),
      environmentAssetHistories: ref({}),
      environmentPanoramaStates: ref({}),
      sceneConfigs: ref({}),
      selectedSceneId: ref(''),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.environmentAssetCards.value).toHaveLength(1)
    expect(pageState.environmentAssetCards.value[0]?.id).toBe('env:医院走廊||夜晚')
    expect(pageState.environmentAssetCards.value[0]?.name).toBe('医院走廊 / 夜晚')
    expect(pageState.environmentAssetCards.value[0]?.sceneTitles).toContain('第1集：雨夜追踪（目录）')
    expect(pageState.environmentAssetCards.value[0]?.sceneTitles).toContain('第2集：追查加深（目录）')
  })

  it('reuses legacy history keyed by unnormalized time-of-day in episode hints', () => {
    const pageState = useAssetWorkbenchPageState({
      scenes: ref([]),
      characters: ref([]),
      episodePlan: ref([
        {
          id: 'episode_001',
          title: '第1集：雨夜追踪',
          index: 1,
          startOffset: 0,
          endOffset: 1200,
          charCount: 1200,
          episodeAssets: {
            characters: [],
            props: [],
            environments: [
              {
                location: '医院走廊',
                timeOfDay: '深夜',
                mood: '冷白灯光，紧张压抑'
              }
            ]
          }
        }
      ]),
      propAssets: ref([]),
      environmentAssetHistories: ref({
        'env:医院走廊||深夜': [
          {
            id: 'legacy_history_1',
            image: 'https://example.com/legacy-midnight.png',
            createdAt: '2026-05-06T12:00:00.000Z',
            source: 'legacy'
          }
        ]
      }),
      environmentPanoramaStates: ref({}),
      sceneConfigs: ref({}),
      selectedSceneId: ref(''),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.environmentAssetCards.value).toHaveLength(1)
    expect(pageState.environmentAssetCards.value[0]?.id).toBe('env:医院走廊||夜晚')
    expect(pageState.environmentAssetCards.value[0]?.referenceImage).toBe('https://example.com/legacy-midnight.png')
    expect(pageState.environmentAssetCards.value[0]?.referenceStatus).toBe('done')
  })

  it('marks episode environment hints ready when a generated history image exists', () => {
    const pageState = useAssetWorkbenchPageState({
      scenes: ref([]),
      characters: ref([]),
      episodePlan: ref([
        {
          id: 'episode_001',
          title: '第1集：雨夜追踪',
          index: 1,
          startOffset: 0,
          endOffset: 1200,
          charCount: 1200,
          episodeAssets: {
            characters: [],
            props: [],
            environments: [
              {
                location: '医院走廊',
                timeOfDay: '夜晚',
                mood: '冷白灯光，紧张压抑'
              }
            ]
          }
        }
      ]),
      propAssets: ref([]),
      environmentAssetHistories: ref({
        'env:医院走廊||夜晚': [
          {
            id: 'history_1',
            image: 'https://example.com/generated-env.png',
            createdAt: '2026-05-06T10:00:00.000Z',
            source: 'generated'
          }
        ]
      }),
      environmentPanoramaStates: ref({}),
      sceneConfigs: ref({}),
      selectedSceneId: ref(''),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.environmentAssetCards.value[0]?.referenceImage).toBe('https://example.com/generated-env.png')
    expect(pageState.environmentAssetCards.value[0]?.referenceStatus).toBe('done')
  })

  it('prefers cropped history image over panorama image for episode environment hints', () => {
    const pageState = useAssetWorkbenchPageState({
      scenes: ref([]),
      characters: ref([]),
      episodePlan: ref([
        {
          id: 'episode_001',
          title: '第1集：雨夜追踪',
          index: 1,
          startOffset: 0,
          endOffset: 1200,
          charCount: 1200,
          episodeAssets: {
            characters: [],
            props: [],
            environments: [
              {
                location: '医院走廊',
                timeOfDay: '夜晚',
                mood: '冷白灯光，紧张压抑'
              }
            ]
          }
        }
      ]),
      propAssets: ref([]),
      environmentAssetHistories: ref({
        'env:医院走廊||夜晚': [
          {
            id: 'history_2',
            image: 'https://example.com/cropped-env.png',
            createdAt: '2026-05-06T11:00:00.000Z',
            source: 'cropped'
          }
        ]
      }),
      environmentPanoramaStates: ref({
        'env:医院走廊||夜晚': {
          panoramaImage: 'https://example.com/panorama-env.png'
        }
      }),
      sceneConfigs: ref({}),
      selectedSceneId: ref(''),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.environmentAssetCards.value[0]?.referenceImage).toBe('https://example.com/cropped-env.png')
    expect(pageState.environmentAssetCards.value[0]?.panoramaImage).toBe('https://example.com/panorama-env.png')
  })

  it('marks assets incomplete when a normal prop has no reference image', () => {
    const pageState = useAssetWorkbenchPageState({
      scenes: ref([]),
      characters: ref([]),
      episodePlan: ref([]),
      propAssets: ref([
        {
          id: 'prop_1',
          name: '铜铃',
          description: '旧铜铃',
          category: 'prop'
        }
      ]),
      environmentAssetHistories: ref({}),
      environmentPanoramaStates: ref({}),
      sceneConfigs: ref({}),
      selectedSceneId: ref(''),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      supportsExplicitVoiceAudioReference: ref(false),
      queueItems: ref([]),
      resolveStyleById: () => null,
      resolveSceneDescriptionWithoutAssetMentions,
      uniqueSorted: values => Array.from(new Set(values.filter(Boolean)))
    })

    expect(pageState.assetsReady.value).toBe(false)
    expect(pageState.assetsPrimaryActionLabel.value).toBe('自动补齐缺失资产')
  })
})
