/**
 * 获取提示词版本历史
 * GET /api/prompts/[id]/versions
 */

import { getPromptVersions } from '../../../utils/prompt-template'
import type { PromptTemplateId } from '../../../../shared/types/prompt-template'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') as PromptTemplateId

  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少模板 ID'
    })
  }

  try {
    const versions = await getPromptVersions(id)

    return {
      success: true,
      data: {
        templateId: id,
        versions,
        count: versions.length
      }
    }
  } catch (error) {
    console.error('[Prompts API] 获取版本历史失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取版本历史失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
