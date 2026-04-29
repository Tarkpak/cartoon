/**
 * 批量翻译所有提示词模板
 * 将所有模板的指定语言翻译到目标语言
 */

import {
  getAllPromptTemplates,
  getInterpolatedPrompt,
  getPromptProfiles,
  updatePromptTemplate
} from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'
import { generateTextForWorkflow } from '../../utils/workflow-model'
import {
  isPromptReadonlyProfile,
  PROMPT_TEMPLATE_IDS,
  type PromptTemplateId
} from '../../../shared/types/prompt-template'

interface TranslateAllRequest {
  from: 'zh' | 'en'
  to: 'zh' | 'en'
  overwrite?: boolean // 是否覆盖已有内容
}

export default defineEventHandler(async (event) => {
  const workflow = resolvePromptWorkflowFromEvent(event)
  const body = await readBody<TranslateAllRequest>(event)

  if (!body.from || !body.to) {
    throw createError({
      statusCode: 400,
      message: '缺少必要参数: from, to'
    })
  }

  if (body.from === body.to) {
    return { success: true, data: { translated: 0, skipped: 0 } }
  }

  const fromLang = body.from === 'zh' ? '中文' : 'English'
  const toLang = body.to === 'zh' ? '中文' : 'English'
  const profileData = await getPromptProfiles(workflow)
  const systemPrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.PROMPT_TRANSLATION_SYSTEM,
    { fromLang, toLang },
    undefined,
    workflow
  )

  if (isPromptReadonlyProfile(profileData.activeProfileId)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: '请先创建并切换到自定义提示词配置方案'
    })
  }

  // 获取所有模板
  const templates = await getAllPromptTemplates(workflow)

  if (!systemPrompt) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '无法获取翻译模板，请在提示词配置中检查“提示词翻译系统指令”'
    })
  }

  let translated = 0
  let skipped = 0
  const errors: string[] = []

  for (const template of templates) {
    try {
      const sourceText = template.content[body.from]
      const targetText = template.content[body.to]

      // 如果源文本为空，跳过
      if (!sourceText?.trim()) {
        skipped++
        continue
      }

      // 如果目标已有内容且不覆盖，跳过
      if (targetText?.trim() && !body.overwrite) {
        skipped++
        continue
      }

      const userPrompt = await getInterpolatedPrompt(
        PROMPT_TEMPLATE_IDS.PROMPT_TRANSLATION_USER,
        {
          fromLang,
          toLang,
          sourceText
        },
        undefined,
        workflow
      )
      if (!userPrompt) {
        throw new Error('翻译请求模板缺失，请检查“提示词翻译请求模板”配置')
      }

      const result = await generateTextForWorkflow('text_translation', {
        prompt: userPrompt,
        systemInstruction: systemPrompt,
        temperature: 0.3
      })

      // 更新模板
      const newContent = {
        ...template.content,
        [body.to]: result.trim()
      }

      await updatePromptTemplate(
        template.id as PromptTemplateId,
        newContent,
        `批量翻译 ${body.from} -> ${body.to}`,
        workflow
      )

      translated++

      // 添加延迟避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (error) {
      console.error(`[TranslateAll] Error translating ${template.id}:`, error)
      errors.push(template.id)
    }
  }

  return {
    success: true,
    data: {
      workflow,
      translated,
      skipped,
      errors: errors.length > 0 ? errors : undefined
    }
  }
})
