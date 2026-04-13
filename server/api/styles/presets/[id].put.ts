import { z } from 'zod'
import { STYLE_CATEGORIES, type StylePreset } from '#shared/types/styles'
import {
  getAllStylePresets,
  getStylePresetConfig,
  getStylePresetRuntimeData,
  saveStylePresetConfig,
  saveStylePresetList
} from '../../../utils/style-config'

const styleCategoryIds = STYLE_CATEGORIES.map(category => category.id) as [string, ...string[]]

const UpdateStylePresetSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  nameEn: z.string().trim().max(64).optional().nullable(),
  category: z.enum(styleCategoryIds).optional(),
  description: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(500).optional(),
  negativePrompt: z.string().trim().max(500).optional().nullable(),
  thumbnail: z.string().trim().max(500).optional().nullable(),
  isNew: z.boolean().optional(),
  isPro: z.boolean().optional(),
  enabled: z.boolean().optional(),
  setAsDefault: z.boolean().optional()
})

/**
 * 更新画风预设
 * PUT /api/styles/presets/:id
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少画风ID'
    })
  }

  const body = await readBody(event)
  const parsed = UpdateStylePresetSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const allPresets = await getAllStylePresets()
    const targetIndex = allPresets.findIndex(style => style.id === id)

    if (targetIndex < 0) {
      throw createError({
        statusCode: 404,
        statusMessage: '画风预设不存在',
        message: `未找到画风: ${id}`
      })
    }

    const target = allPresets[targetIndex]!
    const nextPreset: StylePreset = {
      ...target,
      name: parsed.data.name?.trim() || target.name,
      nameEn: parsed.data.nameEn?.trim() || parsed.data.name?.trim() || target.nameEn || target.name,
      category: (parsed.data.category || target.category) as StylePreset['category'],
      description: parsed.data.description?.trim() || target.description,
      prompt: parsed.data.prompt?.trim() || target.prompt,
      negativePrompt: parsed.data.negativePrompt === undefined
        ? target.negativePrompt
        : (parsed.data.negativePrompt?.trim() || undefined),
      thumbnail: parsed.data.thumbnail === undefined
        ? target.thumbnail
        : (parsed.data.thumbnail?.trim() || undefined),
      isNew: parsed.data.isNew === undefined ? target.isNew === true : parsed.data.isNew,
      isPro: parsed.data.isPro === undefined ? target.isPro === true : parsed.data.isPro
    }

    const nextAll = [...allPresets]
    nextAll[targetIndex] = nextPreset

    const currentConfig = await getStylePresetConfig(allPresets)
    const enabledStyleIds = [...currentConfig.enabledStyleIds]
    const currentEnabled = enabledStyleIds.includes(id)
    const nextEnabled = parsed.data.enabled === undefined ? currentEnabled : parsed.data.enabled

    if (!nextEnabled && enabledStyleIds.length <= 1 && currentEnabled) {
      throw createError({
        statusCode: 400,
        statusMessage: '至少保留一个启用画风',
        message: '不能禁用最后一个启用的画风'
      })
    }

    if (nextEnabled && !enabledStyleIds.includes(id)) {
      enabledStyleIds.push(id)
    }

    if (!nextEnabled) {
      const index = enabledStyleIds.indexOf(id)
      if (index >= 0) enabledStyleIds.splice(index, 1)
    }

    if (enabledStyleIds.length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: '至少保留一个启用画风',
        message: '不能禁用最后一个启用的画风'
      })
    }

    let defaultStyleId = currentConfig.defaultStyleId
    if (parsed.data.setAsDefault === true) {
      if (!enabledStyleIds.includes(id)) {
        throw createError({
          statusCode: 400,
          statusMessage: '默认画风无效',
          message: '请先启用该画风后再设为默认'
        })
      }
      defaultStyleId = id
    } else if (!enabledStyleIds.includes(defaultStyleId)) {
      defaultStyleId = enabledStyleIds[0] || ''
    }

    const savedAll = await saveStylePresetList(nextAll)
    await saveStylePresetConfig({
      enabledStyleIds,
      defaultStyleId
    }, savedAll)

    const runtime = await getStylePresetRuntimeData()
    const updated = runtime.allPresets.find(style => style.id === id) || nextPreset

    return {
      success: true,
      data: {
        preset: updated,
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

    console.error('[StylePreset] 更新失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '更新画风预设失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
