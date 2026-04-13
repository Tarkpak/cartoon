import { z } from 'zod'
import { importStylePresetData } from '../../../utils/style-config'

const ImportStylePresetSchema = z.object({
  payload: z.unknown().optional()
})

/**
 * 导入画风预设配置
 * POST /api/styles/presets/import
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = ImportStylePresetSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const source = parsed.data.payload ?? body

  try {
    const runtime = await importStylePresetData(source)

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
    console.error('[StylePreset] 导入失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '导入画风预设失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
