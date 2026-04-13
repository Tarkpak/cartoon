import {
  getAllStylePresets,
  getStylePresetConfig,
  getStylePresetRuntimeData,
  saveStylePresetConfig,
  saveStylePresetList
} from '../../../utils/style-config'

/**
 * 删除画风预设
 * DELETE /api/styles/presets/:id
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少画风ID'
    })
  }

  try {
    const allPresets = await getAllStylePresets()
    const target = allPresets.find(style => style.id === id)

    if (!target) {
      throw createError({
        statusCode: 404,
        statusMessage: '画风预设不存在',
        message: `未找到画风: ${id}`
      })
    }

    if (allPresets.length <= 1) {
      throw createError({
        statusCode: 400,
        statusMessage: '至少保留一个画风',
        message: '不能删除最后一个画风预设'
      })
    }

    const nextAll = allPresets.filter(style => style.id !== id)
    const oldConfig = await getStylePresetConfig(allPresets)

    const savedAll = await saveStylePresetList(nextAll)
    await saveStylePresetConfig(oldConfig, savedAll)

    const runtime = await getStylePresetRuntimeData()

    return {
      success: true,
      data: {
        removedId: id,
        allPresets: runtime.allPresets,
        enabledStyleIds: runtime.config.enabledStyleIds,
        defaultStyleId: runtime.config.defaultStyleId,
        enabledPresets: runtime.presets,
        enabledCategories: runtime.categories
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[StylePreset] 删除失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '删除画风预设失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
