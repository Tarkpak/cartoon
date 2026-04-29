import { z } from 'zod'
import { STYLE_CATEGORIES, type StylePreset } from '#shared/types/styles'
import {
  getAllStylePresets,
  getStylePresetConfig,
  getStylePresetRuntimeData,
  saveStylePresetConfig,
  saveStylePresetList
} from '../../utils/style-config'

const STYLE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const styleCategoryIds = STYLE_CATEGORIES.map(category => category.id) as [string, ...string[]]

const CreateStylePresetSchema = z.object({
  id: z.string().trim().max(64).regex(STYLE_ID_PATTERN, 'ID 仅支持字母、数字、下划线和短横线').optional(),
  name: z.string().trim().min(1, '名称不能为空').max(64),
  nameEn: z.string().trim().max(64).optional().nullable(),
  category: z.enum(styleCategoryIds),
  description: z.string().trim().min(1, '描述不能为空').max(200),
  prompt: z.string().trim().min(1, '预设词不能为空').max(500),
  negativePrompt: z.string().trim().max(500).optional().nullable(),
  thumbnail: z.string().trim().max(500).optional().nullable(),
  isNew: z.boolean().optional(),
  isPro: z.boolean().optional(),
  enabled: z.boolean().optional(),
  setAsDefault: z.boolean().optional()
})

function toStyleSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveStyleId(inputId: string | undefined, name: string, usedIds: Set<string>): string {
  if (inputId) {
    const normalized = toStyleSlug(inputId)
    if (!normalized || !STYLE_ID_PATTERN.test(normalized)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: 'ID 仅支持字母、数字、下划线和短横线'
      })
    }

    if (usedIds.has(normalized)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: `画风 ID 已存在: ${normalized}`
      })
    }

    return normalized
  }

  const base = toStyleSlug(name) || 'custom_style'
  let nextId = base
  let suffix = 2
  while (usedIds.has(nextId)) {
    nextId = `${base}_${suffix}`
    suffix += 1
  }
  return nextId
}

/**
 * 新增画风预设
 * POST /api/styles/presets
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = CreateStylePresetSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const allPresets = await getAllStylePresets()
    const usedIds = new Set(allPresets.map(style => style.id))
    const nextId = resolveStyleId(parsed.data.id || undefined, parsed.data.name, usedIds)

    const newPreset: StylePreset = {
      id: nextId,
      name: parsed.data.name.trim(),
      nameEn: parsed.data.nameEn?.trim() || parsed.data.name.trim(),
      category: parsed.data.category as StylePreset['category'],
      description: parsed.data.description.trim(),
      prompt: parsed.data.prompt.trim(),
      negativePrompt: parsed.data.negativePrompt?.trim() || undefined,
      thumbnail: parsed.data.thumbnail?.trim() || undefined,
      isNew: parsed.data.isNew === true,
      isPro: parsed.data.isPro === true
    }

    const savedAll = await saveStylePresetList([...allPresets, newPreset])
    const currentConfig = await getStylePresetConfig(allPresets)
    const nextEnabled = [...currentConfig.enabledStyleIds]

    if (parsed.data.enabled !== false && !nextEnabled.includes(newPreset.id)) {
      nextEnabled.push(newPreset.id)
    }

    const nextDefaultId = parsed.data.setAsDefault === true
      ? newPreset.id
      : currentConfig.defaultStyleId

    await saveStylePresetConfig({
      enabledStyleIds: nextEnabled,
      defaultStyleId: nextDefaultId
    }, savedAll)

    const runtime = await getStylePresetRuntimeData()

    return {
      success: true,
      data: {
        preset: newPreset,
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

    console.error('[StylePreset] 新增失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
