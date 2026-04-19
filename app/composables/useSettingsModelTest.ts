import type { ImageModelConfig } from '#shared/types/provider'
import {
  buildTestSelectedModels,
  getModelDocUrl,
  getModelMaxDuration,
  getSettingsProviderColor,
  modelSupportsReferenceImage,
  modelSupportsThinking,
  SETTINGS_MODEL_TEST_PROMPTS,
  SETTINGS_PROVIDER_CONFIG,
  type ModelTestTab,
  type ProviderGroup,
  type TestResult,
  type TestSelectedModels
} from '@/lib/settings-models'

export function useSettingsModelTest() {
  const { models, selectedModels, loading, loadModels } = useSettingsModelCatalog()
  const DEFAULT_IMAGE_ASPECT_RATIO = '1:1'

  const activeTab = ref<ModelTestTab>('video')
  const expandedProviders = ref<Set<string>>(new Set())
  const customPrompts = ref<Record<ModelTestTab, string>>({
    text: '',
    image: '',
    video: '',
    tts: ''
  })
  const referenceImages = ref<string[]>([])
  const testResults = ref<Record<ModelTestTab, TestResult>>({
    text: { status: 'idle' },
    image: { status: 'idle' },
    video: { status: 'idle' },
    tts: { status: 'idle' }
  })
  const testSelectedModels = ref<TestSelectedModels>({
    text: '',
    image: '',
    video: '',
    tts: ''
  })
  const imageAspectRatio = ref<string>(DEFAULT_IMAGE_ASPECT_RATIO)

  const imagePrompt = computed({
    get: () => customPrompts.value.image,
    set: (value: string) => {
      customPrompts.value.image = value
    }
  })

  const {
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
  } = useImagePromptReferenceEditor({
    activeTab,
    imagePrompt,
    referenceImages,
    maxReferences: 4
  })

  const currentImageModel = computed<ImageModelConfig | null>(() => {
    if (activeTab.value !== 'image' || !models.value) return null
    return models.value.image.find(model => model.model === testSelectedModels.value.image) || null
  })

  const currentImageModelSupportsReference = computed(() => {
    return currentImageModel.value?.supportReferenceImage === true
  })

  const currentImageModelRequiresReference = computed(() => {
    return currentImageModel.value?.requireReferenceImage === true
  })

  const currentImageModelAspectRatioOptions = computed<string[]>(() => {
    const rawOptions = currentImageModel.value?.supportedAspectRatios || []
    const options = Array.from(new Set(
      rawOptions
        .map(value => value.trim())
        .filter(Boolean)
    ))

    if (options.length > 0) return options
    return [DEFAULT_IMAGE_ASPECT_RATIO]
  })

  const canRunImageTest = computed(() => {
    if (activeTab.value !== 'image') return true
    if (!currentImageModelRequiresReference.value) return true
    return referenceImages.value.length > 0
  })

  function getCurrentModelList() {
    if (!models.value) return []

    switch (activeTab.value) {
      case 'text':
        return models.value.text
      case 'image':
        return models.value.image
      case 'video':
        return models.value.video
      case 'tts':
        return models.value.voice.filter(model => model.type === 'tts')
      default:
        return []
    }
  }

  const groupedModels = computed<ProviderGroup[]>(() => {
    const groups: Record<string, ProviderGroup['models']> = {}

    for (const model of getCurrentModelList()) {
      if (!groups[model.provider]) {
        groups[model.provider] = []
      }
      groups[model.provider]!.push(model)
    }

    return Object.entries(groups)
      .map(([provider, providerModels]) => ({
        provider,
        displayName: SETTINGS_PROVIDER_CONFIG[provider]?.displayName || provider,
        models: providerModels,
        expanded: expandedProviders.value.has(provider)
      }))
      .sort((left, right) => {
        return (SETTINGS_PROVIDER_CONFIG[left.provider]?.order || 99)
          - (SETTINGS_PROVIDER_CONFIG[right.provider]?.order || 99)
      })
  })

  const currentSelectedModel = computed(() => {
    switch (activeTab.value) {
      case 'text':
        return testSelectedModels.value.text
      case 'image':
        return testSelectedModels.value.image
      case 'video':
        return testSelectedModels.value.video
      case 'tts':
        return testSelectedModels.value.tts
      default:
        return ''
    }
  })

  const currentTtsAudioUrl = computed(() => {
    const result = testResults.value.tts.result as { audioUrl?: string } | undefined
    return result?.audioUrl
  })

  function autoExpandSelectedProviders() {
    const providers = new Set(getCurrentModelList().map(model => model.provider))
    for (const provider of providers) {
      expandedProviders.value.add(provider)
    }
  }

  function syncTestSelections(force = false) {
    if (!models.value) return

    const next = buildTestSelectedModels(selectedModels.value, models.value)
    if (force || !testSelectedModels.value.text) {
      testSelectedModels.value = next
      return
    }

    testSelectedModels.value = {
      text: selectedModels.value.text || testSelectedModels.value.text || next.text,
      image: selectedModels.value.image || testSelectedModels.value.image || next.image,
      video: selectedModels.value.video || testSelectedModels.value.video || next.video,
      tts: selectedModels.value.tts || testSelectedModels.value.tts || next.tts
    }
  }

  function selectTestModel(type: ModelTestTab, modelId: string) {
    if (testSelectedModels.value[type] === modelId) return

    testSelectedModels.value[type] = modelId
    testResults.value[type] = { status: 'idle' }

    if (type === 'image') {
      referenceImages.value = []
    }

    closeImageMention()
  }

  function toggleProvider(provider: string) {
    if (expandedProviders.value.has(provider)) {
      expandedProviders.value.delete(provider)
    } else {
      expandedProviders.value.add(provider)
    }
  }

  async function testModel(modelType: ModelTestTab) {
    testResults.value[modelType] = { status: 'testing' }

    const rawPrompt = customPrompts.value[modelType] || SETTINGS_MODEL_TEST_PROMPTS[modelType]
    const modelId = testSelectedModels.value[modelType] || ''

    try {
      const body: Record<string, unknown> = {
        modelType,
        prompt: modelType === 'image'
          ? resolveImagePromptWithReferenceTokens(rawPrompt, SETTINGS_MODEL_TEST_PROMPTS.image)
          : rawPrompt
      }

      if (modelId) {
        body.modelId = modelId
      }

      if (modelType === 'image' && referenceImages.value.length > 0) {
        body.referenceImages = referenceImages.value
      }

      if (modelType === 'image') {
        body.imageAspectRatio = imageAspectRatio.value
      }

      const response = await $fetch<{
        success: boolean
        data?: {
          result: unknown
          latencyMs: number
        }
        error?: string
      }>('/api/models/test', {
        method: 'POST',
        body
      })

      if (response.success && response.data) {
        testResults.value[modelType] = {
          status: 'success',
          message: `测试成功 (${response.data.latencyMs}ms)`,
          latencyMs: response.data.latencyMs,
          result: response.data.result
        }
        return
      }

      testResults.value[modelType] = {
        status: 'error',
        message: response.error || '测试失败'
      }
    } catch (error) {
      testResults.value[modelType] = {
        status: 'error',
        message: error instanceof Error ? error.message : '测试失败'
      }
    }
  }

  watch(activeTab, () => {
    autoExpandSelectedProviders()
  })

  watch(currentImageModelAspectRatioOptions, (options) => {
    if (options.includes(imageAspectRatio.value)) return
    imageAspectRatio.value = options[0] || DEFAULT_IMAGE_ASPECT_RATIO
  }, { immediate: true })

  watch(models, () => {
    syncTestSelections(true)
    autoExpandSelectedProviders()
  }, { immediate: true })

  watch(
    () => [
      selectedModels.value.text,
      selectedModels.value.image,
      selectedModels.value.video,
      selectedModels.value.tts
    ],
    () => {
      syncTestSelections()
    },
    { immediate: true }
  )

  onMounted(() => {
    void loadModels()
  })

  return {
    loading,
    models,
    activeTab,
    customPrompts,
    referenceImages,
    testResults,
    groupedModels,
    currentSelectedModel,
    currentTtsAudioUrl,
    currentImageModelSupportsReference,
    currentImageModelRequiresReference,
    currentImageModelAspectRatioOptions,
    imageAspectRatio,
    canRunImageTest,
    fileInputRef,
    promptEditorRef,
    imagePromptIsEmpty,
    imageMentionOpen,
    imageMentionCandidates,
    imageMentionActiveIndex,
    referencePreviewOpen,
    referencePreviewSrc,
    referencePreviewAlt,
    getModelDocUrl,
    getModelMaxDuration,
    getSettingsProviderColor,
    modelSupportsThinking,
    modelSupportsReferenceImage,
    insertImageMention,
    handlePromptTextareaInput,
    handlePromptTextareaCursorChange,
    handlePromptTextareaFocus,
    handlePromptTextareaCompositionStart,
    handlePromptTextareaCompositionEnd,
    handlePromptTextareaBlur,
    handlePromptTextareaKeydown,
    handleReferenceImageUpload,
    removeReferenceImage,
    triggerFileInput,
    openReferenceImagePreview,
    selectTestModel,
    toggleProvider,
    testModel
  }
}
