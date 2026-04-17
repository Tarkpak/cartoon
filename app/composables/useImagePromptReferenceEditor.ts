import type { WritableComputedRef, Ref } from 'vue'

export type ImagePromptReferenceTab = 'text' | 'image' | 'video' | 'tts'

interface UseImagePromptReferenceEditorOptions {
  activeTab: Ref<ImagePromptReferenceTab>
  imagePrompt: WritableComputedRef<string>
  referenceImages: Ref<string[]>
  maxReferences?: number
}

export function useImagePromptReferenceEditor(options: UseImagePromptReferenceEditorOptions) {
  const fileInputRef = ref<HTMLInputElement | null>(null)
  const referencePreviewOpen = ref(false)
  const referencePreviewSrc = ref('')
  const referencePreviewAlt = ref('参考图预览')

  const maxReferenceCount = computed(() => options.maxReferences ?? 4)
  const imagePromptIsEmpty = computed(() => !(options.imagePrompt.value || '').trim())

  const {
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
  } = useImagePromptReferenceMentions({
    activeTab: options.activeTab,
    imagePrompt: options.imagePrompt,
    referenceImages: options.referenceImages
  })

  function handleReferenceImageUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    const remainingSlots = maxReferenceCount.value - options.referenceImages.value.length
    for (const file of Array.from(files).slice(0, remainingSlots)) {
      if (!file.type.startsWith('image/')) continue

      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const base64 = loadEvent.target?.result as string
        if (!base64 || options.referenceImages.value.length >= maxReferenceCount.value) return
        options.referenceImages.value.push(base64)
      }
      reader.readAsDataURL(file)
    }

    input.value = ''
  }

  function removeReferenceImage(index: number) {
    options.referenceImages.value.splice(index, 1)
  }

  function triggerFileInput() {
    fileInputRef.value?.click()
  }

  function openReferenceImagePreview(src: string, index?: number) {
    if (!src) return
    referencePreviewSrc.value = src
    referencePreviewAlt.value = typeof index === 'number' ? `参考图 ${index + 1}` : '参考图预览'
    referencePreviewOpen.value = true
  }

  return {
    fileInputRef,
    promptEditorRef,
    imagePromptIsEmpty,
    imageMentionOpen,
    imageMentionCandidates,
    imageMentionActiveIndex,
    referencePreviewOpen,
    referencePreviewSrc,
    referencePreviewAlt,
    closeImageMention,
    insertImageMention,
    handlePromptTextareaInput,
    handlePromptTextareaCursorChange,
    handlePromptTextareaFocus,
    handlePromptTextareaCompositionStart,
    handlePromptTextareaCompositionEnd,
    handlePromptTextareaBlur,
    handlePromptTextareaKeydown,
    resolveImagePromptWithReferenceTokens,
    handleReferenceImageUpload,
    removeReferenceImage,
    triggerFileInput,
    openReferenceImagePreview
  }
}
