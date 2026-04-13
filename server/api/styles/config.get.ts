import {
  STYLE_CATEGORIES
} from '#shared/types/styles'
import { getStylePresetRuntimeData } from '../../utils/style-config'

/**
 * 获取画风预设后台配置（包含全量预设）
 * GET /api/styles/config
 */
export default defineEventHandler(async () => {
  try {
    const runtime = await getStylePresetRuntimeData()

    return {
      success: true,
      data: {
        allPresets: runtime.allPresets,
        allCategories: STYLE_CATEGORIES,
        enabledStyleIds: runtime.config.enabledStyleIds,
        defaultStyleId: runtime.config.defaultStyleId,
        enabledPresets: runtime.presets,
        enabledCategories: runtime.categories
      }
    }
  } catch (error) {
    console.error('[StyleConfig] 获取后台配置失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取画风配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
