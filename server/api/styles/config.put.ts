import { z } from 'zod'
import {
  getAllStylePresets,
  getStylePresetRuntimeData,
  saveStylePresetConfig
} from '../../utils/style-config'

const UpdateStylePresetConfigSchema = z.object({
  enabledStyleIds: z.array(z.string()).min(1, '至少保留一个画风预设'),
  defaultStyleId: z.string().optional().nullable()
})

/**
 * 更新画风预设后台配置
 * PUT /api/styles/config
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = UpdateStylePresetConfigSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const allPresets = await getAllStylePresets()
  const allowedStyleIds = new Set(allPresets.map(style => style.id))
  const invalidIds = parsed.data.enabledStyleIds.filter(id => !allowedStyleIds.has(id))

  if (invalidIds.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: '画风ID无效',
      message: `存在无效画风ID: ${invalidIds.join(', ')}`
    })
  }

  if (parsed.data.defaultStyleId && !allowedStyleIds.has(parsed.data.defaultStyleId)) {
    throw createError({
      statusCode: 400,
      statusMessage: '默认画风无效',
      message: `无效默认画风ID: ${parsed.data.defaultStyleId}`
    })
  }

  try {
    await saveStylePresetConfig({
      enabledStyleIds: parsed.data.enabledStyleIds,
      defaultStyleId: parsed.data.defaultStyleId || undefined
    }, allPresets)

    const runtime = await getStylePresetRuntimeData()

    return {
      success: true,
      data: {
        enabledStyleIds: runtime.config.enabledStyleIds,
        defaultStyleId: runtime.config.defaultStyleId,
        enabledPresets: runtime.presets,
        enabledCategories: runtime.categories
      }
    }
  } catch (error) {
    console.error('[StyleConfig] 更新配置失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '更新画风配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
