import { computed, ref } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterData, SceneData } from '~/lib/asset-workbench-models'
import type { QueueItem } from '~/lib/asset-workbench-types'
import { resolveSceneEnvironmentAssetId } from '~/lib/asset-workbench-environment'
import { buildNextQueueItems } from '~/lib/asset-workbench-progress'

const requestSceneBaselineGenerationMock = vi.fn(async () => 'https://example.com/generated-env.png')
const requestSceneVideoTaskMock = vi.fn(async () => 'video_task_1')
const pollSceneVideoTaskMock = vi.fn(async (): Promise<{
  videoUrl: string
  lastFrame?: string
}> => ({ videoUrl: 'https://example.com/generated-video.mp4' }))
const fetchActiveSceneVideoTasksMock = vi.fn(async (): Promise<Array<{
  taskId: string
  sceneId: string
  status: string
}>> => [])
let useAssetWorkbenchSceneGeneration: typeof import('./useAssetWorkbenchSceneGeneration')['useAssetWorkbenchSceneGeneration']

function keepCurrentVideoInHistory(scene: SceneData) {
  const videoUrl = scene.videoUrl?.trim()
  if (!videoUrl) return

  const history = Array.isArray(scene.videoHistory) ? scene.videoHistory : []
  if (history.some(entry => entry.videoUrl === videoUrl)) return

  scene.videoHistory = [
    {
      id: `test_video_history_${history.length + 1}`,
      videoUrl,
      source: 'legacy'
    },
    ...history
  ]
}

vi.mock('~/lib/asset-workbench-video-tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/asset-workbench-video-tasks')>()
  return {
    ...actual,
    fetchActiveSceneVideoTasks: fetchActiveSceneVideoTasksMock
  }
})

const scenePayloadLanguages = vi.hoisted(() => vi.fn())

