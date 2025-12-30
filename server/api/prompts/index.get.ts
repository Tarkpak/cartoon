/**
 * 获取所有提示词模板
 * GET /api/prompts
 */

import { getAllPromptTemplates } from '../../utils/prompt-template'
import { PROMPT_TEMPLATES_BY_CATEGORY, CATEGORY_NAMES } from '../../../shared/types/prompt-template'

export default defineEventHandler(async () => {
  try {
    const templates = await getAllPromptTemplates()

    // 按分类分组
    const grouped = {
      text: templates.filter(t => t.category === 'text'),
      image: templates.filter(t => t.category === 'image'),
      video: templates.filter(t => t.category === 'video'),
      audio: templates.filter(t => t.category === 'audio')
    }

    return {
      success: true,
      data: {
        templates,
        grouped,
        categoryNames: CATEGORY_NAMES,
        metadata: PROMPT_TEMPLATES_BY_CATEGORY
      }
    }
  } catch (error) {
    console.error('[Prompts API] 获取模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取提示词模板失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
