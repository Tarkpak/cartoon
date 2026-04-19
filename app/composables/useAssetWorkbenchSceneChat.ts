import type { ComputedRef, Ref } from 'vue'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset } from '~/composables/useAssetWorkflowMeta'
import type {
  DisplayAsset,
  SceneChatMessage
} from '~/lib/asset-workbench-types'
import {
  createSceneChatWelcomeMessage
} from '~/lib/asset-workbench-scene-chat'
import { useAssetWorkbenchSceneChatActions } from '~/composables/useAssetWorkbenchSceneChatActions'

interface UseAssetWorkbenchSceneChatOptions {
  scenes: Ref<SceneData[]>
  propAssets: Ref<PropAsset[]>
  allAssets: ComputedRef<DisplayAsset[]>
  workflowStylePrompt: ComputedRef<string>
  maxAssetUploadSize: number
  uniqueSorted: (values: string[]) => string[]
  resolveUiError: (error: unknown, fallback: string) => string
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  resolveAssetMentionTokenMap: () => Map<string, string>
  resolveAssetByMentionTokenMap: () => Map<string, DisplayAsset>
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
  buildSceneMentionDescription: (baseDescription: string, mentionTokens: string[]) => string
  buildAssetWorkflowScenePayload: (scene: SceneData) => unknown
  resolveSceneReferenceAssetIds: (sceneId: string) => string[]
  setSceneAssetReferences: (sceneId: string, nextAssetIds: string[]) => void
  saveWorkflowMeta: () => Promise<unknown>
  saveProject: () => Promise<unknown>
  onModelTaskCompleted?: (payload: {
    title: string
    body?: string
  }) => Promise<unknown> | unknown
}

