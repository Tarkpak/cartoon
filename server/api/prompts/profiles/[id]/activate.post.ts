/**
 * 激活提示词配置方案
 * POST /api/prompts/profiles/:id/activate
 */

import { activatePromptProfile } from '../../../../utils/prompt-template'

export default defineEventHandler(async (event) => {
  const profileId = getRouterParam(event, 'id')
  if (!profileId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少配置 ID'
    })
  }

  try {
    const data = await activatePromptProfile(profileId)
    if (!data) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '提示词配置方案不存在'
      })
    }

    return {
      success: true,
      data,
      message: '已切换提示词配置方案'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[PromptProfiles API] 切换配置方案失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
