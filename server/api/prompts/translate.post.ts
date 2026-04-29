/**
 * 提示词翻译 API
 * 使用配置的翻译模型进行中英文互译
 */

import { generateTextForWorkflow } from '../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'

interface TranslateRequest {
  text: string
  from: 'zh' | 'en'
  to: 'zh' | 'en'
}

export default defineEventHandler(async (event) => {
  const workflow = resolvePromptWorkflowFromEvent(event)
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
  const systemPrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.PROMPT_TRANSLATION_SYSTEM,
    { fromLang, toLang },
    undefined,
    workflow
  )
  const userPrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.PROMPT_TRANSLATION_USER,
    {
      fromLang,
      toLang,
      sourceText: body.text
    },
    undefined,
    workflow
  )

  if (!systemPrompt || !userPrompt) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '无法获取翻译模板，请在提示词配置中检查“提示词翻译系统指令/提示词翻译请求模板”'
    })
  }

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