vi.mock('~/lib/asset-workbench-scene-generation', async () => {
  return {
    isRetryableVideoImageDownloadError: (error: unknown) => {
      const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase()
      return message.includes('image_download_error')
        || message.includes('image_download_interrupted')
        || message.includes('failed to download the provided image')
        || message.includes('connection dropped while downloading the image')
    },
    buildAssetWorkflowScenePayload: (options: {
      scene: SceneData
      scenes: SceneData[]
      referenceAssetNames?: string[]
      characterLanguages?: Array<{ name: string, language: string, note?: string }>
      resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
    }) => {
      scenePayloadLanguages(options.characterLanguages)
      const referenceAssetNames = Array.isArray(options.referenceAssetNames)
        ? options.referenceAssetNames.map(name => name.trim()).filter(Boolean)
        : undefined
      return {
        id: options.scene.id,
        title: options.scene.title,
        sceneIndex: options.scenes.findIndex(scene => scene.id === options.scene.id) + 1,
        description: options.resolveSceneDescriptionWithoutAssetMentions(options.scene.description),
        dramatic: options.scene.dramatic,
        cameraNote: referenceAssetNames
          ? (referenceAssetNames.length > 0 ? `引用资产：${referenceAssetNames.join('、')}` : undefined)
          : options.scene.cameraNote,
        duration: options.scene.duration,
        setting: options.scene.setting,
        narration: options.scene.narration,
        characters: options.scene.characters
      }
    },
    applySceneBaselineReference: (scene: SceneData, referenceImage: string) => {
      keepCurrentVideoInHistory(scene)
      scene.firstFrame = referenceImage
      scene.lastFrame = undefined
      scene.referenceStatus = 'done'
      scene.referenceError = undefined
      scene.videoUrl = undefined
      scene.videoStatus = 'pending'
      scene.videoError = undefined
    },
    applySceneVideoUrl: (scene: SceneData, videoUrl: string) => {
      keepCurrentVideoInHistory(scene)
      scene.videoUrl = videoUrl
      scene.videoError = undefined
      scene.videoStatus = 'done'
    },
    buildAssetWorkflowVideoReferences: (options: {
      scene: SceneData
      environmentAssetId?: string
      environmentAssetName?: string
      environmentImage: string
      characterImages: string[]
      characterAssets: Array<{
        assetId: string
        name: string
        type: 'character' | 'prop' | 'other'
        image: string
        arkAssetId?: string
        arkAssetStatus?: string
      }>
      continuityFirstFrame?: string
      narrationVoiceAsset?: {
        id: string
        name: string
        audioUrl: string
      }
    }) => ({
      environmentImage: options.environmentImage,
      continuityFirstFrame: options.continuityFirstFrame,
      characterImage: options.characterImages[0],
      characterImages: options.characterImages,
      narrationVoiceAsset: options.narrationVoiceAsset?.audioUrl
        ? {
            id: options.narrationVoiceAsset.id,
            name: options.narrationVoiceAsset.name,
            type: 'other',
            audioUrl: options.narrationVoiceAsset.audioUrl
          }
        : undefined,
      environmentAsset: {
        id: options.environmentAssetId || resolveSceneEnvironmentAssetId(options.scene),
        name: options.environmentAssetName || options.scene.title,
        type: 'environment',
        image: options.environmentImage
      },
      characterAssets: options.characterAssets.map(asset => ({
        id: asset.assetId,
        name: asset.name,
        type: asset.type,
        image: asset.image,
        arkAssetId: asset.arkAssetId,
        arkAssetStatus: asset.arkAssetStatus
      }))
    }),
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
  beforeAll(async () => {
    ;({ useAssetWorkbenchSceneGeneration } = await import('./useAssetWorkbenchSceneGeneration'))
  })

  beforeEach(() => {
    requestSceneBaselineGenerationMock.mockReset()
    requestSceneBaselineGenerationMock.mockImplementation(async () => 'https://example.com/generated-env.png')
    scenePayloadLanguages.mockClear()
    requestSceneVideoTaskMock.mockReset()
    requestSceneVideoTaskMock.mockImplementation(async () => 'video_task_1')
    pollSceneVideoTaskMock.mockReset()
    pollSceneVideoTaskMock.mockImplementation(async () => ({ videoUrl: 'https://example.com/generated-video.mp4' }))
    fetchActiveSceneVideoTasksMock.mockReset()
    fetchActiveSceneVideoTasksMock.mockImplementation(async () => [])
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

  it('retries project persistence before reporting video generation completion', async () => {
    vi.useFakeTimers()
    try {
      const scene = createScene({
        id: 'scene_save_retry',
        title: '保存重试场景',
        description: '主角走入房间。',
        firstFrame: 'https://example.com/env.png',
        referenceStatus: 'done',
        videoStatus: 'pending'
      })
      const saveProject = vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
      const onModelTaskCompleted = vi.fn(async () => undefined)
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
        saveProject,
        refreshCharacterVoiceAssets: async () => undefined,
        generateCharacter: async () => undefined,
        batchGenerateCharacters: async () => undefined,
        persistAutomaticAssetPlan: async () => undefined,
        recordEnvironmentHistory: () => undefined,
        resolveEnvironmentPanoramaState: () => undefined,
        setEnvironmentPanoramaState: () => undefined,
        recordSceneVideoHistory: () => undefined,
        onModelTaskCompleted
      })

      const generation = sceneGeneration.retryScene(scene.id)
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve()
      }
      expect(saveProject).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(500)
      await generation

      expect(saveProject).toHaveBeenCalledTimes(2)
      expect(scene.videoStatus).toBe('done')
      expect(onModelTaskCompleted).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
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

  it('invalidates the next generated video when its continuity frame becomes available', async () => {
    const previousScene = createScene({
      id: 'scene_prev_new_frame',
      title: '走廊前段',
      description: '角色向前奔跑。',
      firstFrame: 'https://example.com/prev-env.png',
      referenceStatus: 'done',
      videoStatus: 'pending'
    })
    const nextScene = createScene({
      id: 'scene_next_existing_video',
      title: '走廊后段',
      description: '角色继续奔跑。',
      firstFrame: 'https://example.com/next-env.png',
      videoUrl: 'https://example.com/next-old-video.mp4',
      referenceStatus: 'done',
      videoStatus: 'done'
    })
    const synchronizeQueueItems = vi.fn()
    pollSceneVideoTaskMock.mockResolvedValueOnce({
      videoUrl: 'https://example.com/prev-new-video.mp4',
      lastFrame: 'https://example.com/prev-new-last-frame.png'
    })

    const sceneGeneration = useAssetWorkbenchSceneGeneration({
      scenes: ref([previousScene, nextScene]),
      characters: ref([]),
      sceneConfigs: ref({
        [previousScene.id]: {
          sceneId: previousScene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'soft',
          continuityNotes: ''
        },
        [nextScene.id]: {
          sceneId: nextScene.id,
          mustReferenceAssetIds: [],
          consistencyLevel: 'soft',
          continuityNotes: '',
          usePreviousLastFrameAsFirstFrame: true
        }
      }),
      propAssets: ref([]),
      queueItems: ref([{ sceneId: previousScene.id, status: 'pending' }]),
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
      synchronizeQueueItems,
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

    await sceneGeneration.retryScene(previousScene.id)

    expect(previousScene.lastFrame).toBe('https://example.com/prev-new-last-frame.png')
    expect(nextScene.videoStatus).toBe('pending')
    expect(nextScene.videoUrl).toBe('https://example.com/next-old-video.mp4')
    expect(synchronizeQueueItems).toHaveBeenCalled()
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
      captureMode: '单视角' as const,
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
      environmentCaptureMode: '单视角',
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
      captureMode: '单视角' as const,
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
          arkAssetId?: string
          arkAssetStatus?: string
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

  it('passes narration voice asset into scene video task references for narration scenes', async () => {
    const scene = createScene({
      id: 'scene_narration_voice_1',
      title: '旁白场景',
      description: '镜头推进。',
      narration: '画外音（音色：女性，沉稳）说：故事开始了。',
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
          mustReferenceAssetIds: ['prop:other_narration_voice'],
          consistencyLevel: 'soft',
          continuityNotes: ''
        }
      }),
      propAssets: ref([
        {
          id: 'other_narration_voice',
          name: '旁白音色',
          description: '女性，沉稳',
          category: 'other',
          voiceAsset: {
            audioUrl: 'https://example.com/narration.mp3',
            locked: true,
            updatedAt: new Date().toISOString()
          }
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
        mustReferenceAssetIds: ['prop:other_narration_voice'],
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
        narrationVoiceAsset?: {
          id: string
          name: string
          type: 'other'
          audioUrl: string
        }
      }
    }]>
    const references = requestCalls[0]?.[0]?.references

    expect(references?.narrationVoiceAsset).toEqual({
      id: 'prop:other_narration_voice',
      name: '旁白音色',
      type: 'other',
      audioUrl: 'https://example.com/narration.mp3'
    })
  })

  describe('queue and task tracking', () => {
    function createSceneConfig(sceneId: string, continuity = false) {
      return {
        sceneId,
        mustReferenceAssetIds: [],
        consistencyLevel: 'soft' as const,
        continuityNotes: '',
        usePreviousLastFrameAsFirstFrame: continuity || undefined
      }
    }

    function createReadyScene(id: string, input: Partial<SceneData> = {}) {
      return createScene({
        id,
        title: `场景 ${id}`,
        description: `${id} 的剧情`,
        firstFrame: `https://example.com/${id}-env.png`,
        referenceStatus: 'done',
        videoStatus: 'pending',
        ...input
      })
    }

    function createHarness(
      sceneList: SceneData[],
      input: {
        continuitySceneIds?: string[]
        queueStatus?: Record<string, QueueItem['status']>
        characters?: CharacterData[]
        mustReferenceAssetIds?: Record<string, string[]>
        generateCharacter?: () => Promise<unknown>
      } = {}
    ) {
      const scenes = ref(sceneList)
      const sceneConfigs = ref(Object.fromEntries(sceneList.map(scene => [
        scene.id,
        {
          ...createSceneConfig(scene.id, input.continuitySceneIds?.includes(scene.id)),
          mustReferenceAssetIds: input.mustReferenceAssetIds?.[scene.id] || []
        }
      ])))
      const queueItems = ref<QueueItem[]>(sceneList.map(scene => ({
        sceneId: scene.id,
        status: input.queueStatus?.[scene.id] || (scene.videoStatus === 'done' ? 'done' : 'pending')
      })))
      const onModelTaskCompleted = vi.fn(async () => undefined)
      const onModelTaskFailed = vi.fn(async () => undefined)
      const recordSceneVideoHistory = vi.fn()
      const saveProject = vi.fn(async () => true)
      // 与真实实现一致：整体替换队列数组，状态变化的 item 换成新对象
      const synchronizeQueueItems = vi.fn(() => {
        queueItems.value = buildNextQueueItems(scenes.value, queueItems.value)
      })
      const sceneGeneration = useAssetWorkbenchSceneGeneration({
        scenes,
        characters: ref(input.characters || []),
        sceneConfigs,
        propAssets: ref([]),
        queueItems,
        batchRunning: ref(false),
        workflowStylePrompt: computed(() => ''),
        projectId: computed(() => 'project_1'),
        projectAspectRatio: ref('16:9'),
        normalizeWorkflowText: value => value,
        resolveUiError: (error, fallback) => error instanceof Error && error.message ? error.message : fallback,
        ensureSceneConfig: sceneId => sceneConfigs.value[sceneId] || createSceneConfig(sceneId),
        resolveAssetName: assetId => assetId,
        resolveSceneDescriptionWithoutAssetMentions: raw => raw || '',
        synchronizeQueueItems,
        saveProject,
        refreshCharacterVoiceAssets: async () => undefined,
        generateCharacter: input.generateCharacter || (async () => undefined),
        batchGenerateCharacters: async () => undefined,
        persistAutomaticAssetPlan: async () => undefined,
        recordEnvironmentHistory: () => undefined,
        resolveEnvironmentPanoramaState: () => undefined,
        setEnvironmentPanoramaState: () => undefined,
        recordSceneVideoHistory,
        onModelTaskCompleted,
        onModelTaskFailed
      })
      return {
        scenes,
        queueItems,
        sceneConfigs,
        sceneGeneration,
        onModelTaskCompleted,
        onModelTaskFailed,
        recordSceneVideoHistory,
        saveProject
      }
    }

    function createDeferred<T>() {
      let resolve!: (value: T) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    async function flushAsync(rounds = 20) {
      for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve()
      }
    }

    it('does not generate the next scene environment when a single video references it', async () => {
      const current = createReadyScene('scene_current')
      const next = createReadyScene('scene_next', {
        firstFrame: undefined,
        referenceStatus: 'pending'
      })
      const harness = createHarness([current, next], {
        mustReferenceAssetIds: {
          [current.id]: [`scene:${next.id}`]
        }
      })

      await harness.sceneGeneration.retryScene(current.id)

      expect(requestSceneBaselineGenerationMock).not.toHaveBeenCalled()
      expect(requestSceneVideoTaskMock).not.toHaveBeenCalled()
      expect(next.referenceStatus).toBe('pending')
      expect(current.videoError).toContain('缺少环境图')
    })

    it('regenerates a finished next scene when the batch invalidates it through continuity', async () => {
      const first = createReadyScene('scene_a')
      const second = createReadyScene('scene_b', {
        videoUrl: 'https://example.com/b-old.mp4',
        videoStatus: 'done'
      })
      requestSceneVideoTaskMock
        .mockResolvedValueOnce('task_a')
        .mockResolvedValueOnce('task_b')
      pollSceneVideoTaskMock
        .mockResolvedValueOnce({
          videoUrl: 'https://example.com/a-new.mp4',
          lastFrame: 'https://example.com/a-last.png'
        })
        .mockResolvedValueOnce({ videoUrl: 'https://example.com/b-new.mp4' })
      const harness = createHarness([first, second], { continuitySceneIds: ['scene_b'] })

      await harness.sceneGeneration.runBatchSceneGeneration()

      expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(2)
      const requestCalls = requestSceneVideoTaskMock.mock.calls as unknown as Array<[{
        references: { continuityFirstFrame?: string }
      }]>
      expect(requestCalls[1]?.[0].references.continuityFirstFrame).toBe('https://example.com/a-last.png')
      expect(second.videoUrl).toBe('https://example.com/b-new.mp4')
      expect(harness.queueItems.value.map(item => item.status)).toEqual(['done', 'done'])
    })

    it('waits on the original task when retrying after status polling was interrupted', async () => {
      const { VideoTaskStatusUnavailableError } = await import('~/lib/asset-workbench-video-tasks')
      const scene = createReadyScene('scene_retry')
      requestSceneVideoTaskMock.mockResolvedValueOnce('task_original')
      pollSceneVideoTaskMock
        .mockRejectedValueOnce(new VideoTaskStatusUnavailableError('task_original'))
        .mockResolvedValueOnce({ videoUrl: 'https://example.com/retry.mp4' })
      const harness = createHarness([scene])

      await harness.sceneGeneration.retryScene(scene.id)
      expect(scene.videoStatus).toBe('error')
      expect(harness.queueItems.value[0]?.status).toBe('error')

      await harness.sceneGeneration.retryScene(scene.id)

      expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(1)
      expect(pollSceneVideoTaskMock).toHaveBeenNthCalledWith(2, 'task_original')
      expect(scene.videoStatus).toBe('done')
      expect(scene.videoUrl).toBe('https://example.com/retry.mp4')
    })

    it('submits a new task after the original task has failed', async () => {
      const scene = createReadyScene('scene_failed_task')
      requestSceneVideoTaskMock
        .mockResolvedValueOnce('task_failed')
        .mockResolvedValueOnce('task_new')
      pollSceneVideoTaskMock
        .mockRejectedValueOnce(new Error('内容审核未通过'))
        .mockResolvedValueOnce({ videoUrl: 'https://example.com/new.mp4' })
      const harness = createHarness([scene])

      await harness.sceneGeneration.retryScene(scene.id)
      await harness.sceneGeneration.retryScene(scene.id)

      expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(2)
      expect(scene.videoUrl).toBe('https://example.com/new.mp4')
    })

    it('keeps an outdated result in history and tells the user', async () => {
      const scene = createReadyScene('scene_edited')
      const poll = createDeferred<{ videoUrl: string }>()
      pollSceneVideoTaskMock.mockReturnValueOnce(poll.promise)
      const harness = createHarness([scene])

      const generation = harness.sceneGeneration.retryScene(scene.id)
      await flushAsync()
      scene.description = '生成期间改过的剧情'
      poll.resolve({ videoUrl: 'https://example.com/outdated.mp4' })
      await generation

      expect(scene.videoStatus).toBe('pending')
      expect(scene.videoUrl).toBeUndefined()
      expect(harness.recordSceneVideoHistory).toHaveBeenCalledWith(
        scene.id,
        'https://example.com/outdated.mp4',
        { source: 'generated' }
      )
      expect(harness.saveProject).toHaveBeenCalled()
      expect(harness.onModelTaskFailed).toHaveBeenCalledWith(expect.objectContaining({
        title: '分镜视频结果未采用'
      }))
    })

    it('uses the explicitly bound identity for dialogue language when names match', async () => {
      const scene = createReadyScene('scene_language', { characters: [{ name: '小明', assetId: 'char:older' }] })
      const harness = createHarness([scene], { characters: [
        { id: 'young', name: '小明', appearance: '少年', baseImage: 'young.png', role: '主角', language: 'mandarin', generating: false, generatingViews: false },
        { id: 'older', name: '小明', appearance: '老年', baseImage: 'older.png', role: '主角', language: 'cantonese', generating: false, generatingViews: false }
      ] })
      await harness.sceneGeneration.retryScene(scene.id)
      expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(1)
      expect(scenePayloadLanguages).toHaveBeenCalledWith([{ name: '小明', language: '粤语', note: undefined }])
    })

    it('shows preparation failures on the scene', async () => {
      const scene = createReadyScene('scene_missing_character', {
        characters: [{ name: '小明', assetId: 'char:ming' }]
      })
      const harness = createHarness([scene], {
        characters: [{ id: 'ming', name: '小明', appearance: '短发', role: '主角', generating: false, generatingViews: false } as CharacterData],
        mustReferenceAssetIds: { [scene.id]: ['char:ming'] },
        generateCharacter: async () => {
          throw new Error('角色图额度不足')
        }
      })

      await harness.sceneGeneration.retryScene(scene.id)

      expect(requestSceneVideoTaskMock).not.toHaveBeenCalled()
      expect(scene.videoStatus).toBe('error')
      expect(scene.videoError).toContain('角色图额度不足')
      expect(harness.queueItems.value[0]?.status).toBe('error')
      expect(harness.onModelTaskFailed).toHaveBeenCalledWith(expect.objectContaining({
        title: '分镜视频生成失败'
      }))
    })

    it('joins an in-flight generation instead of submitting the same scene twice', async () => {
      const scene = createReadyScene('scene_double_click')
      const poll = createDeferred<{ videoUrl: string }>()
      pollSceneVideoTaskMock.mockReturnValueOnce(poll.promise)
      const harness = createHarness([scene])

      const first = harness.sceneGeneration.retryScene(scene.id)
      await flushAsync()
      const second = harness.sceneGeneration.retryScene(scene.id)
      poll.resolve({ videoUrl: 'https://example.com/once.mp4' })
      await Promise.all([first, second])

      expect(requestSceneVideoTaskMock).toHaveBeenCalledTimes(1)
      expect(scene.videoUrl).toBe('https://example.com/once.mp4')
    })

    it('runs independent scenes in parallel while continuity scenes wait for their source', async () => {
      const sceneList = ['s1', 's2', 's3', 's4', 's5'].map(id => createReadyScene(id))
      const polls = new Map<string, ReturnType<typeof createDeferred<{ videoUrl: string, lastFrame?: string }>>>()
      requestSceneVideoTaskMock.mockImplementation((async (options: { scenePayload: { id: string } }) => {
        return `task_${options.scenePayload.id}`
      }) as never)
      pollSceneVideoTaskMock.mockImplementation(((taskId: string) => {
        const deferred = createDeferred<{ videoUrl: string, lastFrame?: string }>()
        polls.set(taskId, deferred)
        return deferred.promise
      }) as never)
      const harness = createHarness(sceneList, { continuitySceneIds: ['s2'] })

      try {
        const batch = harness.sceneGeneration.runBatchSceneGeneration()
        await flushAsync(40)

        // s2 依赖 s1 的尾帧，先跳过；同时最多 3 个
        expect([...polls.keys()]).toEqual(['task_s1', 'task_s3', 'task_s4'])

        polls.get('task_s1')!.resolve({
          videoUrl: 'https://example.com/s1.mp4',
          lastFrame: 'https://example.com/s1-last.png'
        })
        await flushAsync(40)
        expect([...polls.keys()]).toEqual(['task_s1', 'task_s3', 'task_s4', 'task_s2'])

        for (const id of ['task_s3', 'task_s4', 'task_s2']) {
          polls.get(id)!.resolve({ videoUrl: `https://example.com/${id}.mp4` })
          await flushAsync(40)
        }
        polls.get('task_s5')!.resolve({ videoUrl: 'https://example.com/s5.mp4' })
        await batch

        const requestCalls = requestSceneVideoTaskMock.mock.calls as unknown as Array<[{
          scenePayload: { id: string }
          references: { continuityFirstFrame?: string }
        }]>
        const s2Request = requestCalls.find(call => call[0].scenePayload.id === 's2')
        expect(s2Request?.[0].references.continuityFirstFrame).toBe('https://example.com/s1-last.png')
        expect(sceneList.every(scene => scene.videoStatus === 'done')).toBe(true)
      } finally {
        // beforeEach 会恢复默认 mock
      }
    })

    it('resumes tasks that were still running before the page reloaded', async () => {
      const scene = createReadyScene('scene_reloaded', {
        videoUrl: 'https://example.com/old.mp4',
        videoStatus: 'done'
      })
      fetchActiveSceneVideoTasksMock.mockResolvedValueOnce([
        { taskId: 'task_running', sceneId: scene.id, status: 'processing' },
        { taskId: 'task_unknown', sceneId: 'scene_deleted', status: 'processing' }
      ])
      pollSceneVideoTaskMock.mockResolvedValueOnce({ videoUrl: 'https://example.com/resumed.mp4' })
      const harness = createHarness([scene])

      await harness.sceneGeneration.resumeActiveSceneVideoTasks()

      expect(fetchActiveSceneVideoTasksMock).toHaveBeenCalledWith('project_1')
      expect(pollSceneVideoTaskMock).toHaveBeenCalledTimes(1)
      expect(pollSceneVideoTaskMock).toHaveBeenCalledWith('task_running')
      expect(requestSceneVideoTaskMock).not.toHaveBeenCalled()
      expect(scene.videoUrl).toBe('https://example.com/resumed.mp4')
      expect(scene.videoStatus).toBe('done')
      expect(harness.saveProject).toHaveBeenCalled()
    })
  })
})
