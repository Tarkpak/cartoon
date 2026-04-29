/**
 * 更新提示词模板
 * PUT /api/prompts/[id]
 */

import { z } from 'zod'
import { updatePromptTemplate } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'
import type { PromptTemplateId, BilingualContent } from '../../../shared/types/prompt-template'

const UpdateSchema = z.object({
  content: z.object({
    zh: z.string(),
    en: z.string()
  }),
  note: z.string().optional()
})

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

  const body = await readBody(event)

  // 验证请求体
  const parseResult = UpdateSchema.safeParse(body)
  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { content, note } = parseResult.data

  try {
    const template = await updatePromptTemplate(id, content as BilingualContent, note, workflow)

    if (!template) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: '模板不存在',
      })
    }

    return {
      success: true,
      data: template,
      workflow,
      message: '模板更新成功'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[Prompts API] 更新模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
