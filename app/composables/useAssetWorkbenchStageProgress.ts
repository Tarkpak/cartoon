import { computed, type ComputedRef, type Ref } from 'vue'
import type { ScriptParseMode } from '#shared/types/script'
import { resolveVideoWorkflowPreset } from '#shared/types/video-workflow'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { AssetWorkbenchParseProgressState } from '~/composables/useAssetWorkbenchGeneration'
import type {
  AutoStageKey,
  EnvironmentAssetCard,
  FinalVideoAsset,
  QueueItem,
  QueueSummary
} from '~/lib/asset-workbench-types'
import { AUTO_STAGE_HINTS, buildAutoStages } from '~/lib/asset-workbench-progress'
import { buildWorkbenchTasks, type WorkbenchTask } from '~/lib/asset-workbench-tasks'

/**
 * Header state: the parse/assets/videos/final stages with their progress, the
 * background task list, and the parse-step hint.
 */
export function useAssetWorkbenchStageProgress(options: {
  scenes: Ref<SceneData[]>
  characters: Ref<CharacterData[]>
  environmentAssetCards: ComputedRef<EnvironmentAssetCard[]>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  queueItems: Ref<QueueItem[]>
  queueSummary: ComputedRef<QueueSummary>
  finalVideo: Ref<FinalVideoAsset | null>
  parsing: Ref<boolean>
  parseProgress: Ref<AssetWorkbenchParseProgressState>
  scriptParseMode: Ref<ScriptParseMode>
  assetsReady: ComputedRef<boolean>
  assetPreparationSummary: ComputedRef<{ total: number, ready: number, title: string }>
  autoRunning: Ref<boolean>
  autoRunCurrentStage: Ref<AutoStageKey | null>
  canEditProject: ComputedRef<boolean>
  selectAutoStage: (stage: AutoStageKey) => void
  selectScene: (sceneId: string) => void
  openSceneEdit: (scene: SceneData) => void
  retryScenes: (sceneIds: string[]) => Promise<void>
}) {
  const {
    scenes,
    characters,
    environmentAssetCards,
    episodePlan,
    queueItems,
    queueSummary,
    finalVideo,
    parsing,
    parseProgress,
    scriptParseMode,
    assetsReady,
    assetPreparationSummary,
    autoRunning,
    autoRunCurrentStage,
    canEditProject,
    selectAutoStage,
    selectScene,
    openSceneEdit,
    retryScenes
  } = options

  const autoStages = computed(() => {
    const videosDone = queueSummary.value.total > 0
      && queueSummary.value.done === queueSummary.value.total
    const workflowPreset = resolveVideoWorkflowPreset(scriptParseMode.value)

    const stages = buildAutoStages({
      hasScenes: scenes.value.length > 0,
      hasEpisodePlan: episodePlan.value.some(episode => !episode.id.startsWith('legacy-unassigned')),
      assetsReady: assetsReady.value,
      videosDone,
      finalDone: !!finalVideo.value?.videoUrl,
      autoRunning: autoRunning.value,
      autoRunCurrentStage: autoRunCurrentStage.value,
      parseLabel: workflowPreset.id === 'origin_explainer' ? '镜头规划' : undefined
    })
    return stages.map(stage => ({ ...stage, ...resolveStageProgress(stage.key) }))
  })

  const workbenchTasks = computed(() => buildWorkbenchTasks({
    parsing: parsing.value,
    parseMessage: parseProgress.value?.message,
    scenes: scenes.value,
    queueItems: queueItems.value,
    characters: characters.value,
    environments: environmentAssetCards.value
  }))

  // Double-clicking a scene card is not a control the read-only fence can lock.
  function openSceneEditWhenEditable(scene: SceneData) {
    if (!canEditProject.value) return
    openSceneEdit(scene)
  }

  function openWorkbenchTask(task: WorkbenchTask) {
    selectAutoStage(task.stage)
    if (task.sceneId) selectScene(task.sceneId)
  }

  function retryFailedSceneTasks() {
    const sceneIds = workbenchTasks.value.filter(task => task.retryable && task.sceneId).map(task => task.sceneId!)
    void retryScenes(sceneIds)
  }

  function resolveStageProgress(key: AutoStageKey): { progress?: number, progressTitle?: string, hasError?: boolean } {
    if (key === 'assets') {
      const { ready, total, title } = assetPreparationSummary.value
      return { progress: total > 0 ? Math.min(100, Math.max(0, ready / total * 100)) : 0, progressTitle: title }
    }
    if (key === 'videos') {
      const { done, total, error } = queueSummary.value
      return {
        progress: total > 0 ? Math.min(100, Math.max(0, done / total * 100)) : 0,
        progressTitle: `分镜视频已完成 ${done} / ${total}${error ? `，${error} 个失败` : ''}`,
        hasError: error > 0
      }
    }
    return {}
  }

  const stageHints = AUTO_STAGE_HINTS

  const parseStageHint = computed(() => {
    if (parsing.value) {
      return ''
    }
    if (scriptParseMode.value === 'origin_explainer') {
      return '输入科普主题后生成镜头规划入口，再按主题拆解为多镜头场景。'
    }
    return stageHints.parse
  })

  return {
    autoStages,
    workbenchTasks,
    openSceneEditWhenEditable,
    openWorkbenchTask,
    retryFailedSceneTasks,
    stageHints,
    parseStageHint
  }
}
