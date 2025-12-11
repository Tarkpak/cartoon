import { generateText, TextModels, GeminiError } from '../utils/gemini'

/**
 * 测试 Gemini API 连接
 * GET /api/test
 */
export default defineEventHandler(async () => {
  const startTime = Date.now()

  try {
    const response = await generateText({
      model: TextModels.GENERAL,
      prompt: '你好，请用一句话介绍自己。',
      maxRetries: 2
    })

    return {
      success: true,
      message: 'Gemini API 连接成功',
      response,
      model: TextModels.GENERAL,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    // 使用自定义错误处理
    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `Gemini API 错误: ${error.code}`,
        message: error.message,
        data: {
          code: error.code,
          retryable: error.retryable
        }
      })
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    throw createError({
      statusCode: 500,
      statusMessage: 'Gemini API 连接失败',
      message
    })
  }
})
