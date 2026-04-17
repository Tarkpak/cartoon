import type { ComputedRef, Ref } from 'vue'
import type {
  DisplayAsset,
  SceneChatMentionCandidate
} from '~/lib/asset-workbench-types'
import {
  applySceneChatMentionToText,
  buildSceneChatMentionCandidates,
  resolveSceneChatMentionState,
  resolveSceneChatTextareaElement
} from '~/lib/asset-workbench-scene-chat'

interface UseAssetWorkbenchSceneChatMentionsOptions {
  allAssets: ComputedRef<DisplayAsset[]>
  composerText: Ref<string>
  resolveAssetMentionTokenMap: () => Map<string, string>
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  onSubmit: () => void
}

export function useAssetWorkbenchSceneChatMentions(
  options: UseAssetWorkbenchSceneChatMentionsOptions
) {
  const sceneChatMentionOpen = ref(false)
  const sceneChatMentionQuery = ref('')
  const sceneChatMentionStart = ref<number | null>(null)
  const sceneChatMentionActiveIndex = ref(0)
  const sceneChatMentionListRef = ref<HTMLDivElement | null>(null)
  const sceneChatInputRef = ref<HTMLTextAreaElement | null>(null)

  const sceneChatMentionCandidates = computed<SceneChatMentionCandidate[]>(() => {
    return buildSceneChatMentionCandidates({
      assets: options.allAssets.value,
      query: sceneChatMentionQuery.value,
      tokenMap: options.resolveAssetMentionTokenMap(),
      resolveDisplayAssetTypeLabel: options.resolveDisplayAssetTypeLabel
    })
  })

  watch(sceneChatMentionCandidates, (candidates) => {
    if (!sceneChatMentionOpen.value) return

    if (candidates.length === 0) {
      closeSceneChatMention()
      return
    }

    if (sceneChatMentionActiveIndex.value >= candidates.length) {
      sceneChatMentionActiveIndex.value = candidates.length - 1
    }

    syncSceneChatMentionActiveItemIntoView()
  })

  function setSceneChatInputRef(target: unknown) {
    sceneChatInputRef.value = resolveSceneChatTextareaElement(target)
  }

  function setSceneChatMentionListRef(target: unknown) {
    sceneChatMentionListRef.value = target instanceof HTMLDivElement ? target : null
  }

  function closeSceneChatMention() {
    sceneChatMentionOpen.value = false
    sceneChatMentionQuery.value = ''
    sceneChatMentionStart.value = null
    sceneChatMentionActiveIndex.value = 0
  }

  function syncSceneChatMentionActiveItemIntoView() {
    if (!sceneChatMentionOpen.value) return

    nextTick(() => {
      const listElement = sceneChatMentionListRef.value
      if (!listElement) return

      const target = listElement.querySelector<HTMLElement>(
        `[data-scene-chat-mention-index="${sceneChatMentionActiveIndex.value}"]`
      )
      target?.scrollIntoView({ block: 'nearest' })
    })
  }

  function updateSceneChatMentionState() {
    const textarea = sceneChatInputRef.value
    if (!textarea) {
      closeSceneChatMention()
      return
    }

    const cursor = textarea.selectionStart ?? options.composerText.value.length
    const mentionState = resolveSceneChatMentionState({
      text: options.composerText.value,
      cursor
    })

    if (!mentionState.open || mentionState.start === null) {
      closeSceneChatMention()
      return
    }

    sceneChatMentionStart.value = mentionState.start
    sceneChatMentionQuery.value = mentionState.query
    sceneChatMentionOpen.value = sceneChatMentionCandidates.value.length > 0
    if (!sceneChatMentionOpen.value) {
      sceneChatMentionActiveIndex.value = 0
    } else {
      syncSceneChatMentionActiveItemIntoView()
    }
  }

  function applySceneChatMention(candidate: SceneChatMentionCandidate) {
    const textarea = sceneChatInputRef.value
    const start = sceneChatMentionStart.value
    if (!textarea || start === null) return

    const cursor = textarea.selectionStart ?? options.composerText.value.length
    const nextState = applySceneChatMentionToText({
      text: options.composerText.value,
      start,
      cursor,
      token: candidate.token
    })

    options.composerText.value = nextState.text
    closeSceneChatMention()

    nextTick(() => {
      textarea.focus()
      textarea.setSelectionRange(nextState.cursor, nextState.cursor)
    })
  }

  function handleSceneChatComposerInput() {
    updateSceneChatMentionState()
  }

  function handleSceneChatComposerCursor() {
    updateSceneChatMentionState()
  }

  function handleSceneChatComposerKeydown(event: KeyboardEvent) {
    if (sceneChatMentionOpen.value && sceneChatMentionCandidates.value.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        sceneChatMentionActiveIndex.value = (sceneChatMentionActiveIndex.value + 1) % sceneChatMentionCandidates.value.length
        syncSceneChatMentionActiveItemIntoView()
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const lastIndex = sceneChatMentionCandidates.value.length - 1
        sceneChatMentionActiveIndex.value = sceneChatMentionActiveIndex.value <= 0
          ? lastIndex
          : sceneChatMentionActiveIndex.value - 1
        syncSceneChatMentionActiveItemIntoView()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const candidate = sceneChatMentionCandidates.value[sceneChatMentionActiveIndex.value]
        if (candidate) {
          applySceneChatMention(candidate)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSceneChatMention()
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      options.onSubmit()
    }
  }

  return {
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
  }
}
