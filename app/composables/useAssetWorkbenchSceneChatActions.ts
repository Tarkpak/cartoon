import type { ComputedRef, Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import {
  createPropAssetId,
  type DisplayAsset,
  type SceneChatMessage
} from '~/lib/asset-workbench-types'
import {
  resetFileInput,
  uploadImageFile
} from '~/lib/asset-workbench-upload'
import {
  appendSceneChatUploadTokens,
  applySceneChatAssetReferences,
  buildSceneChatSubmitPayload,
  createSceneChatMessage,
  requestSceneChatDescriptionRewrite,
  resolveChatUploadAssetName,
  syncSceneDescriptionWithChatAssetMentions
} from '~/lib/asset-workbench-scene-chat'
import { invalidateSceneGenerationState } from '~/lib/asset-workbench-scenes'

interface UseAssetWorkbenchSceneChatActionsOptions {
  scenes: Ref<SceneData[]>
  propAssets: Ref<PropAsset[]>
  workflowStylePrompt: ComputedRef<string>
  maxAssetUploadSize: number
  uniqueSorted: (values: string[]) => string[]
  resolveUiError: (error: unknown, fallback: string) => string
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveAssetMentionTokenMap: () => Map<string, string>
  resolveAssetByMentionTokenMap: () => Map<string, DisplayAsset>
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
  buildSceneMentionDescription: (baseDescription: string, mentionTokens: string[]) => string
  buildAssetWorkflowScenePayload: (scene: SceneData) => unknown
  resolveSceneReferenceAssetIds: (sceneId: string) => string[]
  setSceneAssetReferences: (sceneId: string, nextAssetIds: string[]) => void
  saveWorkflowMeta: () => Promise<unknown>
  saveProject: () => Promise<unknown>
  sceneChatMessages: Ref<Record<string, SceneChatMessage[]>>
  sceneChatComposerText: Ref<string>
  sceneChatComposerAssetIds: Ref<string[]>
  sceneChatUploading: Ref<boolean>
  sceneChatApplying: Ref<boolean>
  sceneChatError: Ref<string | null>
  closeSceneChat: () => void
  closeSceneChatMention: () => void
  handleSceneChatComposerInput: () => void
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
  onModelTaskFailed?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
}

export function useAssetWorkbenchSceneChatActions(
  options: UseAssetWorkbenchSceneChatActionsOptions
) {
  async function notifyModelTaskCompleted(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskCompleted) return
    try {
      await options.onModelTaskCompleted(payload)
    } catch (error) {
      console.warn('[useAssetWorkbenchSceneChatActions] 模型任务完成通知失败:', error)
    }
  }

  async function notifyModelTaskFailed(payload: {
    title: string
    body?: string
  }) {
    if (!options.onModelTaskFailed) return
    try {
      await options.onModelTaskFailed(payload)
    } catch (error) {
      console.warn('[useAssetWorkbenchSceneChatActions] 模型任务失败通知失败:', error)
    }
  }

  function ensureSceneChatHistory(sceneId: string): SceneChatMessage[] {
    if (!options.sceneChatMessages.value[sceneId]) {
      options.sceneChatMessages.value[sceneId] = []
    }
    return options.sceneChatMessages.value[sceneId]!
  }

  function appendSceneChatMessage(
    sceneId: string,
    role: SceneChatMessage['role'],
    content: string,
    assetIds: string[] = []
  ) {
    const history = ensureSceneChatHistory(sceneId)
    history.push(createSceneChatMessage(role, content, assetIds, options.uniqueSorted))
  }

  async function handleSceneChatImageUpload(sceneId: string | null, event: Event) {
    const input = event.target as HTMLInputElement | null
    const files = Array.from(input?.files || [])

    if (!sceneId || files.length === 0) {
      resetFileInput(event)
      return
    }

    options.sceneChatUploading.value = true
    options.sceneChatError.value = null

    try {
      const createdAssetIds: string[] = []

      for (const file of files) {
        const imageUrl = await uploadImageFile(file, {
          maxFileSize: options.maxAssetUploadSize,
          prefix: `scene_chat_${sceneId}`
        })
        const name = resolveChatUploadAssetName(
          file.name,
          options.propAssets.value.map(item => item.name)
        )
        const propId = createPropAssetId()

        options.propAssets.value.push({
          id: propId,
          name,
          description: '用户上传图片资产',
          category: 'other',
          referenceImage: imageUrl
        })

        createdAssetIds.push(`prop:${propId}`)
      }

      options.sceneChatComposerAssetIds.value = options.uniqueSorted([
        ...options.sceneChatComposerAssetIds.value,
        ...createdAssetIds
      ])

      await options.saveWorkflowMeta()

      const tokenMap = options.resolveAssetMentionTokenMap()
      const addedTokens = createdAssetIds
        .map(assetId => tokenMap.get(assetId) || '')
        .filter(Boolean)

      if (addedTokens.length > 0) {
        options.sceneChatComposerText.value = appendSceneChatUploadTokens(
          options.sceneChatComposerText.value,
          addedTokens
        )
        await nextTick()
        options.handleSceneChatComposerInput()
      }
    } catch (error) {
      options.sceneChatError.value = options.resolveUiError(error, '上传图片资产失败')
    } finally {
      options.sceneChatUploading.value = false
      resetFileInput(event)
    }
  }

  async function submitSceneChat(sceneId: string) {
    const scene = options.scenes.value.find(item => item.id === sceneId)
    if (!scene) return
    if (options.sceneChatApplying.value) return

    const submitPayload = buildSceneChatSubmitPayload({
      rawText: options.sceneChatComposerText.value,
      composerAssetIds: options.sceneChatComposerAssetIds.value,
      uniqueSorted: options.uniqueSorted,
      mentionMap: options.resolveAssetByMentionTokenMap(),
      resolveDisplayAssetById: options.resolveDisplayAssetById
    })
    if (!submitPayload) return

    const historyBeforeSubmit = ensureSceneChatHistory(sceneId)
      .slice(-8)
      .map(item => ({ ...item }))

    appendSceneChatMessage(
      sceneId,
      'user',
      submitPayload.userVisibleMessage,
      submitPayload.relatedAssetIds
    )

    options.sceneChatComposerText.value = ''
    options.sceneChatComposerAssetIds.value = []
    options.sceneChatError.value = null
    options.closeSceneChatMention()

    options.sceneChatApplying.value = true

    try {
      const previousBaseDescription = options.resolveSceneDescriptionWithoutAssetMentions(scene.description || '')
      const rewrittenDescription = await requestSceneChatDescriptionRewrite({
        scene,
        userMessage: submitPayload.normalizedMessage,
        history: historyBeforeSubmit,
        mentionedAssets: submitPayload.relatedAssets,
        workflowStylePrompt: options.workflowStylePrompt.value,
        buildAssetWorkflowScenePayload: options.buildAssetWorkflowScenePayload
      })
      const descriptionChanged = previousBaseDescription !== rewrittenDescription
      scene.description = rewrittenDescription
      if (descriptionChanged) {
        invalidateSceneGenerationState(scene)
      }

      const { configChanged } = applySceneChatAssetReferences({
        sceneId,
        assetIds: submitPayload.relatedAssetIds,
        uniqueSorted: options.uniqueSorted,
        resolveSceneReferenceAssetIds: options.resolveSceneReferenceAssetIds,
        setSceneAssetReferences: options.setSceneAssetReferences
      })
      const mentionChanged = syncSceneDescriptionWithChatAssetMentions({
        scene,
        sceneId,
        preferredAssetIds: submitPayload.relatedAssetIds,
        uniqueSorted: options.uniqueSorted,
        resolveAssetMentionTokenMap: options.resolveAssetMentionTokenMap,
        resolveSceneReferenceAssetIds: options.resolveSceneReferenceAssetIds,
        resolveSceneDescriptionWithoutAssetMentions: options.resolveSceneDescriptionWithoutAssetMentions,
        buildSceneMentionDescription: options.buildSceneMentionDescription
      })

      if (descriptionChanged || mentionChanged || configChanged) {
        await options.saveProject()
      }
      if (configChanged) {
        await options.saveWorkflowMeta()
      }

      appendSceneChatMessage(
        sceneId,
        'assistant',
        '已使用配置文本模型更新该场景描述，并同步了资产引用（未自动重新生成环境图）。',
        submitPayload.relatedAssetIds
      )
      await notifyModelTaskCompleted({
        title: '场景描述改写完成',
        body: `场景：${scene.title}`
      })
    } catch (error) {
      const message = options.resolveUiError(error, '场景二次改写失败')
      options.sceneChatError.value = message
      appendSceneChatMessage(sceneId, 'assistant', `处理失败：${message}`)
      await notifyModelTaskFailed({
        title: '场景二次改写失败',
        body: `场景：${scene.title}（${message}）`
      })
    } finally {
      options.sceneChatApplying.value = false
    }
  }

  function syncSceneChatValidScenes(sceneIds: string[]) {
    const validSceneIdSet = new Set(sceneIds)

    options.sceneChatMessages.value = Object.fromEntries(
      Object.entries(options.sceneChatMessages.value).filter(([sceneId]) => validSceneIdSet.has(sceneId))
    )
  }

  return {
    ensureSceneChatHistory,
    appendSceneChatMessage,
    handleSceneChatImageUpload,
    submitSceneChat,
    syncSceneChatValidScenes
  }
}
