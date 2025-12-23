import { z } from 'zod'
import { getGeminiClient } from '../../utils/gemini'

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
  targetSceneCount: z.number().min(3).max(20).optional().default(8)
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
  duration: z.number(),
  actId: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { outline, characters, targetSceneCount } = RequestSchema.parse(body)

  const client = getGeminiClient()

  // 构建角色信息
  const characterInfo = characters.map(c => {
    let info = `- ${c.name} (${c.role})`
    if (c.personality) info += `：${c.personality}`
    if (c.speakingStyle) info += `，说话风格：${c.speakingStyle}`
    return info
  }).join('\n')

  // 构建幕结构信息
  const actsInfo = outline.acts.map(act => {
    return `### ${act.name} (${act.type})
概要：${act.summary}
关键事件：
${act.keyEvents.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${act.emotionalArc ? `情感走向：${act.emotionalArc}` : ''}`
  }).join('\n\n')

  const prompt = `你是一位专业的漫剧编剧。请根据以下故事大纲和角色设定，生成详细的分场剧本。

## 故事信息
标题：${outline.title}
类型：${outline.genre}
节奏：${outline.pace}
梗概：${outline.synopsis}

## 世界观
${outline.setting.world}
${outline.setting.era ? `时代：${outline.setting.era}` : ''}
主要场景：${outline.setting.mainLocations.join('、')}

## 角色设定
${characterInfo}

## 三幕结构
${actsInfo}

## 要求
1. 生成 ${targetSceneCount} 个场景，均匀分布在三幕中
2. 每个场景包含：
   - 清晰的视觉描述（用于生成图片）
   - 具体的地点和时间
   - 出场角色及其情绪/动作
   - 自然的对话（符合角色性格和说话风格）
3. 场景之间要有连贯性
4. 每个场景时长 6-8 秒
5. 对话要简洁有力，适合漫剧呈现

## 输出格式
请输出 JSON 数组：
[
  {
    "id": "scene_1",
    "title": "场景标题",
    "description": "详细的视觉描述，包括环境、光线、氛围等（100-200字）",
    "setting": {
      "location": "具体地点",
      "timeOfDay": "dawn|morning|noon|afternoon|evening|night",
      "mood": "氛围描述",
      "weather": "天气（可选）"
    },
    "characters": [
      { "name": "角色名", "emotion": "情绪", "action": "动作描述" }
    ],
    "dialogues": [
      { "character": "角色名", "text": "台词内容", "emotion": "情绪" }
    ],
    "duration": 8,
    "actId": "act_1"
  }
]

请直接输出 JSON 数组，不要包含其他内容。`

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
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('无法解析 AI 响应')
    }

    const parsed = JSON.parse(jsonMatch[0])
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
