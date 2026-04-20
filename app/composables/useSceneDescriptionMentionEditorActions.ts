import type { ComputedRef, Ref } from 'vue'
import { toImageSrc } from '~/lib/media'
import type {
  AssetMentionCandidate
} from '~/lib/scene-edit-dialog'
import {
  buildSceneDescriptionMentionMatcher,
  extractMentionedAssetIdsFromDescription as extractMentionedAssetIds,
  normalizeSceneDescriptionCharacterMentions,
  uniqueValues
} from '~/lib/scene-edit-dialog'
import {
  readContentEditableEditorState,
  renderContentEditableTextWithMatches,
  scrollMentionActiveItemIntoView,
  setContentEditableEditorCaret
} from '~/lib/contenteditable-mention'
import {
  collectSceneDescriptionCaretSegments,
  getSerializedSceneDescriptionText,
  insertSceneDescriptionMentionText,
  resolveSceneDescriptionMentionState
} from '~/lib/scene-description-mention-editor'

interface UseSceneDescriptionMentionEditorActionsOptions {
  description: Ref<string>
  selectedAssetReferenceIds: Ref<string[]>
  sceneDescriptionEditorRef: Ref<HTMLDivElement | null>
  sceneDescriptionMentionListRef: Ref<HTMLDivElement | null>
  sceneDescriptionMentionOpen: Ref<boolean>
  sceneDescriptionMentionQuery: Ref<string>
  sceneDescriptionMentionStart: Ref<number | null>
  sceneDescriptionMentionActiveIndex: Ref<number>
  sceneDescriptionComposing: Ref<boolean>
  sceneDescriptionSupportsMention: ComputedRef<boolean>
  sceneAssetMentionCandidatesSource: ComputedRef<AssetMentionCandidate[]>
  sceneAssetMentionTokenMap: ComputedRef<Map<string, AssetMentionCandidate>>
  sceneAssetMentionCandidateById: ComputedRef<Map<string, AssetMentionCandidate>>
  sceneDescriptionMentionCandidates: ComputedRef<AssetMentionCandidate[]>
  sceneInlineCharacterMentionCandidates: ComputedRef<AssetMentionCandidate[]>
}

