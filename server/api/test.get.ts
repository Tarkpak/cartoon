import { _geminiGenerateText, TextModels, GeminiError } from '../utils/gemini'

/**
 * 测试 Gemini API 连接
 * GET /api/test
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  const query = getQuery(event)
  const prompt = typeof query.prompt === 'string' ? query.prompt.trim() : ''

  if (!prompt) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '请通过 query 参数传入 prompt，例如 /api/test?prompt=hello'
    })
  }

  try {
    const response = await _geminiGenerateText({
      model: TextModels.GENERAL,
      prompt,
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
      const statusCode = error.status || 500
      throw createError({
        statusCode,
        statusMessage: statusCode >= 500 ? 'Internal Server Error' : 'Bad Request',
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
      statusMessage: 'Internal Server Error',
      message: `Gemini API 连接失败: ${message}`
    })
  }
})
