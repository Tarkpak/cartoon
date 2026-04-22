/**
 * 更新提示词配置方案元数据
 * PUT /api/prompts/profiles/:id
 */

import { z } from 'zod'
import { updatePromptProfile } from '../../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../../utils/prompt-workflow'

const UpdatePromptProfileSchema = z.object({
  name: z.string().trim().min(1, '配置名称不能为空').max(64, '配置名称不能超过 64 个字符').optional(),
  description: z.string().trim().max(200, '描述不能超过 200 个字符').optional()
}).refine(value => value.name !== undefined || value.description !== undefined, {
  message: '至少提供一个可更新字段'
})

export default defineEventHandler(async (event) => {
  const profileId = getRouterParam(event, 'id')
  if (!profileId) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少配置 ID'
    })
  }

  const workflow = resolvePromptWorkflowFromEvent(event)
  const body = await readBody(event)
  const parsed = UpdatePromptProfileSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const data = await updatePromptProfile(profileId, parsed.data, workflow)
    if (!data) {
      throw createError({
        statusCode: 404,
        statusMessage: '提示词配置方案不存在'
      })
    }

    return {
      success: true,
      data: {
        workflow,
        ...data
      },
      message: '提示词配置方案已更新'
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error
    }

    console.error('[PromptProfiles API] 更新配置方案失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '更新提示词配置方案失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
