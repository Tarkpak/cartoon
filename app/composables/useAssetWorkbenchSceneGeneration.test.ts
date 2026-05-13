import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import type { QueueItem } from '~/lib/asset-workbench-types'
import { resolveSceneEnvironmentAssetId } from '~/lib/asset-workbench-environment'
import { useAssetWorkbenchSceneGeneration } from './useAssetWorkbenchSceneGeneration'

const {
  requestSceneBaselineGenerationMock,
  requestSceneVideoTaskMock,
  pollSceneVideoTaskMock
} = vi.hoisted(() => {
  return {
    requestSceneBaselineGenerationMock: vi.fn(async () => 'https://example.com/generated-env.png'),
    requestSceneVideoTaskMock: vi.fn(async () => 'video_task_1'),
    pollSceneVideoTaskMock: vi.fn(async () => ({ videoUrl: 'https://example.com/generated-video.mp4' }))
  }
})

vi.mock('~/lib/asset-workbench-scene-generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/asset-workbench-scene-generation')>()
  return {
    ...actual,
    requestSceneBaselineGeneration: requestSceneBaselineGenerationMock,
    requestSceneVideoTask: requestSceneVideoTaskMock,
    pollSceneVideoTask: pollSceneVideoTaskMock
  }
})

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

describe('useAssetWorkbenchSceneGeneration', () => {
  beforeEach(() => {
    requestSceneBaselineGenerationMock.mockClear()
    requestSceneVideoTaskMock.mockClear()
    pollSceneVideoTaskMock.mockClear()
  })

  it('passes explicit consistency reference image for baseline generation', async () => {
    const scene = createScene({
      id: 'scene_target',
      title: '客厅夜晚',
      description: '同一客厅夜晚氛围镜头。',
      setting: {
        location: '顾家老宅-客厅',
        timeOfDay: 'night'
      },
      referenceStatus: 'pending'
    })

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'soft',
          continuityNotes: ''
        }
      }),
      propAssets: ref([]),
      queueItems: ref([]),
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: sceneId => ({
        sceneId,
        mustReferenceAssetIds: [],
        consistencyLevel: 'soft',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject: vi.fn(async () => undefined),
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory: () => undefined,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState: () => undefined,
      resolveSceneBaselineReferenceImage: () => undefined,
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await sceneGeneration.generateSceneBaseline(scene.id, {
      consistencyReferenceImage: 'https://example.com/living-room-day.png'
    })

    expect(requestSceneBaselineGenerationMock).toHaveBeenCalledTimes(1)
    const requestCalls = requestSceneBaselineGenerationMock.mock.calls as unknown as Array<[{
      consistencyReferenceImage?: string
      referenceImage?: string
      customPrompt?: string
    }]>
    const requestPayload = requestCalls[0]?.[0]
    expect(requestPayload?.consistencyReferenceImage).toBe('https://example.com/living-room-day.png')
    expect(requestPayload?.referenceImage).toBeUndefined()
    expect(requestPayload?.customPrompt).toBeUndefined()
  })

  it('reuses prepared environment reference image and skips baseline generation request', async () => {
    const scene = createScene({
      id: 'scene_1',
      title: '医院走廊',
      description: '主角冲进走廊。',
      setting: { location: '医院-走廊', timeOfDay: 'night' },
      referenceStatus: 'pending',
      videoStatus: 'pending'
    })
    const queueItems = ref<QueueItem[]>([
      { sceneId: scene.id, status: 'pending' }
    ])
    const saveProject = vi.fn(async () => undefined)

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'lock',
          continuityNotes: ''
        }
      }),
      propAssets: ref([]),
      queueItems,
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: () => ({
        sceneId: scene.id,
        mustReferenceAssetIds: [],
        consistencyLevel: 'lock',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject,
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory: () => undefined,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState: () => undefined,
      resolveSceneBaselineReferenceImage: () => 'https://example.com/prepared-env.png',
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await sceneGeneration.retryScene(scene.id)

    expect(requestSceneBaselineGenerationMock).not.toHaveBeenCalled()
    expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(1)
    expect(scene.firstFrame).toBe('https://example.com/prepared-env.png')
    expect(scene.videoStatus).toBe('done')
    expect(saveProject).toHaveBeenCalled()
  })

  it('sends previous scene last frame as continuity first frame when enabled', async () => {
    const previousScene = createScene({
      id: 'scene_prev',
      title: '走廊前段',
      description: '角色向前奔跑。',
      setting: { location: '医院-走廊', timeOfDay: 'night' },
      firstFrame: 'https://example.com/prev-env.png',
      lastFrame: 'https://example.com/prev-last-frame.png',
      referenceStatus: 'done',
      videoStatus: 'done'
    })
    const scene = createScene({
      id: 'scene_next',
      title: '走廊后段',
      description: '角色继续奔跑。',
      setting: { location: '医院-走廊', timeOfDay: 'night' },
      firstFrame: 'https://example.com/next-env.png',
      referenceStatus: 'done',
      videoStatus: 'pending'
    })

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([previousScene, scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [previousScene.id]: {
          sceneId: previousScene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'soft',
          continuityNotes: ''
        },
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'soft',
          continuityNotes: '',
          usePreviousLastFrameAsFirstFrame: true,
          continuityLinkReason: '同一走廊连续奔跑'
        }
      }),
      propAssets: ref([]),
      queueItems: ref([{ sceneId: scene.id, status: 'pending' }]),
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: sceneId => ({
        sceneId,
        mustReferenceAssetIds: [],
        consistencyLevel: 'soft',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject: vi.fn(async () => undefined),
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory: () => undefined,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState: () => undefined,
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await sceneGeneration.retryScene(scene.id)

    expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(1)
    const requestCalls = requestSceneVideoTaskMock.mock.calls as unknown as Array<[{
      references: { continuityFirstFrame?: string }
    }]>
    const requestOptions = requestCalls[0]?.[0]
    expect(requestOptions?.references.continuityFirstFrame)
      .toBe('https://example.com/prev-last-frame.png')
  })

  it('falls back to panorama image when automatic crop generation fails', async () => {
    const scene = createScene({
      id: 'scene_2',
      title: '医院走廊',
      description: '主角冲进走廊。',
      setting: { location: '医院-走廊', timeOfDay: 'night' },
      referenceStatus: 'pending',
      videoStatus: 'pending'
    })
    const expectedEnvironmentAssetId = resolveSceneEnvironmentAssetId(scene)
    const saveProject = vi.fn(async () => undefined)
    const setEnvironmentPanoramaState = vi.fn()
    const recordEnvironmentHistory = vi.fn()
    const createEnvironmentCropImage = vi.fn(async () => {
      throw new Error('环境全景图加载失败，请稍后重试')
    })

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'lock',
          continuityNotes: ''
        }
      }),
      propAssets: ref([]),
      queueItems: ref([]),
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: () => ({
        sceneId: scene.id,
        mustReferenceAssetIds: [],
        consistencyLevel: 'lock',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject,
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState,
      createEnvironmentCropImage,
      resolveSceneBaselineReferenceImage: () => undefined,
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await expect(sceneGeneration.generateSceneBaseline(scene.id)).resolves.toBeUndefined()

    expect(requestSceneBaselineGenerationMock).toHaveBeenCalledTimes(1)
    expect(createEnvironmentCropImage).toHaveBeenCalledWith({
      assetId: expectedEnvironmentAssetId,
      sourceImage: 'https://example.com/generated-env.png',
      crop: undefined,
      aspectRatio: '16:9'
    })
    expect(scene.referenceStatus).toBe('done')
    expect(scene.firstFrame).toBe('https://example.com/generated-env.png')
    expect(setEnvironmentPanoramaState).toHaveBeenCalledWith(expectedEnvironmentAssetId, {
      panoramaImage: 'https://example.com/generated-env.png',
      crop: undefined
    })
    expect(recordEnvironmentHistory).toHaveBeenCalledWith(
      expectedEnvironmentAssetId,
      'https://example.com/generated-env.png',
      expect.objectContaining({ source: 'generated' })
    )
    expect(saveProject).toHaveBeenCalled()
  })

  it('prefers four-view environment reference for multi-view scenes while keeping both outputs', async () => {
    const scene = createScene({
      id: 'scene_multi_view',
      title: '医院走廊对峙',
      description: '0-3秒：中景，主角快步进入。\\n3-6秒：特写，反派抬手示意。',
      setting: { location: '医院-走廊', timeOfDay: 'night' },
      referenceStatus: 'pending',
      videoStatus: 'pending'
    })
    const expectedEnvironmentAssetId = resolveSceneEnvironmentAssetId(scene)
    const setEnvironmentPanoramaState = vi.fn()
    const recordEnvironmentHistory = vi.fn()
    const createEnvironmentCropImage = vi.fn(async () => ({
      imageUrl: 'https://example.com/single-view.png',
      crop: {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.3
      },
      captureMode: 'single' as const,
      singleViewImage: 'https://example.com/single-view.png',
      fourViewImage: 'https://example.com/four-view.png'
    }))

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'lock',
          continuityNotes: ''
        }
      }),
      propAssets: ref([]),
      queueItems: ref([]),
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: () => ({
        sceneId: scene.id,
        mustReferenceAssetIds: [],
        consistencyLevel: 'lock',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject: vi.fn(async () => undefined),
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState,
      createEnvironmentCropImage,
      resolveSceneBaselineReferenceImage: () => undefined,
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await expect(sceneGeneration.generateSceneBaseline(scene.id)).resolves.toBeUndefined()

    expect(scene.firstFrame).toBe('https://example.com/four-view.png')
    expect(setEnvironmentPanoramaState).toHaveBeenCalledWith(expectedEnvironmentAssetId, {
      panoramaImage: 'https://example.com/generated-env.png',
      crop: {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.3
      },
      singleViewImage: 'https://example.com/single-view.png',
      fourViewImage: 'https://example.com/four-view.png'
    })
    expect(recordEnvironmentHistory).toHaveBeenCalledWith(
      expectedEnvironmentAssetId,
      'https://example.com/four-view.png',
      expect.objectContaining({ source: 'generated' })
    )
  })

  it('respects parsed environmentCaptureMode tag over heuristic fallback', async () => {
    const scene = createScene({
      id: 'scene_tagged_single',
      title: '医院走廊对峙',
      description: '0-3秒：中景，主角快步进入。\\n3-6秒：特写，反派抬手示意。',
      setting: { location: '医院-走廊', timeOfDay: 'night' },
      environmentCaptureMode: 'single',
      referenceStatus: 'pending',
      videoStatus: 'pending'
    })
    const createEnvironmentCropImage = vi.fn(async () => ({
      imageUrl: 'https://example.com/single-view.png',
      crop: {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.3
      },
      captureMode: 'single' as const,
      singleViewImage: 'https://example.com/single-view.png',
      fourViewImage: 'https://example.com/four-view.png'
    }))

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'lock',
          continuityNotes: ''
        }
      }),
      propAssets: ref([]),
      queueItems: ref([]),
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: () => ({
        sceneId: scene.id,
        mustReferenceAssetIds: [],
        consistencyLevel: 'lock',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject: vi.fn(async () => undefined),
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory: () => undefined,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState: () => undefined,
      createEnvironmentCropImage,
      resolveSceneBaselineReferenceImage: () => undefined,
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await expect(sceneGeneration.generateSceneBaseline(scene.id)).resolves.toBeUndefined()
    expect(scene.firstFrame).toBe('https://example.com/single-view.png')
  })

  it('passes prop and other reference images into scene video task references', async () => {
    const scene = createScene({
      id: 'scene_refs_1',
      title: '证物检查',
      description: '镜头对准桌面证物。\n\n[引用资产]\n@工作证\n@手电筒',
      firstFrame: 'https://example.com/env.png',
      referenceStatus: 'done',
      videoStatus: 'pending'
    })

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([scene]),
      characters: ref([]),
      sceneConfigs: ref({
        [scene.id]: {
          sceneId: scene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'soft',
          continuityNotes: ''
        }
      }),
      propAssets: ref([
        {
          id: 'prop_card',
          name: '工作证',
          description: '',
          category: 'prop',
          referenceImage: 'https://example.com/card.png'
        },
        {
          id: 'prop_flashlight',
          name: '手电筒',
          description: '',
          category: 'other',
          referenceImage: 'https://example.com/flashlight.png'
        }
      ]),
      queueItems: ref([{ sceneId: scene.id, status: 'pending' }]),
      batchRunning: ref(false),
      workflowStylePrompt: computed(() => ''),
      projectAspectRatio: ref('16:9'),
      normalizeWorkflowText: value => value,
      resolveUiError: (_error, fallback) => fallback,
      ensureSceneConfig: () => ({
        sceneId: scene.id,
        mustReferenceAssetIds: [],
        consistencyLevel: 'soft',
        continuityNotes: ''
      }),
      resolveAssetName: assetId => assetId,
      resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
      synchronizeQueueItems: () => undefined,
      saveProject: vi.fn(async () => undefined),
      refreshCharacterVoiceAssets: async () => undefined,
      generateCharacter: async () => undefined,
      batchGenerateCharacters: async () => undefined,
      persistAutomaticAssetPlan: async () => undefined,
      recordEnvironmentHistory: () => undefined,
      resolveEnvironmentPanoramaState: () => undefined,
      setEnvironmentPanoramaState: () => undefined,
      recordSceneVideoHistory: () => undefined,
      onModelTaskCompleted: async () => undefined
    })

    await sceneGeneration.retryScene(scene.id)

    expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(1)
    const requestCalls = requestSceneVideoTaskMock.mock.calls as unknown as Array<[{
      references: {
        characterImage?: string
        characterImages: string[]
        characterAssets: Array<{
          id: string
          name: string
          type: 'character' | 'prop' | 'other'
          image: string
        }>
      }
    }]>
    const references = requestCalls[0]?.[0]?.references

    expect(references?.characterImage).toBe('https://example.com/card.png')
    expect(references?.characterImages).toEqual([
      'https://example.com/card.png',
      'https://example.com/flashlight.png'
    ])
    expect(references?.characterAssets).toEqual([
      {
        id: 'prop:prop_card',
        name: '工作证',
        type: 'prop',
        image: 'https://example.com/card.png'
      },
      {
        id: 'prop:prop_flashlight',
        name: '手电筒',
        type: 'other',
        image: 'https://example.com/flashlight.png'
      }
    ])
  })
})
