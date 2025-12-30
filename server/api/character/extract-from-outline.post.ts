import { z } from 'zod'
import { generateJSON, getSelectedModels } from '../../utils/model-provider'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'

const RequestSchema = z.object({
  outline: z.object({
    title: z.string(),
    synopsis: z.string(),
    acts: z.array(z.object({
      summary: z.string(),
      keyEvents: z.array(z.string())
    })),
    suggestedCharacters: z.array(z.object({
      name: z.string(),
      role: z.string(),
      description: z.string(),
      personality: z.string().optional(),
      motivation: z.string().optional()
    })).optional()
  }),
  style: z.string().describe('画风 (必填，由项目配置决定)'),
  // 新增：从场景中提取的角色名称列表，用于增强角色信息
  existingCharacters: z.array(z.string()).optional()
})

const CharacterSchema = z.object({
  name: z.string(),
  role: z.enum(['protagonist', 'antagonist', 'supporting']),
  appearance: z.string(),
  personality: z.string(),
  traits: z.array(z.string()),
  background: z.string().optional(),
  motivation: z.string().optional(),
  speakingStyle: z.enum(['formal', 'casual', 'polite', 'rude', 'childish', 'mature', 'humorous', 'serious', 'mysterious', 'energetic']).optional(),
  catchphrase: z.string().optional(),
  age: z.number().optional(),
  gender: z.enum(['male', 'female', 'other']).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { outline, style } = RequestSchema.parse(body)

  try {
    // 从数据库获取提示词模板
    const finalPrompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.CHARACTER_FROM_OUTLINE,
      {
        outline: JSON.stringify(outline),
        style
      }
    )

    if (!finalPrompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }

    const selectedModels = getSelectedModels()
    const parsed = await generateJSON<z.infer<typeof CharacterSchema>[]>({
      modelId: selectedModels.text,
      prompt: finalPrompt,
      temperature: 0.7,
      maxRetries: 2
    })

    const characters = z.array(CharacterSchema).parse(parsed)

    return {
      success: true,
      characters: characters.map((char, idx) => ({
        id: `char_${Date.now()}_${idx}`,
        ...char
      }))
    }
  } catch (error: unknown) {
    console.error('角色提取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '角色提取失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
