import type { ComputedRef, Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { AutoStageKey, FinalVideoAsset, QueueSummary } from '~/lib/asset-workbench-types'
import { inferActiveAutoStage } from '~/lib/asset-workbench-progress'

interface UseAssetWorkbenchAutoFlowOptions {
  route: ReturnType<typeof useRoute>
  router: ReturnType<typeof useRouter>
  projectId: ComputedRef<string | undefined>
  projectAssetWorkflow: Ref<unknown | null>
  selectedStyleId: Ref<string>
  projectStyleId: Ref<string>
  selectedSceneId: Ref<string>
  scenes: Ref<SceneData[]>
  queueSummary: ComputedRef<QueueSummary>
  assetsReady: ComputedRef<boolean>
  finalVideo: Ref<FinalVideoAsset | null>
  resolveUiError: (error: unknown, fallback: string) => string
  mergeAllVideos: () => Promise<unknown>
  loadProject: (id: string) => Promise<unknown>
  loadWorkflowMeta: (rawMetaInput?: unknown) => Promise<boolean>
  saveWorkflowMeta: () => Promise<unknown>
  persistAutomaticAssetPlan: (
    options?: { overwriteExistingConfigs?: boolean }
  ) => Promise<unknown>
  synchronizeSceneConfigs: () => void
  synchronizeQueueItems: () => void
  ensureCharacterAssetsReady: () => Promise<void>
  ensurePropAssetsReady: () => Promise<void>
  runBatchSceneGeneration: () => Promise<void>
  retryFailedQueueItemsOnce: () => Promise<void>
}

export function useAssetWorkbenchAutoFlow(options: UseAssetWorkbenchAutoFlowOptions) {
  const autoRunning = ref(false)
  const autoRunError = ref<string | null>(null)
  const autoRunCurrentStage = ref<AutoStageKey | null>(null)
  const activeAutoStage = ref<AutoStageKey>('parse')

  function selectAutoStage(stage: AutoStageKey) {
    activeAutoStage.value = stage
  }

  async function handleMergeVideos() {
    if (options.scenes.value.length === 0) {
      alert('请先生成分镜视频')
      return
    }

    await options.mergeAllVideos()
  }

  async function runSimpleAssetsStep() {
    if (autoRunning.value) return

    autoRunning.value = true
    autoRunError.value = null
    autoRunCurrentStage.value = 'assets'

    try {
      if (options.scenes.value.length === 0) {
        throw new Error('请先在“剧本解析”步骤输入并解析剧本')
      }

      await options.persistAutomaticAssetPlan()
      await options.ensureCharacterAssetsReady()
      await options.ensurePropAssetsReady()

      selectAutoStage('videos')
    } catch (error) {
      autoRunError.value = options.resolveUiError(error, '资产准备失败')
    } finally {
      autoRunning.value = false
      autoRunCurrentStage.value = null
    }
  }

  async function runSimpleVideosStep() {
    if (autoRunning.value) return

    autoRunning.value = true
    autoRunError.value = null
    autoRunCurrentStage.value = 'videos'

    try {
      if (options.scenes.value.length === 0) {
        throw new Error('请先在“剧本解析”步骤输入并解析剧本')
      }

      await options.runBatchSceneGeneration()
      await options.retryFailedQueueItemsOnce()
      selectAutoStage('final')
    } catch (error) {
      autoRunError.value = options.resolveUiError(error, '分镜视频生成失败')
    } finally {
      autoRunning.value = false
      autoRunCurrentStage.value = null
    }
  }

  async function runSimpleFinalStep() {
    if (autoRunning.value) return

    autoRunning.value = true
    autoRunError.value = null
    autoRunCurrentStage.value = 'final'

    try {
      if (options.queueSummary.value.done === 0) {
        throw new Error('请先在“分镜视频”步骤生成至少一个分镜视频')
      }
      await handleMergeVideos()
      if (options.finalVideo.value?.videoUrl) {
        await options.saveWorkflowMeta()
      }
    } catch (error) {
      autoRunError.value = options.resolveUiError(error, '最终成片合成失败')
    } finally {
      autoRunning.value = false
      autoRunCurrentStage.value = null
    }
  }

  onMounted(async () => {
    const id = options.projectId.value || options.route.query.project
    if (!id || typeof id !== 'string') {
      await options.router.push('/projects')
      return
    }

    await options.loadProject(id)

    if (!options.selectedStyleId.value && options.projectStyleId.value) {
      options.selectedStyleId.value = options.projectStyleId.value
    }

    const hasMeta = await options.loadWorkflowMeta(options.projectAssetWorkflow.value)

    await options.persistAutomaticAssetPlan({
      overwriteExistingConfigs: !hasMeta
    })

    if (options.scenes.value.length > 0) {
      selectAutoStage(inferActiveAutoStage({
        hasScenes: options.scenes.value.length > 0,
        assetsReady: options.assetsReady.value,
        queueSummary: options.queueSummary.value
      }))
      options.selectedSceneId.value = options.scenes.value[0]?.id || ''
    } else {
      selectAutoStage('parse')
    }
  })

  return {
    autoRunning,
    autoRunError,
    autoRunCurrentStage,
    activeAutoStage,
    selectAutoStage,
    runSimpleAssetsStep,
    runSimpleVideosStep,
    runSimpleFinalStep
  }
}
