import type { ComputedRef, Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { AutoStageKey, QueueSummary } from '~/lib/asset-workbench-types'
import { inferActiveAutoStage } from '~/lib/asset-workbench-progress'

interface UseAssetWorkbenchAutoFlowOptions {
  route: ReturnType<typeof useRoute>
  router: ReturnType<typeof useRouter>
  projectId: ComputedRef<string | undefined>
  projectAssetWorkflow: Ref<unknown | null>
  selectedStyleId: Ref<string>
  projectStyleId: Ref<string>
  selectedSceneId: Ref<string>
  workflowStylePrompt: ComputedRef<string>
  novelText: Ref<string>
  scenes: Ref<SceneData[]>
  parsedTimelineText: Ref<string>
  queueSummary: ComputedRef<QueueSummary>
  assetsReady: ComputedRef<boolean>
  finalVideo: Ref<{ videoData?: string } | null>
  resolveUiError: (error: unknown, fallback: string) => string
  parseScript: (options?: {
    workflowType?: 'asset_consistency'
    style?: string
    descriptionFormat?: 'visual' | 'timeline'
  }) => Promise<boolean>
  mergeAllVideos: () => Promise<unknown>
  loadProject: (id: string) => Promise<unknown>
  loadWorkflowMeta: (rawMetaInput?: unknown) => Promise<boolean>
  persistAutomaticAssetPlan: (
    options?: { overwriteExistingConfigs?: boolean }
  ) => Promise<unknown>
  synchronizeSceneConfigs: () => void
  synchronizeQueueItems: () => void
  ensureCharacterAssetsReady: () => Promise<void>
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

  async function handleParseScript() {
    if (!options.novelText.value.trim()) {
      alert('请先输入剧本原文')
      return
    }

    autoRunError.value = null

    try {
      const parsed = await options.parseScript({
        workflowType: 'asset_consistency',
        style: options.workflowStylePrompt.value,
        descriptionFormat: 'timeline'
      })

      if (!parsed) {
        throw new Error('剧本解析失败，请检查模型配置或稍后重试')
      }

      await options.persistAutomaticAssetPlan({
        overwriteExistingConfigs: true
      })

      options.synchronizeSceneConfigs()
      options.synchronizeQueueItems()

      if (options.scenes.value.length > 0) {
        selectAutoStage('assets')
      }
    } catch (error) {
      autoRunError.value = options.resolveUiError(error, '剧本解析失败')
    }
  }

  async function copyParsedTimelineText() {
    const text = options.parsedTimelineText.value.trim()
    if (!text) return

    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      autoRunError.value = '当前环境不支持自动复制，请手动复制下方时间轴文案'
      return
    }

    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      autoRunError.value = options.resolveUiError(error, '复制时间轴文案失败，请手动复制')
    }
  }

  async function handleMergeVideos() {
    if (options.scenes.value.length === 0) {
      alert('请先生成场景视频')
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
      autoRunError.value = options.resolveUiError(error, '场景视频生成失败')
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
        throw new Error('请先在“场景视频”步骤生成至少一个场景视频')
      }
      await handleMergeVideos()
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
    handleParseScript,
    copyParsedTimelineText,
    runSimpleAssetsStep,
    runSimpleVideosStep,
    runSimpleFinalStep
  }
}
