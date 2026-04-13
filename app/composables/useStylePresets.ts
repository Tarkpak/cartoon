import {
  getStyleById as getStaticStyleById,
  type StyleCategoryInfo,
  type StylePreset
} from '#shared/types/styles'

interface StylePresetResponse {
  success: boolean
  data?: {
    presets: StylePreset[]
    categories: StyleCategoryInfo[]
    defaultStyleId: string
    enabledStyleIds: string[]
  }
}

export function useStylePresets() {
  const presets = useState<StylePreset[]>('style-presets:items', () => [])
  const categories = useState<StyleCategoryInfo[]>('style-presets:categories', () => [])
  const enabledStyleIds = useState<string[]>('style-presets:enabled', () => [])
  const defaultStyleId = useState<string>('style-presets:default', () => '')
  const loading = useState<boolean>('style-presets:loading', () => false)
  const loaded = useState<boolean>('style-presets:loaded', () => false)
  const error = useState<string | null>('style-presets:error', () => null)

  const styleMap = computed(() => {
    return new Map(presets.value.map(style => [style.id, style]))
  })

  function resolveStyleById(styleId: string): StylePreset | undefined {
    return styleMap.value.get(styleId) || getStaticStyleById(styleId)
  }

  async function loadStylePresets(force = false): Promise<void> {
    if (!force && loaded.value) return
    if (loading.value) return

    loading.value = true
    error.value = null

    try {
      const response = await $fetch<StylePresetResponse>('/api/styles')
      if (!response.success || !response.data) {
        throw new Error('画风配置返回数据无效')
      }

      presets.value = response.data.presets || []
      categories.value = response.data.categories || []
      enabledStyleIds.value = response.data.enabledStyleIds || []
      defaultStyleId.value = response.data.defaultStyleId || ''
      loaded.value = true
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载画风配置失败'
      error.value = message
      console.error('[useStylePresets] 加载失败:', err)
    } finally {
      loading.value = false
    }
  }

  return {
    presets,
    categories,
    enabledStyleIds,
    defaultStyleId,
    loading,
    loaded,
    error,
    styleMap,
    resolveStyleById,
    loadStylePresets
  }
}
