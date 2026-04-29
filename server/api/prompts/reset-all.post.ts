/**
 * 重置所有提示词模板
 * POST /api/prompts/reset-all
 */

import { resetAllPromptTemplates, getAllPromptTemplates } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'

export default defineEventHandler(async (event) => {
  try {
    const workflow = resolvePromptWorkflowFromEvent(event)
    const success = await resetAllPromptTemplates(workflow)

    if (!success) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: '重置失败',
      })
    }

    // 返回重置后的模板
    const templates = await getAllPromptTemplates(workflow)

    return {
      success: true,
      data: templates,
      workflow,
      message: '所有模板已重置为默认值'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 重置所有模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
