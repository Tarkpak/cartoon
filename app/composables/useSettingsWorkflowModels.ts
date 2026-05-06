import type { Component } from 'vue'
import {
  Cpu,
  Image,
  Video
} from 'lucide-vue-next'
import type {
  WorkflowStep,
  WorkflowStepConfig,
  WorkflowModelOptions,
  WorkflowGeminiImageSize,
  WorkflowOpenAIImageQuality,
  WorkflowImageGenerationModelOptions,
  WorkflowVideoGenerationModelOptions,
  WorkflowCompletionNotificationOptions,
  KlingV3OmniVideoOptions,
  SeedanceVideoOptions,
  SeedanceVideoQuality,
  WorkflowVideoAudioDefaults
} from '#shared/types/workflow-models'
import {
  getSettingsProviderLabel,
  toSelectString
} from '@/lib/settings-models'

export interface CompatibleModel {
  model: string
  displayName: string
  provider: string
  description?: string
  capabilities: string[]
}

export interface WorkflowConfig extends WorkflowStepConfig {
  compatibleModels: CompatibleModel[]
  selectedModel: string | null
  isOverridden?: boolean
  modelOptions?: WorkflowVideoGenerationModelOptions
}

export interface WorkflowData {
  workflows: WorkflowConfig[]
  currentSelections: Record<WorkflowStep, string>
  modelOptions?: WorkflowModelOptions
}

export type WorkflowCategoryKey = 'text' | 'image' | 'video'

export interface WorkflowCategoryMeta {
  name: string
  icon: Component
  color: string
  description: string
}

export interface WorkflowCategorySummary extends WorkflowCategoryMeta {
  key: WorkflowCategoryKey
  workflowCount: number
}

export const WORKFLOW_CATEGORY_CONFIG: Record<WorkflowCategoryKey, WorkflowCategoryMeta> = {
  text: {
    name: '文本生成',
    icon: Cpu,
    color: 'blue',
    description: '覆盖剧本解析、场景描述改写和提示词翻译。'
  },
  image: {
    name: '图片生成',
    icon: Image,
    color: 'green',
    description: '覆盖角色资产生成与环境参考图生成。'
  },
  video: {
    name: '视频生成',
    icon: Video,
    color: 'purple',
    description: '覆盖单个分镜片段生成及对应扩展参数。'
  }
}

export const WORKFLOW_GEMINI_IMAGE_SIZES: WorkflowGeminiImageSize[] = ['512', '1K', '2K', '4K']
export const WORKFLOW_OPENAI_IMAGE_QUALITIES: WorkflowOpenAIImageQuality[] = ['auto', 'low', 'medium', 'high']
export const WORKFLOW_SEEDANCE_VIDEO_QUALITIES: SeedanceVideoQuality[] = ['480p', '720p', '1080p']
const WORKFLOW_CATEGORY_ORDER: WorkflowCategoryKey[] = ['text', 'image', 'video']

const DEFAULT_KLING_V3_OMNI_VIDEO_OPTIONS: KlingV3OmniVideoOptions = {
  sound: 'off',
  mode: 'pro'
}

const DEFAULT_SEEDANCE_VIDEO_OPTIONS: SeedanceVideoOptions = {
  quality: '720p'
}

const DEFAULT_VIDEO_AUDIO_DEFAULTS: WorkflowVideoAudioDefaults = {
  qwen: true,
  kling: true,
  seedance: true
}

const DEFAULT_IMAGE_GENERATION_MODEL_OPTIONS: WorkflowImageGenerationModelOptions = {
  geminiImageSize: '1K',
  openaiImageQuality: 'auto'
}

const DEFAULT_COMPLETION_NOTIFICATION_OPTIONS: WorkflowCompletionNotificationOptions = {
  sound: true,
  systemNotification: true
}

