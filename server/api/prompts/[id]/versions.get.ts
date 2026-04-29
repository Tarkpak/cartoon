/**
 * 获取提示词版本历史
 * GET /api/prompts/[id]/versions
 */

import { getPromptVersions } from '../../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../../utils/prompt-workflow'
import type { PromptTemplateId } from '../../../../shared/types/prompt-template'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as PromptTemplateId
  const workflow = resolvePromptWorkflowFromEvent(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少模板 ID',
    })
  }

  try {
    const versions = await getPromptVersions(id, workflow)

    return {
      success: true,
      data: {
        workflow,
        templateId: id,
        versions,
        count: versions.length
      }
    }
  } catch (error) {
    console.error('[Prompts API] 获取版本历史失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
