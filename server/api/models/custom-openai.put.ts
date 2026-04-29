import { z } from 'zod'
import {
  initializeSelectedModels,
  setCustomOpenAIProviderConfig
} from '../../utils/model-provider'

const CustomOpenAIProviderUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().trim().min(1).max(60).optional(),
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().optional(),
  textModels: z.array(z.string().trim().min(1)).optional(),
  availableTextModels: z.array(z.string().trim().min(1)).optional(),
  modelsSyncedAt: z.string().optional(),
  modelsSyncError: z.string().optional()
})

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const body = await readBody(event)
  const parsed = CustomOpenAIProviderUpdateSchema.safeParse(body || {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const data = parsed.data
  const next = await setCustomOpenAIProviderConfig({
    ...data,
    textModels: data.textModels
      ? Array.from(new Set(data.textModels.map(model => model.trim()).filter(Boolean)))
      : undefined
  })

  return {
    success: true,
    data: next
  }
})
