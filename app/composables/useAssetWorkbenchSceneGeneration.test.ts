import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneData } from '~/lib/asset-workbench-models'
import type { QueueItem } from '~/lib/asset-workbench-types'
import { useAssetWorkbenchSceneGeneration } from './useAssetWorkbenchSceneGeneration'

const {
  requestSceneBaselineGenerationMock,
  requestSceneVideoTaskMock,
  pollSceneVideoTaskMock
} = vi.hoisted(() => {
  return {
    requestSceneBaselineGenerationMock: vi.fn(async () => 'https://example.com/generated-env.png'),
    requestSceneVideoTaskMock: vi.fn(async () => 'video_task_1'),
    pollSceneVideoTaskMock: vi.fn(async () => 'https://example.com/generated-video.mp4')
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
})
