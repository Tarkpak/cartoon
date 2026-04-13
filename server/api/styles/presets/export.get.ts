import { exportStylePresetData } from '../../../utils/style-config'

/**
 * 导出画风预设配置
 * GET /api/styles/presets/export
 */
export default defineEventHandler(async () => {
  try {
    const payload = await exportStylePresetData()

    return {
      success: true,
      data: payload
    }
  } catch (error) {
    console.error('[StylePreset] 导出失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '导出画风预设失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
