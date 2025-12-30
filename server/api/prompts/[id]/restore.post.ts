/**
 * 恢复到指定版本
 * POST /api/prompts/[id]/restore
 */

import { z } from 'zod'
import { restorePromptVersion } from '../../../utils/prompt-template'
import type { PromptTemplateId } from '../../../../shared/types/prompt-template'

const RestoreSchema = z.object({
  versionId: z.string().min(1, '版本 ID 不能为空')
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as PromptTemplateId

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少模板 ID'
    })
  }

  const body = await readBody(event)

  // 验证请求体
  const parseResult = RestoreSchema.safeParse(body)
  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { versionId } = parseResult.data

  try {
    const template = await restorePromptVersion(id, versionId)

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: '模板或版本不存在'
      })
    }

    return {
      success: true,
      data: template,
      message: '已恢复到指定版本'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 恢复版本失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '恢复版本失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