export function useAssetWorkbenchSceneChat(options: UseAssetWorkbenchSceneChatOptions) {
  const sceneChatOpenSceneId = ref<string | null>(null)
  const sceneChatMessages = ref<Record<string, SceneChatMessage[]>>({})
  const sceneChatComposerText = ref('')
  const sceneChatComposerAssetIds = ref<string[]>([])
  const sceneChatUploading = ref(false)
  const sceneChatApplying = ref(false)
  const sceneChatError = ref<string | null>(null)

  const sceneChatCurrentMessages = computed<SceneChatMessage[]>(() => {
    const sceneId = sceneChatOpenSceneId.value
    if (!sceneId) return []
    return sceneChatMessages.value[sceneId] || []
  })

  const sceneChatComposerAssets = computed<DisplayAsset[]>(() => {
    return sceneChatComposerAssetIds.value
      .map(options.resolveDisplayAssetById)
      .filter((asset): asset is DisplayAsset => !!asset)
  })

  const sceneChatCanSubmit = computed(() => {
    return !sceneChatUploading.value
      && !sceneChatApplying.value
      && (
        !!sceneChatComposerText.value.trim()
        || sceneChatComposerAssetIds.value.length > 0
      )
  })

  function submitActiveSceneChat() {
    if (sceneChatOpenSceneId.value) {
      void submitSceneChat(sceneChatOpenSceneId.value)
    }
  }

  const {
    sceneChatMentionOpen,
    sceneChatMentionCandidates,
    sceneChatMentionActiveIndex,
    setSceneChatInputRef,
    setSceneChatMentionListRef,
    closeSceneChatMention,
    applySceneChatMention,
    handleSceneChatComposerInput,
    handleSceneChatComposerCursor,
    handleSceneChatComposerKeydown
  } = useAssetWorkbenchSceneChatMentions({
    allAssets: options.allAssets,
    composerText: sceneChatComposerText,
    resolveAssetMentionTokenMap: options.resolveAssetMentionTokenMap,
    resolveDisplayAssetTypeLabel: options.resolveDisplayAssetTypeLabel,
    onSubmit: submitActiveSceneChat
  })

  watch(sceneChatOpenSceneId, (sceneId) => {
    sceneChatComposerText.value = ''
    sceneChatComposerAssetIds.value = []
    sceneChatError.value = null
    closeSceneChatMention()

    if (!sceneId) return
    if (sceneChatMessages.value[sceneId]) return

    sceneChatMessages.value[sceneId] = [
      createSceneChatWelcomeMessage()
    ]
  })

  function setSceneChatComposerText(value: string) {
    sceneChatComposerText.value = value
  }

  function closeSceneChat() {
    sceneChatOpenSceneId.value = null
    sceneChatError.value = null
    closeSceneChatMention()
  }

  function toggleSceneChat(scene: SceneData) {
    if (sceneChatOpenSceneId.value === scene.id) {
      closeSceneChat()
      return
    }
    sceneChatOpenSceneId.value = scene.id
  }

  function removeSceneChatComposerAsset(assetId: string) {
    sceneChatComposerAssetIds.value = sceneChatComposerAssetIds.value.filter(id => id !== assetId)
  }

  const {
    handleSceneChatImageUpload: performSceneChatImageUpload,
    submitSceneChat,
    syncSceneChatValidScenes: filterValidSceneChats
  } = useAssetWorkbenchSceneChatActions({
    scenes: options.scenes,
    propAssets: options.propAssets,
    workflowStylePrompt: options.workflowStylePrompt,
    maxAssetUploadSize: options.maxAssetUploadSize,
    uniqueSorted: options.uniqueSorted,
    resolveUiError: options.resolveUiError,
    resolveDisplayAssetById: options.resolveDisplayAssetById,
    resolveAssetMentionTokenMap: options.resolveAssetMentionTokenMap,
    resolveAssetByMentionTokenMap: options.resolveAssetByMentionTokenMap,
    resolveSceneDescriptionWithoutAssetMentions: options.resolveSceneDescriptionWithoutAssetMentions,
    buildSceneMentionDescription: options.buildSceneMentionDescription,
    buildAssetWorkflowScenePayload: options.buildAssetWorkflowScenePayload,
    resolveSceneReferenceAssetIds: options.resolveSceneReferenceAssetIds,
    setSceneAssetReferences: options.setSceneAssetReferences,
    saveWorkflowMeta: options.saveWorkflowMeta,
    saveProject: options.saveProject,
    sceneChatMessages,
    sceneChatComposerText,
    sceneChatComposerAssetIds,
    sceneChatUploading,
    sceneChatApplying,
    sceneChatError,
    closeSceneChat,
    closeSceneChatMention,
    handleSceneChatComposerInput,
    onModelTaskCompleted: options.onModelTaskCompleted
  })

  async function handleSceneChatImageUpload(event: Event) {
    await performSceneChatImageUpload(sceneChatOpenSceneId.value, event)
  }

  function syncSceneChatValidScenes(sceneIds: string[]) {
    if (sceneChatOpenSceneId.value && !sceneIds.includes(sceneChatOpenSceneId.value)) {
      closeSceneChat()
    }

    filterValidSceneChats(sceneIds)
  }

  return {
    sceneChatOpenSceneId,
    sceneChatCurrentMessages,
    sceneChatComposerAssets,
    sceneChatComposerText,
    sceneChatMentionOpen,
    sceneChatMentionCandidates,
    sceneChatMentionActiveIndex,
    sceneChatUploading,
    sceneChatApplying,
    sceneChatError,
    sceneChatCanSubmit,
    setSceneChatComposerText,
    setSceneChatInputRef,
    setSceneChatMentionListRef,
    closeSceneChat,
    toggleSceneChat,
    applySceneChatMention,
    handleSceneChatComposerInput,
    handleSceneChatComposerCursor,
    handleSceneChatComposerKeydown,
    removeSceneChatComposerAsset,
    handleSceneChatImageUpload,
    submitSceneChat,
    syncSceneChatValidScenes
  }
}
