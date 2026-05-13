/**
 * 获取提示词配置方案列表
 * GET /api/prompts/profiles
 */

import { getPromptProfiles } from '../../utils/prompt-template'

export default defineEventHandler(async () => {
  try {
    const data = await getPromptProfiles()

    return {
      success: true,
      data
    }
  } catch (error) {
    console.error('[PromptProfiles API] 获取配置方案失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
