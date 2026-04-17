/**
 * 提示词翻译 API
 * 使用配置的翻译模型进行中英文互译
 */

import { generateTextForWorkflow } from '../../utils/workflow-model'

interface TranslateRequest {
  text: string
  from: 'zh' | 'en'
  to: 'zh' | 'en'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<TranslateRequest>(event)

  if (!body.text || !body.from || !body.to) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数: text, from, to'
    })
  }

  if (body.from === body.to) {
    return {
      success: true,
      data: { translatedText: body.text }
    }
  }

  const fromLang = body.from === 'zh' ? '中文' : 'English'
  const toLang = body.to === 'zh' ? '中文' : 'English'

  const systemPrompt = `You are a professional translator specializing in AI prompts and technical content.
Your task is to translate the given text from ${fromLang} to ${toLang}.

Rules:
1. Preserve all template variables like {{variableName}} exactly as they are
2. Maintain the original formatting, line breaks, and structure
3. Keep technical terms accurate and consistent
4. Translate naturally while preserving the original meaning and tone
5. Do not add any explanations or notes, only output the translated text`

  const userPrompt = `Please translate the following text from ${fromLang} to ${toLang}:

${body.text}`

  try {
    const result = await generateTextForWorkflow('text_translation', {
      prompt: userPrompt,
      systemInstruction: systemPrompt,
      temperature: 0.3
    })

    return {
      success: true,
      data: { translatedText: result.trim() }
    }
  } catch (error) {
    console.error('[Translate] Error:', error)
    throw createError({
      statusCode: 500,
      message: error instanceof Error ? error.message : '翻译失败'
    })
  }
})
