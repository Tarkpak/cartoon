import {
  getStyleById as getStaticStyleById,
  normalizeStylePresets,
  STYLE_CATEGORIES,
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
    const remote = styleMap.value.get(styleId)
    if (remote) return remote

    const local = getStaticStyleById(styleId)
    if (!local) return undefined
    return local
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

      presets.value = normalizeStylePresets(response.data.presets || []).map((style) => {
        const currentCatalogStyle = getStaticStyleById(style.id)
        if (!currentCatalogStyle) return style
        return {
          ...style,
          category: currentCatalogStyle.category,
          categories: currentCatalogStyle.categories
        }
      })
      const availableCategoryIds = new Set(
        presets.value.flatMap(style => style.categories || [style.category])
      )
      categories.value = STYLE_CATEGORIES.filter(category => availableCategoryIds.has(category.id))
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
