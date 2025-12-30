/**
 * 重置所有提示词模板
 * POST /api/prompts/reset-all
 */

import { resetAllPromptTemplates, getAllPromptTemplates } from '../../utils/prompt-template'

export default defineEventHandler(async () => {
  try {
    const success = await resetAllPromptTemplates()

    if (!success) {
      throw createError({
        statusCode: 500,
        statusMessage: '重置失败'
      })
    }

    // 返回重置后的模板
    const templates = await getAllPromptTemplates()

    return {
      success: true,
      data: templates,
      message: '所有模板已重置为默认值'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 重置所有模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '重置所有提示词模板失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
