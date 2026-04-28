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
      statusMessage: '缺少测试提示词',
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
