import { z } from 'zod'
import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'

const RequestSchema = z.object({
  rawText: z.string().min(10),
  genre: z.string().optional(),
  targetLength: z.enum(['short', 'medium', 'long']).optional().default('medium')
})

const OutlineSchema = z.object({
  title: z.string(),
  logline: z.string(),
  synopsis: z.string(),
  genre: z.enum(['romance', 'fantasy', 'action', 'comedy', 'drama', 'horror', 'mystery', 'scifi', 'slice_of_life']),
  pace: z.enum(['slow', 'medium', 'fast']),
  theme: z.string().optional(),
  setting: z.object({
    world: z.string(),
    era: z.string().optional(),
    mainLocations: z.array(z.string())
  }),
  acts: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['setup', 'confrontation', 'resolution']),
    summary: z.string(),
    keyEvents: z.array(z.string()),
    emotionalArc: z.string().optional(),
    estimatedDuration: z.number().optional()
  })),
  suggestedCharacters: z.array(z.object({
    name: z.string(),
    role: z.enum(['protagonist', 'antagonist', 'supporting']),
    description: z.string(),
    personality: z.string().optional(),
    motivation: z.string().optional()
  })).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { rawText, genre, targetLength } = RequestSchema.parse(body)

  const lengthGuide = {
    short: '3-5个场景，总时长约1-2分钟',
    medium: '8-12个场景，总时长约3-5分钟',
    long: '15-20个场景，总时长约8-10分钟'
  }

  try {
    // 从数据库获取提示词模板
    const finalPrompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.OUTLINE_GENERATION,
      {
        storyIdea: rawText,
        targetLength: lengthGuide[targetLength],
        genre: genre ? `3. 故事类型倾向：${genre}` : '3. 根据内容自动判断最合适的故事类型'
      }
    )

    if (!finalPrompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }

    // 使用业务流程配置的模型
    const parsed = await generateJSONForWorkflow<z.infer<typeof OutlineSchema>>('outline_generation', {
      prompt: finalPrompt,
      temperature: 0.8,
      maxRetries: 2
    })

    const outline = OutlineSchema.parse(parsed)

    return {
      success: true,
      outline: {
        id: `outline_${Date.now()}`,
        ...outline,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  } catch (error: unknown) {
    console.error('大纲生成失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '大纲生成失败'
    }
  }
})
