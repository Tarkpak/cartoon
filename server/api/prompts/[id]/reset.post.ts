/**
 * 重置单个提示词模板
 * POST /api/prompts/[id]/reset
 */

import { resetPromptTemplate } from '../../../utils/prompt-template'
import type { PromptTemplateId } from '../../../../shared/types/prompt-template'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as PromptTemplateId

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少模板 ID'
    })
  }

  try {
    const template = await resetPromptTemplate(id)

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '模板不存在'
      })
    }

    return {
      success: true,
      data: template,
      message: '模板已重置为默认值'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 重置模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
