/**
 * 恢复到指定版本
 * POST /api/prompts/[id]/restore
 */

import { z } from 'zod'
import { restorePromptVersion } from '../../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../../utils/prompt-workflow'
import type { PromptTemplateId } from '../../../../shared/types/prompt-template'

const RestoreSchema = z.object({
  versionId: z.string().min(1, '版本 ID 不能为空')
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as PromptTemplateId
  const workflow = resolvePromptWorkflowFromEvent(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少模板 ID',
    })
  }

  const body = await readBody(event)

  // 验证请求体
  const parseResult = RestoreSchema.safeParse(body)
  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { versionId } = parseResult.data

  try {
    const template = await restorePromptVersion(id, versionId, workflow)

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '模板或版本不存在',
      })
    }

    return {
      success: true,
      data: template,
      workflow,
      message: '已恢复到指定版本'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 恢复版本失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
