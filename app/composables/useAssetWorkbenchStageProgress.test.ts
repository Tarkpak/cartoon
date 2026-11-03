import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import { createInitialAssetWorkbenchParseProgressState } from './useAssetWorkbenchGeneration'
import type { QueueItem, QueueSummary } from '~/lib/asset-workbench-types'
import { useAssetWorkbenchStageProgress } from './useAssetWorkbenchStageProgress'

function createScene(id: string, videoStatus: SceneData['videoStatus']): SceneData {
  return { id, title: id, description: '', characters: [], duration: 8, active: true, referenceStatus: 'done', videoStatus }
}

function setup(options: { canEdit?: boolean } = {}) {
  const scenes = ref([createScene('s1', 'done'), createScene('s2', 'error'), createScene('s3', 'pending')])
  const queueItems = ref<QueueItem[]>([
    { sceneId: 's1', status: 'done' },
    { sceneId: 's2', status: 'error', error: '超时' },
    { sceneId: 's3', status: 'pending' }
  ])
  const queueSummary = computed<QueueSummary>(() => ({ total: 3, running: 0, done: 1, error: 1 }))
  const selectAutoStage = vi.fn()
  const selectScene = vi.fn()
  const openSceneEdit = vi.fn()
  const retryScenes = vi.fn(async () => undefined)
  const api = useAssetWorkbenchStageProgress({
    scenes,
    characters: ref([]),
    environmentAssetCards: computed(() => []),
    episodePlan: ref([{ id: 'ep1', title: '第1集', index: 1, startOffset: 0, endOffset: 10 } as never]),
    queueItems,
    queueSummary,
    finalVideo: ref(null),
    parsing: ref(false),
    parseProgress: ref(createInitialAssetWorkbenchParseProgressState()),
    scriptParseMode: ref('premium_drama'),
    assetsReady: computed(() => false),
    assetPreparationSummary: computed(() => ({ total: 4, ready: 1, title: '资产已就绪 1 / 4' })),
    autoRunning: ref(false),
    autoRunCurrentStage: ref(null),
    canEditProject: computed(() => options.canEdit !== false),
    selectAutoStage,
    selectScene,
    openSceneEdit,
    retryScenes
  })
  return { ...api, selectAutoStage, selectScene, openSceneEdit, retryScenes }
}

describe('useAssetWorkbenchStageProgress', () => {
  it('attaches asset and video progress to the stage switcher', () => {
    const { autoStages } = setup()
    const assets = autoStages.value.find(stage => stage.key === 'assets')
    const videos = autoStages.value.find(stage => stage.key === 'videos')
    expect(assets).toMatchObject({ progress: 25, progressTitle: '资产已就绪 1 / 4' })
    expect(videos).toMatchObject({ hasError: true, progressTitle: '分镜视频已完成 1 / 3，1 个失败' })
    expect(videos!.progress).toBeCloseTo(33.33, 1)
  })

  it('retries only the retryable failed scene tasks', () => {
    const { workbenchTasks, retryFailedSceneTasks, retryScenes } = setup()
    const retryableIds = workbenchTasks.value.filter(task => task.retryable && task.sceneId).map(task => task.sceneId)
    retryFailedSceneTasks()
    expect(retryScenes).toHaveBeenCalledWith(retryableIds)
    expect(retryableIds).toContain('s2')
  })

  it('opens a task at its stage and scene', () => {
    const { openWorkbenchTask, selectAutoStage, selectScene } = setup()
    openWorkbenchTask({ stage: 'videos', sceneId: 's2' } as never)
    expect(selectAutoStage).toHaveBeenCalledWith('videos')
    expect(selectScene).toHaveBeenCalledWith('s2')
  })

  it('does not open the scene editor in a read-only project', () => {
    const { openSceneEditWhenEditable, openSceneEdit } = setup({ canEdit: false })
    openSceneEditWhenEditable(createScene('s1', 'done'))
    expect(openSceneEdit).not.toHaveBeenCalled()
  })
})
