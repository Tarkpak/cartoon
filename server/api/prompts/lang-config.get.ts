import { getPromptLangConfig } from '../../utils/prompt-template'

/**
 * 获取提示词语言配置
 * GET /api/prompts/lang-config
 */
export default defineEventHandler(async () => {
  try {
    const config = await getPromptLangConfig()
    return {
      success: true,
      data: config
    }
  } catch (error) {
    console.error('[PromptLangConfig] 获取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取语言配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
