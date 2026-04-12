import { z } from 'zod'
import { updatePromptLangConfig } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'

const UpdateLangConfigSchema = z.record(z.enum(['zh', 'en']))

/**
 * 更新提示词语言配置
 * PUT /api/prompts/lang-config
 */
export default defineEventHandler(async (event) => {
  try {
    const workflow = resolvePromptWorkflowFromEvent(event)
    const body = await readBody(event)
    const config = UpdateLangConfigSchema.parse(body)
    
    const updated = await updatePromptLangConfig(config, workflow)
    
    return {
      success: true,
      data: updated,
      workflow
    }
  } catch (error) {
    console.error('[PromptLangConfig] 更新失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '更新语言配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
