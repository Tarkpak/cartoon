/**
 * 切换模型 API
 * POST /api/models/select
 */
import { z } from 'zod'
import { initializeSelectedModels, setSelectedModel, getSelectedModels } from '../../utils/model-provider'

const RequestSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'tts', 'asr']),
  modelId: z.string()
})

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const body = await readBody(event)
  const parseResult = RequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { type, modelId } = parseResult.data
  await setSelectedModel(type, modelId)

  console.log(`[Models] 切换 ${type} 模型为: ${modelId}`)

  return {
    success: true,
    selected: getSelectedModels()
  }
})