export function useSceneDescriptionMentionEditorActions(
  options: UseSceneDescriptionMentionEditorActionsOptions
) {
  function isCaretAfterRenderedMentionToken(state: { caret: number }, mentionStart: number): boolean {
    const editor = options.sceneDescriptionEditorRef.value
    if (!editor) return false

    const { segments } = collectSceneDescriptionCaretSegments(Array.from(editor.childNodes))
    return segments.some((segment) => {
      return segment.type === 'mention'
        && segment.start === mentionStart
        && segment.end === state.caret
    })
  }

  function closeSceneDescriptionMention() {
    options.sceneDescriptionMentionOpen.value = false
    options.sceneDescriptionMentionQuery.value = ''
    options.sceneDescriptionMentionStart.value = null
    options.sceneDescriptionMentionActiveIndex.value = 0
  }

  function syncSceneDescriptionMentionActiveItemIntoView() {
    if (!options.sceneDescriptionMentionOpen.value) return

    scrollMentionActiveItemIntoView({
      listElement: options.sceneDescriptionMentionListRef.value,
      activeIndex: options.sceneDescriptionMentionActiveIndex.value,
      dataAttribute: 'data-scene-description-mention-index'
    })
  }

  function getSceneDescriptionEditorState(): { text: string, caret: number } {
    return readContentEditableEditorState({
      editor: options.sceneDescriptionEditorRef.value,
      fallbackText: options.description.value || '',
      serializeNodes: getSerializedSceneDescriptionText
    })
  }

  function setSceneDescriptionEditorCaret(offset: number) {
    setContentEditableEditorCaret({
      editor: options.sceneDescriptionEditorRef.value,
      offset,
      collectSegments: collectSceneDescriptionCaretSegments
    })
  }

  function createSceneAssetMentionNode(candidate: AssetMentionCandidate): HTMLSpanElement {
    const mention = document.createElement('span')
    mention.className = 'inline-flex items-center gap-1 rounded-md border bg-muted/70 px-1.5 py-0.5 align-middle'
    mention.contentEditable = 'false'
    mention.dataset.assetMentionToken = candidate.token
    mention.dataset.assetId = candidate.asset.id

    if (candidate.asset.referenceImage) {
      const image = document.createElement('img')
      image.src = toImageSrc(candidate.asset.referenceImage) || ''
      image.className = 'h-4 w-4 rounded object-cover'
      image.alt = `${candidate.asset.name} 缩略图`
      mention.append(image)
    }

    const label = document.createElement('span')
    label.className = 'text-xs'
    label.textContent = candidate.token
    mention.append(label)

    return mention
  }

  function renderSceneDescriptionEditor(text: string, caretOffset?: number) {
    const editor = options.sceneDescriptionEditorRef.value
    if (!editor) return

    const textForRender = typeof caretOffset === 'number'
      ? text
      : normalizeSceneDescriptionCharacterMentions(
          text,
          options.sceneInlineCharacterMentionCandidates.value
        )

    const matcher = buildSceneDescriptionMentionMatcher(options.sceneAssetMentionCandidatesSource.value)
    renderContentEditableTextWithMatches({
      editor,
      text: textForRender,
      matcher,
      createMatchNode: (match) => {
        const candidate = options.sceneAssetMentionTokenMap.value.get(match[0] || '')
        return candidate ? createSceneAssetMentionNode(candidate) : null
      },
      setCaret: setSceneDescriptionEditorCaret,
      caretOffset
    })
  }

  function syncSceneDescriptionFromEditor() {
    const state = getSceneDescriptionEditorState()
    options.description.value = state.text
    return state
  }

  function updateSceneDescriptionMentionState(state?: { text: string, caret: number }) {
    if (!options.sceneDescriptionSupportsMention.value || options.sceneDescriptionComposing.value) {
      closeSceneDescriptionMention()
      return
    }

    const current = state || getSceneDescriptionEditorState()
    const mentionState = resolveSceneDescriptionMentionState(current.text, current.caret)
    if (!mentionState.open || mentionState.start === null) {
      closeSceneDescriptionMention()
      return
    }

    if (isCaretAfterRenderedMentionToken(current, mentionState.start)) {
      closeSceneDescriptionMention()
      return
    }

    options.sceneDescriptionMentionStart.value = mentionState.start
    options.sceneDescriptionMentionQuery.value = mentionState.query
    options.sceneDescriptionMentionOpen.value = true
    if (options.sceneDescriptionMentionActiveIndex.value >= options.sceneDescriptionMentionCandidates.value.length) {
      options.sceneDescriptionMentionActiveIndex.value = 0
    }
    if (options.sceneDescriptionMentionCandidates.value.length > 0) {
      syncSceneDescriptionMentionActiveItemIntoView()
    }
  }

  function insertSceneAssetMention(assetId: string) {
    if (!options.sceneDescriptionSupportsMention.value) return

    const candidate = options.sceneAssetMentionCandidateById.value.get(assetId)
    if (!candidate) return

    const state = getSceneDescriptionEditorState()
    const start = options.sceneDescriptionMentionStart.value
    if (start === null) return

    const nextState = insertSceneDescriptionMentionText({
      text: state.text,
      start,
      caret: state.caret,
      token: candidate.token
    })

    options.description.value = nextState.text
    options.selectedAssetReferenceIds.value = uniqueValues([
      ...options.selectedAssetReferenceIds.value,
      candidate.asset.id
    ])

    closeSceneDescriptionMention()
    renderSceneDescriptionEditor(nextState.text, nextState.caret)
  }

  function handleSceneDescriptionInput() {
    if (!options.sceneDescriptionSupportsMention.value || options.sceneDescriptionComposing.value) return
    const state = syncSceneDescriptionFromEditor()
    updateSceneDescriptionMentionState(state)
  }

  function handleSceneDescriptionCursorChange() {
    if (!options.sceneDescriptionSupportsMention.value || options.sceneDescriptionComposing.value) return
    updateSceneDescriptionMentionState()
  }

  function handleSceneDescriptionFocus() {
    if (!options.sceneDescriptionSupportsMention.value) return
    if (!options.sceneDescriptionComposing.value) {
      updateSceneDescriptionMentionState()
    }
  }

  function handleSceneDescriptionCompositionStart() {
    if (!options.sceneDescriptionSupportsMention.value) return
    options.sceneDescriptionComposing.value = true
    closeSceneDescriptionMention()
  }

  function handleSceneDescriptionCompositionEnd() {
    if (!options.sceneDescriptionSupportsMention.value) return
    options.sceneDescriptionComposing.value = false
    const state = syncSceneDescriptionFromEditor()
    updateSceneDescriptionMentionState(state)
  }

  function handleSceneDescriptionBlur() {
    if (!options.sceneDescriptionSupportsMention.value) return

    syncSceneDescriptionFromEditor()
    const state = getSceneDescriptionEditorState()
    renderSceneDescriptionEditor(state.text, state.caret)

    setTimeout(() => {
      closeSceneDescriptionMention()
    }, 120)
  }

  function handleSceneDescriptionKeydown(event: KeyboardEvent) {
    if (options.sceneDescriptionComposing.value) return
    if (!options.sceneDescriptionSupportsMention.value || !options.sceneDescriptionMentionOpen.value) return

    const candidates = options.sceneDescriptionMentionCandidates.value
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (candidates.length === 0) return
      options.sceneDescriptionMentionActiveIndex.value = (
        options.sceneDescriptionMentionActiveIndex.value + 1
      ) % candidates.length
      syncSceneDescriptionMentionActiveItemIntoView()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (candidates.length === 0) return
      options.sceneDescriptionMentionActiveIndex.value = (
        options.sceneDescriptionMentionActiveIndex.value - 1 + candidates.length
      ) % candidates.length
      syncSceneDescriptionMentionActiveItemIntoView()
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      if (candidates.length === 0) {
        closeSceneDescriptionMention()
        return
      }

      event.preventDefault()

      if (event.key === 'Enter') {
        const state = getSceneDescriptionEditorState()
        const mentionStart = options.sceneDescriptionMentionStart.value
        if (
          mentionStart !== null
          && isCaretAfterRenderedMentionToken(state, mentionStart)
        ) {
          closeSceneDescriptionMention()
          return
        }
      }

      const target = candidates[options.sceneDescriptionMentionActiveIndex.value] || candidates[0]
      if (target) insertSceneAssetMention(target.asset.id)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeSceneDescriptionMention()
    }
  }

  function extractMentionedAssetIdsFromDescription(text: string): string[] {
    return extractMentionedAssetIds(text, options.sceneAssetMentionTokenMap.value)
  }

  return {
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
