import { getStylePresetRuntimeData } from '../../utils/style-config'

/**
 * 获取当前启用的画风预设
 * GET /api/styles
 */
export default defineEventHandler(async () => {
  try {
    const runtime = await getStylePresetRuntimeData()

    return {
      success: true,
      data: {
        presets: runtime.presets,
        categories: runtime.categories,
        defaultStyleId: runtime.config.defaultStyleId,
        enabledStyleIds: runtime.config.enabledStyleIds
      }
    }
  } catch (error) {
    console.error('[StyleConfig] 获取启用画风失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取画风配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
