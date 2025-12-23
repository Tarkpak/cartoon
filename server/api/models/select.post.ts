/**
 * 切换模型 API
 * POST /api/models/select
 */
import { z } from 'zod'
import { setSelectedModel, getSelectedModels } from '../../utils/model-provider'

const RequestSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'tts', 'asr']),
  modelId: z.string()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = RequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { type, modelId } = parseResult.data
  setSelectedModel(type, modelId)

  console.log(`[Models] 切换 ${type} 模型为: ${modelId}`)

  return {
    success: true,
    selected: getSelectedModels()
  }
})
