import type { ComputedRef, Ref } from 'vue'
import { useToast } from '~/composables/useToast'
import type { ScriptParseMode } from '#shared/types/script'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { AssetWorkbenchParseProgressState } from '~/composables/useAssetWorkbenchGeneration'
import type { ScriptEpisodePlanItem } from '~/lib/asset-workbench-api'
import type { AutoStageKey } from '~/lib/asset-workbench-types'
import {
  getBrowserNotificationStatus,
  requestBrowserNotificationPermission
} from '~/composables/useGenerationCompletionNotification'

/**
 * Parse step actions: build the episode directory from the source text, and
 * parse a single episode into scenes (then derive its asset plan).
 */
export function useAssetWorkbenchEpisodeParsing(options: {
  novelText: Ref<string>
  scenes: Ref<SceneData[]>
  episodePlan: Ref<ScriptEpisodePlanItem[]>
  parsing: Ref<boolean>
  parseProgress: Ref<AssetWorkbenchParseProgressState>
  scriptParseMode: Ref<ScriptParseMode>
  workflowStylePrompt: ComputedRef<string>
  parseScript: (input: { style?: string, scriptParseMode?: ScriptParseMode, descriptionFormat?: 'visual' | 'timeline', targetEpisodeId: string }) => Promise<unknown>
  prepareEpisodePlanWithAssetHydration: () => Promise<boolean>
  persistAutomaticAssetPlan: () => Promise<unknown>
  synchronizeSceneConfigs: () => void
  synchronizeQueueItems: () => void
  selectAutoStage: (stage: AutoStageKey) => void
  resolveUiError: (error: unknown, fallback: string) => string
}) {
  const {
    novelText,
    scenes,
    episodePlan,
    parsing,
    parseProgress,
    scriptParseMode,
    workflowStylePrompt,
    parseScript,
    prepareEpisodePlanWithAssetHydration,
    persistAutomaticAssetPlan,
    synchronizeSceneConfigs,
    synchronizeQueueItems,
    selectAutoStage,
    resolveUiError
  } = options
  const { toast } = useToast()

  async function handlePrepareEpisodePlan() {
    if (parsing.value) return
    if (!novelText.value.trim()) {
      toast.warning('请先输入剧本原文')
      return
    }
    const notificationStatus = getBrowserNotificationStatus()
    if (notificationStatus.supported && notificationStatus.secureContext && notificationStatus.canPrompt) {
      void requestBrowserNotificationPermission().catch(error => {
        console.warn('[asset-workbench] 申请系统通知权限失败:', error)
      })
    }
    const prepared = await prepareEpisodePlanWithAssetHydration()
    if (!prepared) {
      toast.error('分集目录生成失败', { description: parseProgress.value.message || '请检查协作连接和模型配置后重试。' })
      return
    }

    if (scriptParseMode.value === 'origin_explainer') {
      const episodeId = episodePlan.value[0]?.id?.trim()
      if (!episodeId) {
        selectAutoStage('parse')
        return
      }

      await handleParseSingleEpisode({ id: episodeId })
      selectAutoStage(scenes.value.length > 0 ? 'assets' : 'parse')
      return
    }

    selectAutoStage('assets')
  }

  async function handleParseSingleEpisode(payload: { id: string }) {
    if (!novelText.value.trim()) {
      toast.warning('请先输入剧本原文')
      return
    }

    const episodeId = payload.id?.trim()
    if (!episodeId) {
      toast.warning('请选择要解析的分集')
      return
    }

    try {
      const parsed = await parseScript({
        style: workflowStylePrompt.value,
        scriptParseMode: scriptParseMode.value,
        descriptionFormat: 'timeline',
        targetEpisodeId: episodeId
      })

      if (!parsed) {
        throw new Error(parseProgress.value.message || '本集解析失败，请稍后重试')
      }

      await persistAutomaticAssetPlan()
      synchronizeSceneConfigs()
      synchronizeQueueItems()
    } catch (error) {
      const message = resolveUiError(error, '本集解析失败，请稍后重试')
      parseProgress.value = {
        ...parseProgress.value,
        active: false,
        failedStep: parseProgress.value.failedStep || 'merging',
        finishedAt: Date.now(),
        step: 'error',
        message
      }
      throw new Error(message)
    }
  }

  return {
    handlePrepareEpisodePlan,
    handleParseSingleEpisode
  }
}
