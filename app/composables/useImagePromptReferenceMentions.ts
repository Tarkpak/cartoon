import type { WritableComputedRef, Ref } from 'vue'
import {
  appendImageReferenceTokenMapping,
  buildImageMentionCandidates,
  collectCaretSegments,
  getImageMentionToken,
  getSerializedTextFromNodes,
  insertImageMentionText,
  IMAGE_REFERENCE_INLINE_PATTERN
} from '~/lib/image-prompt-reference-editor'
import type { ImageMentionCandidate } from '~/lib/image-prompt-reference-editor'
import {
  readContentEditableEditorState,
  renderContentEditableTextWithMatches,
  resolveAtMentionState,
  setContentEditableEditorCaret
} from '~/lib/contenteditable-mention'
import type { ImagePromptReferenceTab } from '~/composables/useImagePromptReferenceEditor'

interface ImagePromptEditorState {
  text: string
  caret: number
}

interface UseImagePromptReferenceMentionsOptions {
  activeTab: Ref<ImagePromptReferenceTab>
  imagePrompt: WritableComputedRef<string>
  referenceImages: Ref<string[]>
}

export function useImagePromptReferenceMentions(
  options: UseImagePromptReferenceMentionsOptions
) {
  const promptEditorRef = ref<HTMLDivElement | null>(null)
  const syncingImagePromptFromEditor = ref(false)
  const imagePromptEditorFocused = ref(false)
  const imagePromptComposing = ref(false)
  const imageMentionOpen = ref(false)
  const imageMentionQuery = ref('')
  const imageMentionStart = ref<number | null>(null)
  const imageMentionCaret = ref(0)
  const imageMentionActiveIndex = ref(0)

  const imageMentionCandidates = computed<ImageMentionCandidate[]>(() => {
    if (options.activeTab.value !== 'image') return []

    return buildImageMentionCandidates(
      options.referenceImages.value,
      imageMentionQuery.value
    )
  })

  function closeImageMention() {
    imageMentionOpen.value = false
    imageMentionQuery.value = ''
    imageMentionStart.value = null
    imageMentionActiveIndex.value = 0
  }

  function resolvePromptEditorElement(): HTMLDivElement | null {
    return promptEditorRef.value
  }

  function getImagePromptEditorState(): ImagePromptEditorState {
    return readContentEditableEditorState({
      editor: resolvePromptEditorElement(),
      fallbackText: options.imagePrompt.value || '',
      serializeNodes: getSerializedTextFromNodes
    })
  }

  function setImagePromptEditorCaret(offset: number) {
    setContentEditableEditorCaret({
      editor: resolvePromptEditorElement(),
      offset,
      collectSegments: collectCaretSegments
    })
  }

  function createImageMentionNode(imageIndex: number): HTMLSpanElement {
    const token = getImageMentionToken(imageIndex)
    const mention = document.createElement('span')
    mention.className = 'inline-flex items-center gap-1 rounded-md border bg-muted/70 px-1.5 py-0.5 align-middle'
    mention.contentEditable = 'false'
    mention.dataset.mentionToken = token
    mention.dataset.mentionIndex = String(imageIndex)

    const image = document.createElement('img')
    image.src = options.referenceImages.value[imageIndex] || ''
    image.className = 'h-4 w-4 rounded object-cover'
    image.alt = token

    const label = document.createElement('span')
    label.className = 'text-xs'
    label.textContent = token

    mention.append(image, label)
    return mention
  }

  function renderImagePromptEditor(text: string, caretOffset?: number) {
    renderContentEditableTextWithMatches({
      editor: resolvePromptEditorElement(),
      text,
      matcher: new RegExp(IMAGE_REFERENCE_INLINE_PATTERN, 'giu'),
      createMatchNode: (match) => {
        const rawIndex = Number(match[1] || match[2] || NaN)
        const imageIndex = Number.isInteger(rawIndex) ? rawIndex - 1 : -1
        if (imageIndex >= 0 && imageIndex < options.referenceImages.value.length) {
          return createImageMentionNode(imageIndex)
        }

        return null
      },
      setCaret: setImagePromptEditorCaret,
      caretOffset
    })
  }

  function syncImagePromptFromEditor() {
    const state = getImagePromptEditorState()
    syncingImagePromptFromEditor.value = true
    options.imagePrompt.value = state.text
    syncingImagePromptFromEditor.value = false
    return state
  }

  function updateImageMentionState(state?: ImagePromptEditorState) {
    if (
      options.activeTab.value !== 'image'
      || options.referenceImages.value.length === 0
      || imagePromptComposing.value
    ) {
      closeImageMention()
      return
    }

    const currentState = state || getImagePromptEditorState()
    imageMentionCaret.value = currentState.caret

    const mentionState = resolveAtMentionState(currentState.text, currentState.caret, {
      maxQueryLength: 24
    })
    if (!mentionState.open || mentionState.start === null) {
      closeImageMention()
      return
    }

    imageMentionStart.value = mentionState.start
    imageMentionQuery.value = mentionState.query
    imageMentionOpen.value = true

    if (imageMentionActiveIndex.value >= imageMentionCandidates.value.length) {
      imageMentionActiveIndex.value = 0
    }
  }

  function insertImageMention(imageIndex: number) {
    if (options.activeTab.value !== 'image') return

    const state = getImagePromptEditorState()
    const start = imageMentionStart.value
    if (start === null) return

    const token = getImageMentionToken(imageIndex)
    const nextState = insertImageMentionText({
      text: state.text,
      start,
      caret: state.caret,
      token
    })

    syncingImagePromptFromEditor.value = true
    options.imagePrompt.value = nextState.text
    syncingImagePromptFromEditor.value = false

    closeImageMention()
    renderImagePromptEditor(nextState.text, nextState.caret)
  }

  function handlePromptTextareaInput() {
    if (options.activeTab.value !== 'image' || imagePromptComposing.value) return
    const state = syncImagePromptFromEditor()
    updateImageMentionState(state)
  }

  function handlePromptTextareaCursorChange() {
    if (options.activeTab.value !== 'image' || imagePromptComposing.value) return
    updateImageMentionState()
  }

  function handlePromptTextareaFocus() {
    if (options.activeTab.value !== 'image') return
    imagePromptEditorFocused.value = true

    if (!imagePromptComposing.value) {
      updateImageMentionState()
    }
  }

  function handlePromptTextareaCompositionStart() {
    if (options.activeTab.value !== 'image') return
    imagePromptComposing.value = true
    closeImageMention()
  }

  function handlePromptTextareaCompositionEnd() {
    if (options.activeTab.value !== 'image') return
    imagePromptComposing.value = false
    const state = syncImagePromptFromEditor()
    updateImageMentionState(state)
  }

  function handlePromptTextareaBlur() {
    if (options.activeTab.value !== 'image') return

    imagePromptEditorFocused.value = false
    syncImagePromptFromEditor()

    const state = getImagePromptEditorState()
    renderImagePromptEditor(state.text, state.caret)

    setTimeout(() => {
      closeImageMention()
    }, 120)
  }

  function handlePromptTextareaKeydown(event: KeyboardEvent) {
    if (imagePromptComposing.value) return
    if (options.activeTab.value !== 'image' || !imageMentionOpen.value) return

    const candidates = imageMentionCandidates.value

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (candidates.length === 0) return
      imageMentionActiveIndex.value = (imageMentionActiveIndex.value + 1) % candidates.length
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (candidates.length === 0) return
      imageMentionActiveIndex.value = (imageMentionActiveIndex.value - 1 + candidates.length) % candidates.length
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      if (candidates.length === 0) {
        closeImageMention()
        return
      }

      const target = candidates[imageMentionActiveIndex.value] || candidates[0]
      if (target) {
        insertImageMention(target.index)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeImageMention()
    }
  }

  function resolveImagePromptWithReferenceTokens(rawPrompt: string, fallbackPrompt: string): string {
    return appendImageReferenceTokenMapping(
      rawPrompt || fallbackPrompt,
      options.referenceImages.value.length
    )
  }

  watch(options.activeTab, () => {
    closeImageMention()

    if (options.activeTab.value !== 'image') {
      return
    }

    nextTick(() => {
      const prompt = options.imagePrompt.value || ''
      renderImagePromptEditor(prompt, prompt.length)
    })
  })

  watch(options.referenceImages, () => {
    if (options.activeTab.value !== 'image') {
      if (options.referenceImages.value.length === 0) {
        closeImageMention()
      }
      return
    }

    nextTick(() => {
      const state = getImagePromptEditorState()
      const prompt = options.imagePrompt.value || ''
      renderImagePromptEditor(prompt, Math.min(state.caret, prompt.length))

      if (options.referenceImages.value.length === 0) {
        closeImageMention()
      } else {
        updateImageMentionState()
      }
    })
  }, { deep: true })

  watch(() => options.imagePrompt.value, (prompt) => {
    if (options.activeTab.value !== 'image') return
    if (syncingImagePromptFromEditor.value) return
    if (imagePromptEditorFocused.value || imagePromptComposing.value) return

    nextTick(() => {
      const state = getImagePromptEditorState()
      const safePrompt = prompt || ''
      renderImagePromptEditor(safePrompt, Math.min(state.caret, safePrompt.length))
      updateImageMentionState()
    })
  })

  return {
    promptEditorRef,
    imageMentionOpen,
    imageMentionCandidates,
    imageMentionActiveIndex,
    closeImageMention,
    insertImageMention,
    handlePromptTextareaInput,
    handlePromptTextareaCursorChange,
    handlePromptTextareaFocus,
    handlePromptTextareaCompositionStart,
    handlePromptTextareaCompositionEnd,
    handlePromptTextareaBlur,
    handlePromptTextareaKeydown,
    resolveImagePromptWithReferenceTokens
  }
}
