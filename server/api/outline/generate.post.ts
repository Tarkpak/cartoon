import { z } from 'zod'
import { getGeminiClient } from '../../utils/gemini'

const RequestSchema = z.object({
  rawText: z.string().min(50),
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

  const client = getGeminiClient()

  const lengthGuide = {
    short: '3-5个场景，总时长约1-2分钟',
    medium: '8-12个场景，总时长约3-5分钟',
    long: '15-20个场景，总时长约8-10分钟'
  }

  const prompt = `你是一位专业的编剧和故事架构师。请根据以下故事创意，生成一个完整的故事大纲。

## 故事创意
${rawText}

## 要求
1. 使用经典的三幕结构（铺垫-对抗-解决）
2. 目标长度：${lengthGuide[targetLength]}
${genre ? `3. 故事类型倾向：${genre}` : '3. 根据内容自动判断最合适的故事类型'}
4. 每一幕需要有明确的关键事件和情感走向
5. 提取或创建主要角色，包括他们的性格和动机

## 输出格式
请严格按照以下 JSON 格式输出：

{
  "title": "故事标题",
  "logline": "一句话概括故事（25-50字）",
  "synopsis": "故事梗概（200-500字）",
  "genre": "romance|fantasy|action|comedy|drama|horror|mystery|scifi|slice_of_life",
  "pace": "slow|medium|fast",
  "theme": "故事主题/核心思想",
  "setting": {
    "world": "世界观设定描述",
    "era": "时代背景",
    "mainLocations": ["主要场景1", "主要场景2", "主要场景3"]
  },
  "acts": [
    {
      "id": "act_1",
      "name": "第一幕名称",
      "type": "setup",
      "summary": "本幕概要（50-100字）",
      "keyEvents": ["关键事件1", "关键事件2", "关键事件3"],
      "emotionalArc": "情感走向描述",
      "estimatedDuration": 60
    },
    {
      "id": "act_2",
      "name": "第二幕名称",
      "type": "confrontation",
      "summary": "本幕概要",
      "keyEvents": ["关键事件1", "关键事件2", "关键事件3", "关键事件4"],
      "emotionalArc": "情感走向描述",
      "estimatedDuration": 120
    },
    {
      "id": "act_3",
      "name": "第三幕名称",
      "type": "resolution",
      "summary": "本幕概要",
      "keyEvents": ["关键事件1", "关键事件2"],
      "emotionalArc": "情感走向描述",
      "estimatedDuration": 60
    }
  ],
  "suggestedCharacters": [
    {
      "name": "角色名",
      "role": "protagonist|antagonist|supporting",
      "description": "外貌和基本描述",
      "personality": "性格特点",
      "motivation": "角色动机"
    }
  ]
}

请直接输出 JSON，不要包含其他内容。`

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.8
      }
    })

    const text = response.text || ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('无法解析 AI 响应')
    }

    const parsed = JSON.parse(jsonMatch[0])
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
