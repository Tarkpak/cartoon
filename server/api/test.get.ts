import { getGeminiClient, TextModels } from '../utils/gemini'

/**
 * 测试 Gemini API 连接
 * GET /api/test
 */
export default defineEventHandler(async () => {
  try {
    const client = getGeminiClient()
    
    const response = await client.models.generateContent({
      model: TextModels.GENERAL,
      contents: '你好，请用一句话介绍自己。',
    })
    
    return {
      success: true,
      message: 'Gemini API 连接成功',
      response: response.text,
      model: TextModels.GENERAL,
      timestamp: new Date().toISOString(),
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Gemini API 连接失败',
      message,
    })
  }
})
