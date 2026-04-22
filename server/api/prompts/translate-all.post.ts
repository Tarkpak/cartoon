/**
 * 批量翻译所有提示词模板
 * 将所有模板的指定语言翻译到目标语言
 */

import { getAllPromptTemplates, getPromptProfiles, updatePromptTemplate } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'
import { generateTextForWorkflow } from '../../utils/workflow-model'
import { PROMPT_DEFAULT_PROFILE_ID, type PromptTemplateId } from '../../../shared/types/prompt-template'

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

  if (profileData.activeProfileId === PROMPT_DEFAULT_PROFILE_ID) {
    throw createError({
      statusCode: 403,
      statusMessage: '默认配置不可修改',
      message: '请先创建并切换到自定义提示词配置方案'
    })
  }

  // 获取所有模板
  const templates = await getAllPromptTemplates(workflow)

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

      const systemPrompt = `You are a professional translator specializing in AI prompts and technical content.
Your task is to translate the given text from ${fromLang} to ${toLang}.

Rules:
1. Preserve all template variables like {{variableName}} exactly as they are
2. Maintain the original formatting, line breaks, and structure
3. Keep technical terms accurate and consistent
4. Translate naturally while preserving the original meaning and tone
5. Do not add any explanations or notes, only output the translated text`

      const userPrompt = `Please translate the following text from ${fromLang} to ${toLang}:

${sourceText}`

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
