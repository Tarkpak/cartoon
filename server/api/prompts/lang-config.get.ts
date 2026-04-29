import { getPromptLangConfig } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'

/**
 * 获取提示词语言配置
 * GET /api/prompts/lang-config
 */
export default defineEventHandler(async (event) => {
  try {
    const workflow = resolvePromptWorkflowFromEvent(event)
    const config = await getPromptLangConfig(workflow)
    return {
      success: true,
      data: config,
      workflow
    }
  } catch (error) {
    console.error('[PromptLangConfig] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
