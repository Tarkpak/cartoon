/**
 * 获取单个提示词模板
 * GET /api/prompts/[id]
 */

import { getPromptTemplate } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'
import type { PromptTemplateId } from '../../../shared/types/prompt-template'

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

  try {
    const template = await getPromptTemplate(id, undefined, workflow)

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '模板不存在',
      })
    }

    return {
      success: true,
      data: template,
      workflow
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 获取模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
