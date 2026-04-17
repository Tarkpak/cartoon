import { z } from 'zod'
import { generateJSON, getSelectedModels } from '../../utils/model-provider'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'

const RequestSchema = z.object({
  outline: z.object({
    title: z.string(),
    synopsis: z.string(),
    genre: z.string(),
    pace: z.string(),
    setting: z.object({
      world: z.string(),
      era: z.string().optional(),
      mainLocations: z.array(z.string())
    }),
    acts: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      summary: z.string(),
      keyEvents: z.array(z.string()),
      emotionalArc: z.string().optional()
    }))
  }),
  characters: z.array(z.object({
    name: z.string(),
    role: z.string(),
    appearance: z.string().optional(),
    personality: z.string().optional(),
    speakingStyle: z.string().optional()
  })),
  targetSceneCount: z.number().min(3).max(20).optional().default(8),
  style: z.string().optional().default('默认画风')
})

const SceneSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  setting: z.object({
    location: z.string(),
    timeOfDay: z.enum(['dawn', 'morning', 'noon', 'afternoon', 'evening', 'night']),
    mood: z.string().optional(),
    weather: z.string().optional()
  }),
  characters: z.array(z.object({
    name: z.string(),
    emotion: z.string().optional(),
    action: z.string().optional()
  })),
  dialogues: z.array(z.object({
    character: z.string(),
    text: z.string(),
    emotion: z.string().optional()
  })),
  narration: z.string().nullable().optional(),
  duration: z.number(),
  actId: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { outline, characters, targetSceneCount, style } = RequestSchema.parse(body)

  // 构建角色信息（包含外貌描述，用于场景描述中保持一致性）
  const characterInfo = characters.map((c) => {
    let info = `- ${c.name} (${c.role})`
    if (c.appearance) info += `\n  外貌：${c.appearance}`
    if (c.personality) info += `\n  性格：${c.personality}`
    if (c.speakingStyle) info += `\n  说话风格：${c.speakingStyle}`
    return info
  }).join('\n')

  try {
    // 从数据库获取提示词模板
    const finalPrompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCENE_GENERATION,
      {
        outline: JSON.stringify(outline),
        characters: characterInfo,
        targetSceneCount: String(targetSceneCount),
        style: style
      }
    )

    if (!finalPrompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }

    const selectedModels = getSelectedModels()
    const parsed = await generateJSON<z.infer<typeof SceneSchema>[]>({
      modelId: selectedModels.text,
      prompt: finalPrompt,
      temperature: 0.8,
      maxRetries: 2
    })

    const scenes = z.array(SceneSchema).parse(parsed)

    // 计算总时长
    const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0)

    return {
      success: true,
      scenes,
      totalDuration,
      sceneCount: scenes.length
    }
  } catch (error: unknown) {
    console.error('场景生成失败:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '场景生成失败',
      scenes: []
    }
  }
})
