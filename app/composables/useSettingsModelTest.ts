import type { ImageModelConfig, VideoModelConfig } from '#shared/types/provider'
import {
  buildTestSelectedModels,
  getModelDocUrl,
  getModelMaxDuration,
  getSettingsProviderColor,
  modelSupportsReferenceImage,
  modelSupportsThinking,
  SETTINGS_MODEL_TEST_PLACEHOLDERS,
  SETTINGS_PROVIDER_CONFIG,
  type ModelTestTab,
  type ProviderGroup,
  type TestResult,
  type TestSelectedModels
} from '@/lib/settings-models'

export function useSettingsModelTest() {
  const { models, selectedModels, loading, loadModels } = useSettingsModelCatalog()
  const DEFAULT_IMAGE_ASPECT_RATIO = '1:1'
  const DEFAULT_IMAGE_QUALITY = 'auto'
  const MODEL_TEST_TAB_STORAGE_KEY = 'playlet:model-test-active-tab'

  const activeTab = ref<ModelTestTab>('text')
  const expandedProviders = ref<Set<string>>(new Set())
  const customPrompts = ref<Record<ModelTestTab, string>>({
    text: '',
    image: '',
    video: '',
    tts: ''
  })
  const referenceImages = ref<string[]>([])
  const videoReferenceImages = ref<string[]>([])
  const videoReferenceVideos = ref<string[]>([])
  const videoReferenceVideoNames = ref<string[]>([])
  const videoFirstFrame = ref<string | null>(null)
  const videoLastFrame = ref<string | null>(null)
  const videoAudioReferences = ref<string[]>([])
  const videoAudioReferenceNames = ref<string[]>([])
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
  const imageSize = ref<string>('')
  const imageQuality = ref<string>(DEFAULT_IMAGE_QUALITY)

  const imagePrompt = computed({
    get: () => customPrompts.value.image,
    set: (value: string) => {
      customPrompts.value.image = value
    }
  })

  const currentImageModel = computed<ImageModelConfig | null>(() => {
    if (activeTab.value !== 'image' || !models.value) return null
    return models.value.image.find(model => model.model === testSelectedModels.value.image) || null
  })

  const currentImageModelKey = computed(() => {
    const model = currentImageModel.value
    return model ? `${model.provider}:${model.model}` : ''
  })

  const currentImageModelSupportsReference = computed(() => {
    const model = currentImageModel.value
    if (!model) return false
    return model.supportReferenceImage === true
      || model.supportReferenceImages === true
      || model.supportImageToImage === true
      || model.requireReferenceImage === true
  })

  const currentImageModelRequiresReference = computed(() => {
    return currentImageModel.value?.requireReferenceImage === true
  })

  const currentImageModelMaxReferenceImages = computed(() => {
    const raw = currentImageModel.value?.maxReferenceImages
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 4
    return Math.min(12, Math.max(1, Math.floor(raw)))
  })

  const currentVideoModel = computed<VideoModelConfig | null>(() => {
    if (activeTab.value !== 'video' || !models.value) return null
    return models.value.video.find(model => model.model === testSelectedModels.value.video) || null
  })

  const currentVideoModelSupportsImageReference = computed(() => {
    const model = currentVideoModel.value
    if (!model) return false
    return model.supportImageToVideo === true || model.supportReferenceImages === true
  })

  const currentVideoModelSupportsVideoReference = computed(() => {
    return currentVideoModel.value?.supportVideoReference === true
  })

  const currentVideoModelSupportsReference = computed(() => {
    return currentVideoModelSupportsImageReference.value
      || currentVideoModelSupportsVideoReference.value
      || currentVideoModelSupportsAudioReference.value
  })

  const currentVideoModelSupportsFirstLastFrame = computed(() => {
    return currentVideoModel.value?.supportFirstLastFrame === true
  })

  const currentVideoModelSupportsAudioReference = computed(() => {
    return currentVideoModel.value?.supportAudioReference === true
  })

  const currentVideoModelRequiresReference = computed(() => {
    const model = currentVideoModel.value
    if (!model) return false
    const supportsRef = model.supportImageToVideo === true
      || model.supportReferenceImages === true
      || model.supportVideoReference === true
      || model.supportAudioReference === true
    return supportsRef && model.supportTextToVideo !== true
  })

  const currentVideoModelMaxReferenceImages = computed(() => {
    const raw = currentVideoModel.value?.maxReferenceImages
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
    return Math.min(12, Math.max(1, Math.floor(raw)))
  })

  const currentVideoModelMaxReferenceVideos = computed(() => {
    const raw = currentVideoModel.value?.maxReferenceVideos
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
    return Math.min(4, Math.max(1, Math.floor(raw)))
  })

  const currentVideoModelMaxReferenceAudios = computed(() => {
    const raw = currentVideoModel.value?.maxReferenceAudios
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return 1
    return Math.min(8, Math.max(1, Math.floor(raw)))
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
    maxReferences: currentImageModelMaxReferenceImages
  })

  const currentImageModelAspectRatioOptions = computed<string[]>(() => {
    const rawOptions = currentImageModel.value?.supportedAspectRatios || []
    const options = Array.from(new Set(
      rawOptions
        .map(value => value.trim())
        .filter(Boolean)
    ))

    return options
  })

  const currentImageModelSizeSelectionMode = computed(() => {
    const mode = currentImageModel.value?.sizeSelectionMode
    return mode === 'constraint' || mode === 'preset' || mode === 'fixed' ? mode : 'fixed'
  })

  const currentImageModelSizeHelp = computed(() => {
    const constraints = currentImageModel.value?.sizeConstraints
    if (currentImageModelSizeSelectionMode.value !== 'constraint' || !constraints) return ''

    const parts: string[] = []
    if (constraints.maxEdge) parts.push(`最大边 ${constraints.maxEdge}px`)
    if (constraints.edgeMultiple) parts.push(`边长需为 ${constraints.edgeMultiple} 的倍数`)
    if (constraints.maxAspectRatio) parts.push(`长短边不超过 ${constraints.maxAspectRatio}`)
    if (constraints.minPixels && constraints.maxPixels) {
      parts.push(`总像素 ${constraints.minPixels}-${constraints.maxPixels}`)
    }
    return parts.join('，')
  })

  const currentImageModelQualityOptions = computed<string[]>(() => {
    const rawOptions = currentImageModel.value?.supportedQualities || []
    return Array.from(new Set(
      rawOptions
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
    ))
  })

  function parseRatioValue(value: string): number | null {
    const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
    if (!match) return null

    const width = Number(match[1])
    const height = Number(match[2])
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return width / height
  }

  function parseSizeRatioValue(value: string): number | null {
    const match = value.trim().match(/^(\d+)\s*[*xX×]\s*(\d+)$/)
    if (!match) return null

    const width = Number(match[1])
    const height = Number(match[2])
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
    return width / height
  }

  function inferClosestAspectRatio(size: string, ratios: string[]): string | null {
    const sizeRatio = parseSizeRatioValue(size)
    if (!sizeRatio) return null

    let closestRatio = ''
    let closestDelta = Number.POSITIVE_INFINITY
    for (const ratio of ratios) {
      if (ratio === 'auto') continue
      const ratioValue = parseRatioValue(ratio)
      if (!ratioValue) continue

      const delta = Math.abs(sizeRatio - ratioValue) / ratioValue
      if (delta < closestDelta) {
        closestRatio = ratio
        closestDelta = delta
      }
    }

    return closestRatio && closestDelta <= 0.08 ? closestRatio : null
  }

  const currentImageModelSizeOptions = computed<string[]>(() => {
    const rawOptions = currentImageModel.value?.supportedSizes || []
    const options = Array.from(new Set(
      rawOptions
        .map(value => value.trim())
        .filter(Boolean)
    ))

    const selectedRatio = imageAspectRatio.value
    if (!selectedRatio || selectedRatio === 'auto') return options

    const matchingOptions = options.filter((option) => {
      return inferClosestAspectRatio(option, currentImageModelAspectRatioOptions.value) === selectedRatio
    })

    return matchingOptions.length > 0 ? matchingOptions : options
  })

  const canRunImageTest = computed(() => {
    if (activeTab.value !== 'image') return true
    if (!currentImageModelRequiresReference.value) return true
    return referenceImages.value.length > 0
  })

  const canRunVideoTest = computed(() => {
    if (activeTab.value !== 'video') return true
    if (!currentVideoModelRequiresReference.value) return true
    const hasImageReference = currentVideoModelSupportsFirstLastFrame.value
      ? !!videoFirstFrame.value
      : videoReferenceImages.value.length > 0
    const hasVideoReference = currentVideoModelSupportsVideoReference.value
      && videoReferenceVideos.value.length > 0
    const hasAudioReference = currentVideoModelSupportsAudioReference.value
      && videoAudioReferences.value.length > 0
    return hasImageReference || hasVideoReference || hasAudioReference
  })

  function handleVideoReferenceImageUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    const remainingSlots = currentVideoModelMaxReferenceImages.value - videoReferenceImages.value.length
    for (const file of Array.from(files).slice(0, Math.max(0, remainingSlots))) {
      if (!file.type.startsWith('image/')) continue

      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const base64 = loadEvent.target?.result as string
        if (!base64 || videoReferenceImages.value.length >= currentVideoModelMaxReferenceImages.value) return
        videoReferenceImages.value.push(base64)
      }
      reader.readAsDataURL(file)
    }

    input.value = ''
  }

  function removeVideoReferenceImage(index: number) {
    videoReferenceImages.value.splice(index, 1)
  }

  function handleVideoReferenceVideoUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    const remainingSlots = currentVideoModelMaxReferenceVideos.value - videoReferenceVideos.value.length
    for (const file of Array.from(files).slice(0, Math.max(0, remainingSlots))) {
      if (!file.type.startsWith('video/')) continue

      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const base64 = loadEvent.target?.result as string
        if (!base64 || videoReferenceVideos.value.length >= currentVideoModelMaxReferenceVideos.value) return
        videoReferenceVideos.value.push(base64)
        videoReferenceVideoNames.value.push(file.name || `参考视频 ${videoReferenceVideos.value.length}`)
      }
      reader.readAsDataURL(file)
    }

    input.value = ''
  }

  function removeVideoReferenceVideo(index: number) {
    videoReferenceVideos.value.splice(index, 1)
    videoReferenceVideoNames.value.splice(index, 1)
  }

  function handleVideoFirstFrameUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || !file.type.startsWith('image/')) {
      input.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const base64 = loadEvent.target?.result as string
      if (!base64) return
      videoFirstFrame.value = base64
    }
    reader.readAsDataURL(file)

    input.value = ''
  }

  function handleVideoLastFrameUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || !file.type.startsWith('image/')) {
      input.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = (loadEvent) => {
      const base64 = loadEvent.target?.result as string
      if (!base64) return
      videoLastFrame.value = base64
    }
    reader.readAsDataURL(file)

    input.value = ''
  }

  function clearVideoFirstFrame() {
    videoFirstFrame.value = null
  }

  function clearVideoLastFrame() {
    videoLastFrame.value = null
  }

  function handleVideoAudioReferenceUpload(event: Event) {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    const remainingSlots = currentVideoModelMaxReferenceAudios.value - videoAudioReferences.value.length
    for (const file of Array.from(files).slice(0, Math.max(0, remainingSlots))) {
      if (!file.type.startsWith('audio/')) continue

      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const base64 = loadEvent.target?.result as string
        if (!base64 || videoAudioReferences.value.length >= currentVideoModelMaxReferenceAudios.value) return
        videoAudioReferences.value.push(base64)
        videoAudioReferenceNames.value.push(file.name || `参考音频 ${videoAudioReferences.value.length}`)
      }
      reader.readAsDataURL(file)
    }

    input.value = ''
  }

  function removeVideoAudioReference(index: number) {
    videoAudioReferences.value.splice(index, 1)
    videoAudioReferenceNames.value.splice(index, 1)
  }

  function clearVideoAudioReference() {
    videoAudioReferences.value = []
    videoAudioReferenceNames.value = []
  }

  function normalizeModelTestTab(value: unknown): ModelTestTab {
    if (value === 'image' || value === 'video' || value === 'tts' || value === 'text') {
      return value
    }
    return 'text'
  }

  function restoreActiveTabFromStorage() {
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem(MODEL_TEST_TAB_STORAGE_KEY)
      activeTab.value = normalizeModelTestTab(raw)
    } catch {
      activeTab.value = 'text'
    }
  }

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
    if (type === 'video') {
      videoReferenceImages.value = []
      videoReferenceVideos.value = []
      videoReferenceVideoNames.value = []
      clearVideoFirstFrame()
      clearVideoLastFrame()
      clearVideoAudioReference()
    }

    closeImageMention()
  }

  function syncImageGenerationOptions(force = false) {
    const ratioOptions = currentImageModelAspectRatioOptions.value
    if (ratioOptions.length === 0) {
      imageAspectRatio.value = ''
    } else if (force || !ratioOptions.includes(imageAspectRatio.value)) {
      imageAspectRatio.value = ratioOptions[0] || DEFAULT_IMAGE_ASPECT_RATIO
    }

    const sizeOptions = currentImageModelSizeOptions.value
    if (sizeOptions.length === 0) {
      imageSize.value = ''
    } else if (force || !sizeOptions.includes(imageSize.value)) {
      imageSize.value = sizeOptions[0] || ''
    }

    const qualityOptions = currentImageModelQualityOptions.value
    if (qualityOptions.length === 0) {
      imageQuality.value = DEFAULT_IMAGE_QUALITY
    } else if (force || !qualityOptions.includes(imageQuality.value)) {
      imageQuality.value = qualityOptions[0] || DEFAULT_IMAGE_QUALITY
    }
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

    const rawPrompt = customPrompts.value[modelType] || SETTINGS_MODEL_TEST_PLACEHOLDERS[modelType]
    const modelId = testSelectedModels.value[modelType] || ''
    const selectedModel = getCurrentModelList().find(model => model.model === modelId)

    try {
      const body: Record<string, unknown> = {
        modelType,
        prompt: modelType === 'image'
          ? resolveImagePromptWithReferenceTokens(rawPrompt, SETTINGS_MODEL_TEST_PLACEHOLDERS.image)
          : rawPrompt
      }

      if (modelId) {
        body.modelId = modelId
      }
      if (selectedModel?.provider) {
        body.provider = selectedModel.provider
      }

      if (
        modelType === 'image'
        && currentImageModelSupportsReference.value
        && referenceImages.value.length > 0
      ) {
        body.referenceImages = referenceImages.value.slice(0, currentImageModelMaxReferenceImages.value)
      }
      if (
        modelType === 'video'
        && currentVideoModelSupportsFirstLastFrame.value
      ) {
        if (videoFirstFrame.value) {
          body.firstFrame = videoFirstFrame.value
          body.imageUrl = videoFirstFrame.value
        }
        if (videoLastFrame.value) {
          body.lastFrame = videoLastFrame.value
        }
      } else if (
        modelType === 'video'
        && currentVideoModelSupportsImageReference.value
        && videoReferenceImages.value.length > 0
      ) {
        const refs = videoReferenceImages.value.slice(0, currentVideoModelMaxReferenceImages.value)
        body.referenceImages = refs
        if (refs.length > 0) {
          body.imageUrl = refs[0]
        }
      }
      if (
        modelType === 'video'
        && currentVideoModelSupportsVideoReference.value
        && videoReferenceVideos.value.length > 0
      ) {
        const refs = videoReferenceVideos.value.slice(0, currentVideoModelMaxReferenceVideos.value)
        body.referenceVideos = refs
        body.videoReferences = refs
        if (refs.length > 0) {
          body.videoUrl = refs[0]
          body.firstClip = refs[0]
        }
      }
      if (
        modelType === 'video'
        && currentVideoModelSupportsAudioReference.value
        && videoAudioReferences.value.length > 0
      ) {
        const refs = videoAudioReferences.value.slice(0, currentVideoModelMaxReferenceAudios.value)
        body.audioReferences = refs
        body.referenceAudios = refs
        if (refs.length > 0) {
          body.audioUrl = refs[0]
        }
      }

      if (modelType === 'image') {
        if (currentImageModelAspectRatioOptions.value.length > 0) {
          body.imageAspectRatio = imageAspectRatio.value
        }
        if (currentImageModelSizeOptions.value.length > 0) {
          body.imageSize = imageSize.value
        }
        if (currentImageModelQualityOptions.value.length > 0) {
          body.imageQuality = imageQuality.value
        }
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

  watch(activeTab, (nextTab) => {
    autoExpandSelectedProviders()

    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(MODEL_TEST_TAB_STORAGE_KEY, nextTab)
    } catch {
      // ignore localStorage write failures
    }
  })

  watch(currentImageModelAspectRatioOptions, (options) => {
    if (options.includes(imageAspectRatio.value)) return
    syncImageGenerationOptions()
  }, { immediate: true })

  watch(currentImageModelSizeOptions, () => {
    syncImageGenerationOptions()
  }, { immediate: true })

  watch(currentImageModelQualityOptions, (options) => {
    if (options.length > 0 && options.includes(imageQuality.value)) return
    syncImageGenerationOptions()
  }, { immediate: true })

  watch(currentImageModelKey, () => {
    syncImageGenerationOptions(true)
  }, { immediate: true })

  watch(currentImageModelMaxReferenceImages, (maxCount) => {
    if (referenceImages.value.length <= maxCount) return
    referenceImages.value = referenceImages.value.slice(0, maxCount)
  }, { immediate: true })

  watch(currentVideoModelMaxReferenceImages, (maxCount) => {
    if (videoReferenceImages.value.length <= maxCount) return
    videoReferenceImages.value = videoReferenceImages.value.slice(0, maxCount)
  }, { immediate: true })

  watch(currentVideoModelMaxReferenceVideos, (maxCount) => {
    if (videoReferenceVideos.value.length <= maxCount) return
    videoReferenceVideos.value = videoReferenceVideos.value.slice(0, maxCount)
    videoReferenceVideoNames.value = videoReferenceVideoNames.value.slice(0, maxCount)
  }, { immediate: true })

  watch(currentVideoModelMaxReferenceAudios, (maxCount) => {
    if (videoAudioReferences.value.length <= maxCount) return
    videoAudioReferences.value = videoAudioReferences.value.slice(0, maxCount)
    videoAudioReferenceNames.value = videoAudioReferenceNames.value.slice(0, maxCount)
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
    restoreActiveTabFromStorage()
    void loadModels()
  })

  return {
    loading,
    models,
    activeTab,
    customPrompts,
    referenceImages,
    videoReferenceImages,
    videoReferenceVideos,
    videoReferenceVideoNames,
    videoFirstFrame,
    videoLastFrame,
    videoAudioReferences,
    videoAudioReferenceNames,
    testResults,
    groupedModels,
    currentSelectedModel,
    currentTtsAudioUrl,
    currentImageModelSupportsReference,
    currentImageModelRequiresReference,
    currentImageModelMaxReferenceImages,
    currentVideoModelSupportsImageReference,
    currentVideoModelSupportsReference,
    currentVideoModelSupportsVideoReference,
    currentVideoModelSupportsFirstLastFrame,
    currentVideoModelSupportsAudioReference,
    currentVideoModelRequiresReference,
    currentVideoModelMaxReferenceImages,
    currentVideoModelMaxReferenceVideos,
    currentVideoModelMaxReferenceAudios,
    currentImageModelAspectRatioOptions,
    currentImageModelSizeOptions,
    currentImageModelSizeSelectionMode,
    currentImageModelSizeHelp,
    currentImageModelQualityOptions,
    imageAspectRatio,
    imageSize,
    imageQuality,
    canRunImageTest,
    canRunVideoTest,
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
    handleVideoReferenceImageUpload,
    removeVideoReferenceImage,
    handleVideoReferenceVideoUpload,
    removeVideoReferenceVideo,
    handleVideoFirstFrameUpload,
    handleVideoLastFrameUpload,
    clearVideoFirstFrame,
    clearVideoLastFrame,
    handleVideoAudioReferenceUpload,
    removeVideoAudioReference,
    clearVideoAudioReference,
    triggerFileInput,
    openReferenceImagePreview,
    selectTestModel,
    toggleProvider,
    testModel
  }
}
