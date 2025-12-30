import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import { z } from 'zod'

/**
 * 角色提取请求
 */
const ExtractCharactersRequestSchema = z.object({
  content: z.string().describe('剧本或人物小传内容'),
  style: z.string().optional().default('国漫风格').describe('画风')
})

/**
 * 提取的角色信息
 */
const ExtractedCharacterSchema = z.object({
  role: z.string().describe('角色姓名'),
  role_content: z.string().describe('角色形象描述 (用于文生图)')
})

/**
 * 角色提取 API
 * POST /api/character/extract
 *
 * 基于飞书文档 2.4.1 的角色形象提取流程
 * 从剧本或人物小传中提取角色，生成文生图提示词
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  const body = await readBody(event)
  const parseResult = ExtractCharactersRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { content, style } = parseResult.data

  try {
    // 从数据库获取提示词模板（已合并系统提示词和用户提示词）
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.CHARACTER_EXTRACTION,
      {
        content,
        style
      }
    ) || `请从以下内容中提取角色形象：\n\n${content}`

    // 不再需要单独的系统提示词
    const systemInstruction = undefined

    // 使用业务流程配置的模型
    const result = await generateJSONForWorkflow<{ characters: Array<{ role: string, role_content: string }> }>('character_extraction', {
      prompt,
      systemInstruction,
      temperature: 0.4,
      maxRetries: 2
    })

    // 验证结果
    const characters = result.characters || []
    const validated = z.array(ExtractedCharacterSchema).safeParse(characters)

    if (!validated.success) {
      throw createError({
        statusCode: 500,
        statusMessage: '角色提取格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
    }

    return {
      success: true,
      characters: validated.data,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error('[CharacterExtract] 提取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '角色提取失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
