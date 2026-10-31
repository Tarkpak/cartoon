import type { WritableComputedRef, Ref } from 'vue'

export type ImagePromptReferenceTab = 'text' | 'image' | 'video' | 'tts'

interface UseImagePromptReferenceEditorOptions {
  activeTab: Ref<ImagePromptReferenceTab>
  imagePrompt: WritableComputedRef<string>
  referenceImages: Ref<string[]>
  maxReferences?: number | Ref<number>
}

export function useImagePromptReferenceEditor(options: UseImagePromptReferenceEditorOptions) {
  const fileInputRef = ref<HTMLInputElement | null>(null)
  const referencePreviewOpen = ref(false)
  const referencePreviewSrc = ref('')
  const referencePreviewAlt = ref('参考图预览')

  const maxReferenceCount = computed(() => {
    if (typeof options.maxReferences === 'number') {
      return options.maxReferences
    }
    if (options.maxReferences && typeof options.maxReferences.value === 'number') {
      return options.maxReferences.value
    }
    return 4
  })
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

  const pendingUploads = ref(0)
  const referenceImagesUploading = computed(() => pendingUploads.value > 0)
  const referenceUploadError = ref('')
  let uploadQueue = Promise.resolve()

  async function handleReferenceImageUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files || [])
    input.value = ''
    if (!files.length) return
    const target = options.referenceImages.value
    const selected = files.filter(file => file.type.startsWith('image/'))
      .slice(0, Math.max(0, maxReferenceCount.value - target.length))
    referenceUploadError.value = selected.length < files.length ? '部分文件不是图片或超出参考图数量上限' : ''
    if (!selected.length) return
    pendingUploads.value += 1
    const previous = uploadQueue
    let complete!: () => void
    uploadQueue = new Promise<void>(resolve => { complete = resolve })
    try {
      const images = await Promise.all(selected.map(file => new Promise<string | null>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.onabort = () => resolve(null)
        try { reader.readAsDataURL(file) } catch { resolve(null) }
      })))
      await previous
      // Replacing the array starts a new model/project context. Ignore old reads.
      if (options.referenceImages.value !== target) return
      if (images.some(image => !image)) referenceUploadError.value = '部分图片读取失败，请重试'
      for (const image of images) {
        if (image && target.length < maxReferenceCount.value) target.push(image)
      }
    } finally {
      pendingUploads.value -= 1
      complete()
    }
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
    referenceImagesUploading,
    referenceUploadError,
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
