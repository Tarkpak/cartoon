import { onMounted, ref } from 'vue'

// Capabilities of the currently selected video/image models that change what
// the workbench offers (explicit audio/video references, panorama source ratio).

const DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO = '2:1'

const PANORAMA_SOURCE_ASPECT_RATIO_BY_MODE: Record<string, string> = {
  equirectangular_360: '2:1',
  equirectangular_180: '1:1',
  cubemap_3x2: '3:2',
  cubemap_6x1: '6:1'
}

export function normalizeAspectRatioValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ratioMatch = value.trim().match(/^(\d+)\s*:\s*(\d+)$/)
  if (!ratioMatch?.[1] || !ratioMatch[2]) return null

  const width = Number(ratioMatch[1])
  const height = Number(ratioMatch[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return `${width}:${height}`
}

export function resolvePanoramaSourceAspectRatio(options?: {
  panoramaSourceMode?: string | null
  panoramaCustomAspectRatio?: string | null
}): string {
  const mode = typeof options?.panoramaSourceMode === 'string'
    ? options.panoramaSourceMode
    : ''

  if (mode === 'custom') {
    return normalizeAspectRatioValue(options?.panoramaCustomAspectRatio)
      || DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO
  }

  return PANORAMA_SOURCE_ASPECT_RATIO_BY_MODE[mode]
    || DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO
}

export function useAssetWorkbenchModelCapabilities() {
  const supportsExplicitVoiceAudioReference = ref(false)

  const supportsVideoReference = ref<boolean | null>(null)

  const environmentPanoramaSourceAspectRatio = ref(DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO)

  async function refreshVideoAudioReferenceCapability() {
    try {
      const response = await $fetch<{
        success: boolean
        data?: {
          workflows?: Array<{
            id: string
            selectedModel?: string | null
            compatibleModels?: Array<{
              model: string
              provider: string
              supportAudioReference?: boolean
              supportVideoReference?: boolean
            }>
          }>
          modelOptions?: {
            image_options?: {
              panoramaSourceMode?: string | null
              panoramaCustomAspectRatio?: string | null
            }
          }
        }
      }>('/api/models/workflow')

      const workflows = response.data?.workflows || []
      const videoWorkflow = workflows.find(item => item.id === 'video_generation')
      const selectedModel = videoWorkflow?.selectedModel || ''
      const selectedModelConfig = videoWorkflow?.compatibleModels?.find(item => item.model === selectedModel)
      supportsExplicitVoiceAudioReference.value = selectedModelConfig?.supportAudioReference === true
      supportsVideoReference.value = selectedModelConfig ? selectedModelConfig.supportVideoReference === true : null
      environmentPanoramaSourceAspectRatio.value = resolvePanoramaSourceAspectRatio(
        response.data?.modelOptions?.image_options
      )
    } catch (error) {
      console.warn('[asset-workbench] 读取视频模型能力失败，默认关闭显式音频引用标记:', error)
      supportsExplicitVoiceAudioReference.value = false
      supportsVideoReference.value = null
      environmentPanoramaSourceAspectRatio.value = DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO
    }
  }

  onMounted(() => {
    void refreshVideoAudioReferenceCapability()
  })

  return {
    supportsExplicitVoiceAudioReference,
    supportsVideoReference,
    environmentPanoramaSourceAspectRatio,
    refreshVideoAudioReferenceCapability
  }
}
