import { z } from 'zod'
import {
  initializeSelectedModels,
  syncCustomOpenAIProviderModels
} from '../../../utils/model-provider'

const CustomOpenAIProviderSyncSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(60).optional(),
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().optional()
})

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const body = await readBody(event)
  const parsed = CustomOpenAIProviderSyncSchema.safeParse(body || {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  try {
    const next = await syncCustomOpenAIProviderModels(parsed.data)
    return {
      success: true,
      data: next
    }
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: error instanceof Error ? error.message : String(error)
    })
  }
})
