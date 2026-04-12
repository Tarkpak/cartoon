/**
 * 重置单个提示词模板
 * POST /api/prompts/[id]/reset
 */

import { resetPromptTemplate } from '../../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../../utils/prompt-workflow'
import type { PromptTemplateId } from '../../../../shared/types/prompt-template'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as PromptTemplateId
  const workflow = resolvePromptWorkflowFromEvent(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少模板 ID'
    })
  }

  try {
    const template = await resetPromptTemplate(id, workflow)

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: '模板不存在'
      })
    }

    return {
      success: true,
      data: template,
      workflow,
      message: '模板已重置为默认值'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 重置模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '重置提示词模板失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
