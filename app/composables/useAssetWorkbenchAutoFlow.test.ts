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
  it('reloads the project when a kept-alive workbench is opened with a new project id', async () => {
    const route = reactive({
      path: '/asset-workbench',
      query: { project: 'aaa', stage: undefined as string | undefined }
    })
    const scenes = ref<SceneData[]>([])
    const loadProject = vi.fn(async (id: string) => {
      scenes.value = [createScene(`scene_${id}`)]
    })
    const router = { push: vi.fn(async () => undefined) }

    useAssetWorkbenchAutoFlow({
      route: route as never,
      router: router as never,
      projectId: computed(() => route.query.project),
      projectAssetWorkflow: ref(null),
      selectedStyleId: ref(''),
      projectStyleId: ref('style_1'),
      selectedSceneId: ref(''),
      scenes,
      queueSummary: computed(() => ({ total: 0, pending: 0, running: 0, done: 0, failed: 0, error: 0 })),
      assetsReady: computed(() => false),
      finalVideo: ref(null),
      resolveUiError: (_error, fallback) => fallback,
      mergeAllVideos: vi.fn(async () => undefined),
      loadProject,
      loadWorkflowMeta: vi.fn(async () => false),
      saveWorkflowMeta: vi.fn(async () => undefined),
      persistAutomaticAssetPlan: vi.fn(async () => undefined),
      synchronizeSceneConfigs: vi.fn(),
      synchronizeQueueItems: vi.fn(),
      ensureCharacterAssetsReady: vi.fn(async () => undefined),
      ensurePropAssetsReady: vi.fn(async () => undefined),
      runBatchSceneGeneration: vi.fn(async () => undefined),
      retryFailedQueueItemsOnce: vi.fn(async () => undefined)
    })

    await nextTick()
    expect(loadProject).toHaveBeenCalledWith('aaa')

    route.path = '/projects'
    route.query.project = undefined as never
    await nextTick()
    expect(router.push).not.toHaveBeenCalled()

    route.query.project = 'project_new'
    route.path = '/asset-workbench'

    await nextTick()
    await Promise.resolve()
    expect(loadProject).toHaveBeenCalledWith('project_new')
    expect(scenes.value[0]?.id).toBe('scene_project_new')
  })
})
