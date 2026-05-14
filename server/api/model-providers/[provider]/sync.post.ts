import { z } from 'zod'
import {
  initializeSelectedModels,
  syncModelProviderCatalog
} from '../../../utils/model-provider'

const ProviderParamSchema = z.object({
  provider: z.enum(['gemini', 'qwen', 'kling', 'volcengine', 'deepseek', 'custom_openai'])
})

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const parsed = ProviderParamSchema.safeParse({
    provider: getRouterParam(event, 'provider')
  })
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const provider = await syncModelProviderCatalog(parsed.data.provider)
    return {
      success: true,
      data: provider
    }
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: error instanceof Error ? error.message : String(error)
    })
  }
})
