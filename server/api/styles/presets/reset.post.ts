import { resetStylePresetData } from '../../../utils/style-config'

/**
 * 重置画风预设到内置默认值
 * POST /api/styles/presets/reset
 */
export default defineEventHandler(async () => {
  try {
    const runtime = await resetStylePresetData()

    return {
      success: true,
      data: {
        allPresets: runtime.allPresets,
        enabledStyleIds: runtime.config.enabledStyleIds,
        defaultStyleId: runtime.config.defaultStyleId,
        enabledPresets: runtime.presets,
        enabledCategories: runtime.categories
      }
    }
  } catch (error) {
    console.error('[StylePreset] 重置失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
