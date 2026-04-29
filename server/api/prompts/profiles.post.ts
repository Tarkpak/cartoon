/**
 * 新增提示词配置方案
 * POST /api/prompts/profiles
 */

import { z } from 'zod'
import { createPromptProfile } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'

const CreatePromptProfileSchema = z.object({
  name: z.string().trim().min(1, '配置名称不能为空').max(64, '配置名称不能超过 64 个字符'),
  description: z.string().trim().max(200, '描述不能超过 200 个字符').optional(),
  cloneFromProfileId: z.string().trim().min(1).optional(),
  activate: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const workflow = resolvePromptWorkflowFromEvent(event)
  const body = await readBody(event)
  const parsed = CreatePromptProfileSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const data = await createPromptProfile(parsed.data, workflow)
    if (!data) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        message: '创建提示词配置方案失败',
      })
    }

    return {
      success: true,
      data: {
        workflow,
        ...data
      },
      message: '提示词配置方案创建成功'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[PromptProfiles API] 创建配置方案失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
