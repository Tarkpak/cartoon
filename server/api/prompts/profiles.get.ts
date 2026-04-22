/**
 * 获取提示词配置方案列表
 * GET /api/prompts/profiles
 */

import { getPromptProfiles } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'

export default defineEventHandler(async (event) => {
  try {
    const workflow = resolvePromptWorkflowFromEvent(event)
    const data = await getPromptProfiles(workflow)

    return {
      success: true,
      data: {
        workflow,
        ...data
      }
    }
  } catch (error) {
    console.error('[PromptProfiles API] 获取配置方案失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取提示词配置方案失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
