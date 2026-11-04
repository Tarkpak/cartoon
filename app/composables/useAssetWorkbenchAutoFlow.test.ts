import { computed, nextTick, reactive, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { SceneData } from '~/composables/useAssetWorkbench'
import { useAssetWorkbenchAutoFlow } from './useAssetWorkbenchAutoFlow'

function createScene(id: string): SceneData {
  return {
    id,
    title: id,
    description: '',
    characters: [],
    duration: 8,
    active: true,
    referenceStatus: 'pending',
    videoStatus: 'pending'
  }
}

describe('useAssetWorkbenchAutoFlow', () => {
  it('keeps automatic generation out of the final stage when a shot is missing', async () => {
    const scenes = ref<SceneData[]>([createScene('shot_1'), createScene('shot_2')])
    const mergeAllVideos = vi.fn(async () => undefined)
    const flow = useAssetWorkbenchAutoFlow({
      route: reactive({ path: '/other', query: {} }) as never,
      router: { push: vi.fn() } as never,
      projectId: computed(() => 'project_1'),
      projectAssetWorkflow: ref(null),
      selectedStyleId: ref(''),
      projectStyleId: ref(''),
      selectedSceneId: ref(''),
      scenes,
      queueSummary: computed(() => ({ total: 2, running: 0, done: 1, error: 1 })),
      assetsReady: computed(() => true),
      finalVideo: ref(null),
      resolveUiError: error => String(error),
      mergeAllVideos,
      loadProject: vi.fn(async () => undefined),
      loadWorkflowMeta: vi.fn(async () => false),
      saveWorkflowMeta: vi.fn(async () => undefined),
      persistAutomaticAssetPlan: vi.fn(async () => undefined),
      synchronizeSceneConfigs: vi.fn(),
      synchronizeQueueItems: vi.fn(),
      ensureCharacterAssetsReady: vi.fn(async () => undefined),
      ensurePropAssetsReady: vi.fn(async () => undefined),
      runBatchSceneGeneration: vi.fn(async () => {
        scenes.value[0].videoStatus = 'done'
        scenes.value[0].videoUrl = '/shot_1.mp4'
      }),
      retryFailedQueueItemsOnce: vi.fn(async () => undefined)
    })

    await flow.runSimpleVideosStep()
    expect(flow.activeAutoStage.value).not.toBe('final')
    expect(flow.autoRunError.value).toContain('1 个分镜未生成成功')
    await flow.runSimpleFinalStep()
    expect(mergeAllVideos).not.toHaveBeenCalled()
  })

  it.each([true, false])('opens asset preparation for an existing plan with scenes=%s and reloads on project changes', async (hasScenes) => {
    const route = reactive({
      path: '/asset-workbench',
      query: { project: 'aaa', stage: undefined as string | undefined }
    })
    const scenes = ref<SceneData[]>([])
    const loadProject = vi.fn(async (id: string) => {
      scenes.value = hasScenes ? [createScene(`scene_${id}`)] : []
    })
    const router = { push: vi.fn(async () => undefined) }
    const persistAutomaticAssetPlan = vi.fn(async () => undefined)

    const { activeAutoStage } = useAssetWorkbenchAutoFlow({
      route: route as never,
      router: router as never,
      projectId: computed(() => route.query.project),
      projectAssetWorkflow: ref(null),
      selectedStyleId: ref(''),
      projectStyleId: ref('style_1'),
      selectedSceneId: ref(''),
      scenes,
      hasEpisodePlan: computed(() => true),
      queueSummary: computed(() => ({ total: 0, pending: 0, running: 0, done: 0, failed: 0, error: 0 })),
      assetsReady: computed(() => false),
      finalVideo: ref(null),
      resolveUiError: (_error, fallback) => fallback,
      mergeAllVideos: vi.fn(async () => undefined),
      loadProject,
      loadWorkflowMeta: vi.fn(async () => false),
      saveWorkflowMeta: vi.fn(async () => undefined),
      persistAutomaticAssetPlan,
      synchronizeSceneConfigs: vi.fn(),
      synchronizeQueueItems: vi.fn(),
      ensureCharacterAssetsReady: vi.fn(async () => undefined),
      ensurePropAssetsReady: vi.fn(async () => undefined),
      runBatchSceneGeneration: vi.fn(async () => undefined),
      retryFailedQueueItemsOnce: vi.fn(async () => undefined)
    })

    await nextTick()
    expect(loadProject).toHaveBeenCalledWith('aaa')
    expect(persistAutomaticAssetPlan).not.toHaveBeenCalled()

    route.path = '/projects'
    route.query.project = undefined as never
    await nextTick()
    expect(router.push).not.toHaveBeenCalled()

    route.query.project = 'project_new'
    route.path = '/asset-workbench'

    await nextTick()
    await Promise.resolve()
    expect(loadProject).toHaveBeenCalledWith('project_new')
    expect(scenes.value[0]?.id).toBe(hasScenes ? 'scene_project_new' : undefined)
    expect(activeAutoStage.value).toBe('assets')
    expect(persistAutomaticAssetPlan).not.toHaveBeenCalled()
  })
})
