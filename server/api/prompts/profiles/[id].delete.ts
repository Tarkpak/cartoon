/**
 * 删除提示词配置方案
 * DELETE /api/prompts/profiles/:id
 */

import { deletePromptProfile } from '../../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../../utils/prompt-workflow'

export default defineEventHandler(async (event) => {
  const profileId = getRouterParam(event, 'id')
  if (!profileId) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少配置 ID'
    })
  }

  const workflow = resolvePromptWorkflowFromEvent(event)

  try {
    const data = await deletePromptProfile(profileId, workflow)
    if (!data) {
      throw createError({
        statusCode: 400,
        statusMessage: '删除失败，至少需要保留一个配置方案'
      })
    }

    return {
      success: true,
      data: {
        workflow,
        ...data
      },
      message: '提示词配置方案已删除'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[PromptProfiles API] 删除配置方案失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '删除提示词配置方案失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
