import { z } from 'zod'
import {
  initializeSelectedModels,
  setModelProviderEnabledModels
} from '../../../utils/model-provider'

const ProviderParamSchema = z.object({
  provider: z.enum(['gemini', 'qwen', 'kling', 'volcengine', 'custom_openai'])
})

const EnabledModelsSchema = z.object({
  models: z.array(z.string().trim().min(1))
})

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const params = ProviderParamSchema.safeParse({
    provider: getRouterParam(event, 'provider')
  })
  if (!params.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '供应商无效',
      message: params.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const body = await readBody(event)
  const parsed = EnabledModelsSchema.safeParse(body || {})
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parsed.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const provider = await setModelProviderEnabledModels(params.data.provider, parsed.data.models)
  return {
    success: true,
    data: provider
  }
})
