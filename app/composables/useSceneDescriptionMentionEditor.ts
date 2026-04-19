import type { Ref } from 'vue'
import type {
  AssetMentionCandidate,
  AssetReferenceOption
} from '~/lib/scene-edit-dialog'
import {
  buildSceneAssetMentionCandidates,
  resolveSceneDescriptionMentionCandidates,
  resolveSceneInlineCharacterMentionCandidates
} from '~/lib/scene-edit-dialog'
import { useSceneDescriptionMentionEditorActions } from '~/composables/useSceneDescriptionMentionEditorActions'

interface UseSceneDescriptionMentionEditorOptions {
  description: Ref<string>
  assetReferenceOptions: Ref<AssetReferenceOption[]>
  selectedAssetReferenceIds: Ref<string[]>
  dialogOpen: Ref<boolean>
}

export function useSceneDescriptionMentionEditor(options: UseSceneDescriptionMentionEditorOptions) {
  const sceneDescriptionEditorRef = ref<HTMLDivElement | null>(null)
  const sceneDescriptionMentionListRef = ref<HTMLDivElement | null>(null)
  const sceneDescriptionMentionOpen = ref(false)
  const sceneDescriptionMentionQuery = ref('')
  const sceneDescriptionMentionStart = ref<number | null>(null)
  const sceneDescriptionMentionActiveIndex = ref(0)
  const sceneDescriptionComposing = ref(false)

  const sceneDescriptionSupportsMention = computed(() => {
    return options.assetReferenceOptions.value.length > 0
  })

  const sceneAssetMentionCandidatesSource = computed<AssetMentionCandidate[]>(() => {
    return buildSceneAssetMentionCandidates(options.assetReferenceOptions.value)
  })

  const sceneAssetMentionTokenMap = computed(() => {
    const map = new Map<string, AssetMentionCandidate>()
    for (const candidate of sceneAssetMentionCandidatesSource.value) {
      map.set(candidate.token, candidate)
    }
    return map
  })

  const sceneAssetMentionCandidateById = computed(() => {
    return new Map(
      sceneAssetMentionCandidatesSource.value.map(candidate => [candidate.asset.id, candidate])
    )
  })

  const sceneDescriptionMentionCandidates = computed(() => {
    return resolveSceneDescriptionMentionCandidates(
      sceneAssetMentionCandidatesSource.value,
      sceneDescriptionMentionQuery.value
    )
  })

  const sceneInlineCharacterMentionCandidates = computed(() => {
    return resolveSceneInlineCharacterMentionCandidates(sceneAssetMentionCandidatesSource.value)
  })

  const {
    closeSceneDescriptionMention,
    renderSceneDescriptionEditor,
    syncSceneDescriptionFromEditor,
    insertSceneAssetMention,
    handleSceneDescriptionInput,
    handleSceneDescriptionCursorChange,
    handleSceneDescriptionFocus,
    handleSceneDescriptionCompositionStart,
    handleSceneDescriptionCompositionEnd,
    handleSceneDescriptionBlur,
    handleSceneDescriptionKeydown,
    extractMentionedAssetIdsFromDescription
  } = useSceneDescriptionMentionEditorActions({
    description: options.description,
    selectedAssetReferenceIds: options.selectedAssetReferenceIds,
    sceneDescriptionEditorRef,
    sceneDescriptionMentionListRef,
    sceneDescriptionMentionOpen,
    sceneDescriptionMentionQuery,
    sceneDescriptionMentionStart,
    sceneDescriptionMentionActiveIndex,
    sceneDescriptionComposing,
    sceneDescriptionSupportsMention,
    sceneAssetMentionCandidatesSource,
    sceneAssetMentionTokenMap,
    sceneAssetMentionCandidateById,
    sceneDescriptionMentionCandidates,
    sceneInlineCharacterMentionCandidates
  })

  watch(
    () => [
      options.dialogOpen.value,
      sceneDescriptionSupportsMention.value,
      options.assetReferenceOptions.value.map(asset => `${asset.id}:${asset.name}`).join('||')
    ],
    ([open, supportsMention]) => {
      if (!open) {
        closeSceneDescriptionMention()
        return
      }

      if (!supportsMention) return

      nextTick(() => {
        renderSceneDescriptionEditor(options.description.value || '')
      })
    },
    { immediate: true }
  )

  return {
    sceneDescriptionEditorRef,
    sceneDescriptionMentionListRef,
    sceneDescriptionMentionOpen,
    sceneDescriptionMentionActiveIndex,
    sceneDescriptionMentionCandidates,
    sceneDescriptionSupportsMention,
    closeSceneDescriptionMention,
    renderSceneDescriptionEditor,
    syncSceneDescriptionFromEditor,
    insertSceneAssetMention,
    handleSceneDescriptionInput,
    handleSceneDescriptionCursorChange,
    handleSceneDescriptionFocus,
    handleSceneDescriptionCompositionStart,
    handleSceneDescriptionCompositionEnd,
    handleSceneDescriptionBlur,
    handleSceneDescriptionKeydown,
    extractMentionedAssetIdsFromDescription
  }
}