export function useSettingsWorkflowModels() {
  const { models, selectedModels, loadModels } = useSettingsModelCatalog()
  const {
    completionNotificationOptions: completionNotificationOptionsState,
    setCompletionNotificationOptions
  } = useGenerationCompletionNotification()

  const workflowLoading = ref(true)
  const workflowSaving = ref(false)
  const workflowData = ref<WorkflowData | null>(null)
  const activeCategory = ref<WorkflowCategoryKey>('text')

  const filteredWorkflows = computed(() => {
    if (!workflowData.value) return {}

    const groups: Partial<Record<WorkflowCategoryKey, WorkflowConfig[]>> = {}
    for (const workflow of workflowData.value.workflows) {
      if (!groups[workflow.category]) {
        groups[workflow.category] = []
      }
      groups[workflow.category]!.push(workflow)
    }

    return groups
  })

  const workflowCategories = computed<WorkflowCategorySummary[]>(() => {
    return WORKFLOW_CATEGORY_ORDER
      .map(key => ({
        key,
        ...WORKFLOW_CATEGORY_CONFIG[key],
        workflowCount: filteredWorkflows.value[key]?.length || 0
      }))
      .filter(category => category.workflowCount > 0)
  })

  const activeCategoryWorkflows = computed(() => {
    return filteredWorkflows.value[activeCategory.value] || []
  })

  const activeCategoryMeta = computed(() => {
    return WORKFLOW_CATEGORY_CONFIG[activeCategory.value]
  })

  function getCapabilityLabel(capability: string): string {
    const labels: Record<string, string> = {
      reference_image: '支持参考图',
      require_reference_image: '必须参考图',
      first_last_frame: '需首尾帧',
      image_to_video: '需图生视频',
      text_to_video: '需文生视频',
      text_generation: '文本生成'
    }

    return labels[capability] || capability
  }

  function hasCompatibleModels(workflow: WorkflowConfig): boolean {
    return workflow.compatibleModels.length > 0
  }

  function normalizeCompletionNotificationOptions(
    options?: Partial<WorkflowCompletionNotificationOptions> | null
  ): WorkflowCompletionNotificationOptions {
    return {
      sound: typeof options?.sound === 'boolean'
        ? options.sound
        : DEFAULT_COMPLETION_NOTIFICATION_OPTIONS.sound,
      systemNotification: typeof options?.systemNotification === 'boolean'
        ? options.systemNotification
        : DEFAULT_COMPLETION_NOTIFICATION_OPTIONS.systemNotification
    }
  }

  async function loadWorkflowModels() {
    workflowLoading.value = true

    try {
      const response = await $fetch<{ success: boolean, data: WorkflowData }>('/api/models/workflow')
      if (!response.success) {
        throw new Error('流程模型配置接口返回失败')
      }

      const completionNotification = normalizeCompletionNotificationOptions(
        response.data.modelOptions?.completion_notification
      )

      workflowData.value = {
        ...response.data,
        modelOptions: {
          image_options: response.data.modelOptions?.image_options || {
            ...DEFAULT_IMAGE_GENERATION_MODEL_OPTIONS
          },
          video_generation: response.data.modelOptions?.video_generation || {
            klingV3Omni: { ...DEFAULT_KLING_V3_OMNI_VIDEO_OPTIONS },
            seedance: { ...DEFAULT_SEEDANCE_VIDEO_OPTIONS },
            audioDefaults: { ...DEFAULT_VIDEO_AUDIO_DEFAULTS }
          },
          completion_notification: completionNotification
        }
      }

      setCompletionNotificationOptions(completionNotification)
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 加载流程模型配置失败:', error)
    } finally {
      workflowLoading.value = false
    }
  }

  async function reloadModelSettings() {
    await loadModels(true)
    await loadWorkflowModels()
  }

  function getVideoGenerationModelOptions(): WorkflowVideoGenerationModelOptions {
    return workflowData.value?.modelOptions?.video_generation || {
      klingV3Omni: { ...DEFAULT_KLING_V3_OMNI_VIDEO_OPTIONS },
      seedance: { ...DEFAULT_SEEDANCE_VIDEO_OPTIONS },
      audioDefaults: { ...DEFAULT_VIDEO_AUDIO_DEFAULTS }
    }
  }

  function getImageGenerationModelOptions(): WorkflowImageGenerationModelOptions {
    return workflowData.value?.modelOptions?.image_options || {
      ...DEFAULT_IMAGE_GENERATION_MODEL_OPTIONS
    }
  }

  function getCompletionNotificationOptions(): WorkflowCompletionNotificationOptions {
    return normalizeCompletionNotificationOptions(
      workflowData.value?.modelOptions?.completion_notification
      || completionNotificationOptionsState.value
    )
  }

  function syncWorkflowCompletionNotificationOptions(
    next: WorkflowCompletionNotificationOptions
  ) {
    if (!workflowData.value) return

    workflowData.value = {
      ...workflowData.value,
      modelOptions: {
        image_options: getImageGenerationModelOptions(),
        video_generation: getVideoGenerationModelOptions(),
        completion_notification: next
      }
    }
  }

  const klingV3OmniOptions = computed<KlingV3OmniVideoOptions>(() => {
    return getVideoGenerationModelOptions().klingV3Omni
  })

  const seedanceVideoOptions = computed<SeedanceVideoOptions>(() => {
    return getVideoGenerationModelOptions().seedance
  })

  const videoAudioDefaults = computed<WorkflowVideoAudioDefaults>(() => {
    return getVideoGenerationModelOptions().audioDefaults
  })

  const imageGenerationOptions = computed<WorkflowImageGenerationModelOptions>(() => {
    return getImageGenerationModelOptions()
  })

  const completionNotificationOptions = computed<WorkflowCompletionNotificationOptions>(() => {
    return getCompletionNotificationOptions()
  })

  async function updateWorkflowModel(step: WorkflowStep, modelId: string) {
    if (!workflowData.value) return

    workflowSaving.value = true

    try {
      const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
        method: 'POST',
        body: { step, modelId }
      })

      if (response.success) {
        await loadWorkflowModels()
      }
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新模型选择失败:', error)
    } finally {
      workflowSaving.value = false
    }
  }

  async function updateVideoGenerationModelOptions(patch: Partial<KlingV3OmniVideoOptions>) {
    if (!workflowData.value) return

    const current = getVideoGenerationModelOptions()
    const next: WorkflowVideoGenerationModelOptions = {
      klingV3Omni: {
        ...current.klingV3Omni,
        ...patch
      },
      seedance: {
        ...current.seedance
      },
      audioDefaults: {
        ...current.audioDefaults
      }
    }

    workflowSaving.value = true

    try {
      const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
        method: 'POST',
        body: {
          step: 'video_generation',
          modelOptions: next
        }
      })

      if (response.success) {
        await loadWorkflowModels()
      }
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新视频模型扩展配置失败:', error)
    } finally {
      workflowSaving.value = false
    }
  }

  async function updateSeedanceVideoGenerationModelOptions(patch: Partial<SeedanceVideoOptions>) {
    if (!workflowData.value) return

    const current = getVideoGenerationModelOptions()
    const next: WorkflowVideoGenerationModelOptions = {
      klingV3Omni: {
        ...current.klingV3Omni
      },
      seedance: {
        ...current.seedance,
        ...patch
      },
      audioDefaults: {
        ...current.audioDefaults
      }
    }

    workflowSaving.value = true

    try {
      const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
        method: 'POST',
        body: {
          step: 'video_generation',
          modelOptions: next
        }
      })

      if (response.success) {
        await loadWorkflowModels()
      }
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新 Seedance 视频配置失败:', error)
    } finally {
      workflowSaving.value = false
    }
  }

  async function updateImageGenerationModelOptions(
    patch: Partial<WorkflowImageGenerationModelOptions>
  ) {
    if (!workflowData.value) return

    const current = getImageGenerationModelOptions()
    const next: WorkflowImageGenerationModelOptions = {
      ...current,
      ...patch
    }

    workflowSaving.value = true

    try {
      const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
        method: 'POST',
        body: {
          step: 'image_options',
          modelOptions: next
        }
      })

      if (response.success) {
        await loadWorkflowModels()
      }
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新图片流程模型扩展配置失败:', error)
    } finally {
      workflowSaving.value = false
    }
  }

  async function updateCompletionNotificationOptions(
    patch: Partial<WorkflowCompletionNotificationOptions>
  ) {
    const previous = getCompletionNotificationOptions()
    const next = normalizeCompletionNotificationOptions({
      ...previous,
      ...patch
    })

    workflowSaving.value = true
    setCompletionNotificationOptions(next)
    syncWorkflowCompletionNotificationOptions(next)

    try {
      const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
        method: 'POST',
        body: {
          step: 'completion_notification',
          modelOptions: next
        }
      })

      if (!response.success) {
        throw new Error('生成完成提醒配置保存失败')
      }

      await loadWorkflowModels()
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新生成完成提醒配置失败:', error)
      setCompletionNotificationOptions(previous)
      syncWorkflowCompletionNotificationOptions(previous)
    } finally {
      workflowSaving.value = false
    }
  }

  function updateWorkflowGeminiImageSize(value: unknown) {
    const normalized = toSelectString(value).toUpperCase()
    if (!WORKFLOW_GEMINI_IMAGE_SIZES.includes(normalized as WorkflowGeminiImageSize)) return

    void updateImageGenerationModelOptions({
      geminiImageSize: normalized as WorkflowGeminiImageSize
    })
  }

  function updateWorkflowOpenaiImageQuality(value: unknown) {
    const normalized = toSelectString(value).toLowerCase()
    if (!WORKFLOW_OPENAI_IMAGE_QUALITIES.includes(normalized as WorkflowOpenAIImageQuality)) return

    void updateImageGenerationModelOptions({
      openaiImageQuality: normalized as WorkflowOpenAIImageQuality
    })
  }

  function updateWorkflowSeedanceVideoQuality(value: unknown) {
    const normalized = toSelectString(value).toLowerCase()
    if (!WORKFLOW_SEEDANCE_VIDEO_QUALITIES.includes(normalized as SeedanceVideoQuality)) return

    void updateSeedanceVideoGenerationModelOptions({
      quality: normalized as SeedanceVideoQuality
    })
  }

  async function updateVideoAudioDefaults(patch: Partial<WorkflowVideoAudioDefaults>) {
    if (!workflowData.value) return

    const current = getVideoGenerationModelOptions()
    const next: WorkflowVideoGenerationModelOptions = {
      klingV3Omni: {
        ...current.klingV3Omni
      },
      seedance: {
        ...current.seedance
      },
      audioDefaults: {
        ...current.audioDefaults,
        ...patch
      }
    }

    workflowSaving.value = true

    try {
      const response = await $fetch<{ success: boolean }>('/api/models/workflow', {
        method: 'POST',
        body: {
          step: 'video_generation',
          modelOptions: next
        }
      })

      if (response.success) {
        await loadWorkflowModels()
      }
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新视频默认音频配置失败:', error)
    } finally {
      workflowSaving.value = false
    }
  }

  async function updateGlobalWorkflowDefault(
    type: 'text' | 'image' | 'video' | 'tts',
    modelId: string
  ) {
    if (selectedModels.value[type] === modelId) return

    try {
      await $fetch('/api/models/switch', {
        method: 'POST',
        body: { type, modelId }
      })

      selectedModels.value[type] = modelId
      await loadWorkflowModels()
    } catch (error) {
      console.error('[useSettingsWorkflowModels] 更新全局默认模型失败:', error)
    }
  }

  function selectWorkflowCategory(category: WorkflowCategoryKey) {
    activeCategory.value = category
  }

  onMounted(() => {
    void loadModels()
    void loadWorkflowModels()
  })

  onActivated(() => {
    void reloadModelSettings()
  })

  watch(workflowCategories, (categories) => {
    if (categories.length === 0) return
    if (!categories.some(category => category.key === activeCategory.value)) {
      activeCategory.value = categories[0]!.key
    }
  }, { immediate: true })

  return {
    models,
    selectedModels,
    workflowLoading,
    workflowSaving,
    filteredWorkflows,
    workflowCategories,
    activeCategory,
    activeCategoryMeta,
    activeCategoryWorkflows,
    klingV3OmniOptions,
    seedanceVideoOptions,
    videoAudioDefaults,
    imageGenerationOptions,
    completionNotificationOptions,
    getCapabilityLabel,
    getProviderLabel: getSettingsProviderLabel,
    hasCompatibleModels,
    selectWorkflowCategory,
    reloadModelSettings,
    updateWorkflowModel,
    updateVideoGenerationModelOptions,
    updateWorkflowGeminiImageSize,
    updateWorkflowOpenaiImageQuality,
    updateWorkflowSeedanceVideoQuality,
    updateVideoAudioDefaults,
    updateCompletionNotificationOptions,
    updateGlobalWorkflowDefault,
    toSelectString
  }
}
