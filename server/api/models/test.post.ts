/**
 * 测试模型 API
 * POST /api/models/test
 * 
 * 用于测试当前选择的模型是否正常工作
 */

import { z } from 'zod'
import {
  generateText,
  generateJSON,
  getSelectedModels,
  findTextModel
} from '../../utils/model-provider'

const TestRequestSchema = z.object({
  type: z.enum(['text', 'json']).default('text'),
  prompt: z.string().default('你好，请用一句话介绍你自己。')
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = TestRequestSchema.safeParse(body || {})

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { type, prompt } = parseResult.data
  const selected = getSelectedModels()
  const modelConfig = findTextModel(selected.text)

  console.log(`[ModelTest] 测试模型: ${selected.text} (${modelConfig?.provider})`)

  const startTime = Date.now()

  try {
    let result: unknown

    if (type === 'json') {
      result = await generateJSON({
        prompt: `${prompt}\n\n请以 JSON 格式返回，包含 message 字段。`,
        temperature: 0.5
      })
    } else {
      result = await generateText({
        prompt,
        temperature: 0.7
      })
    }

    return {
      success: true,
      data: {
        model: selected.text,
        provider: modelConfig?.provider,
        displayName: modelConfig?.displayName,
        type,
        result,
        latencyMs: Date.now() - startTime
      }
    }
  } catch (error) {
    console.error('[ModelTest] 测试失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '测试失败',
      data: {
        model: selected.text,
        provider: modelConfig?.provider,
        latencyMs: Date.now() - startTime
      }
    }
  }
})
