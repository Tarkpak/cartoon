/**
 * 切换当前使用的模型
 * POST /api/models/switch
 */

import { z } from 'zod'
import {
  initializeSelectedModels,
  setSelectedModel,
  getSelectedModels,
  findTextModel,
  findImageModel,
  findVideoModel,
  findVoiceModel
} from '../../utils/model-provider'

const SwitchModelRequestSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'tts', 'asr']),
  modelId: z.string()
})

export default defineEventHandler(async (event) => {
  await initializeSelectedModels()

  const body = await readBody(event)
  const parseResult = SwitchModelRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { type, modelId } = parseResult.data

  // 验证模型是否存在
  let modelExists = false
  let modelInfo = null

  switch (type) {
    case 'text':
      modelInfo = findTextModel(modelId)
      modelExists = !!modelInfo
      break
    case 'image':
      modelInfo = findImageModel(modelId)
      modelExists = !!modelInfo
      break
    case 'video':
      modelInfo = findVideoModel(modelId)
      modelExists = !!modelInfo
      break
    case 'tts':
    case 'asr':
      modelInfo = findVoiceModel(modelId)
      modelExists = !!modelInfo && modelInfo.type === type
      break
  }

  if (!modelExists) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `未找到类型为 ${type} 的模型: ${modelId}`
    })
  }

  // 切换模型
  await setSelectedModel(type, modelId)

  console.log(`[Models] 切换 ${type} 模型为: ${modelId} (${modelInfo?.displayName})`)

  return {
    success: true,
    message: `已切换 ${type} 模型`,
    data: {
      type,
      modelId,
      modelInfo,
      selected: getSelectedModels()
    }
  }
})
