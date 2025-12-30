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

  // 构建角色信息（包含外貌描述，用于场景描述中保持一致性）
  const characterInfo = characters.map(c => {
    let info = `- ${c.name} (${c.role})`
    if (c.appearance) info += `\n  外貌：${c.appearance}`
    if (c.personality) info += `\n  性格：${c.personality}`
    if (c.speakingStyle) info += `\n  说话风格：${c.speakingStyle}`
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

## 角色设定（重要：场景描述中出现角色时，必须使用这里的外貌描述）
${characterInfo}

## 三幕结构
${actsInfo}

## 场景生成要求

### 数量和分布
- 生成 ${targetSceneCount} 个场景
- 第一幕（铺垫）：约 ${Math.floor(targetSceneCount * 0.25)} 个场景
- 第二幕（对抗）：约 ${Math.floor(targetSceneCount * 0.5)} 个场景
- 第三幕（解决）：约 ${Math.ceil(targetSceneCount * 0.25)} 个场景

### 视觉描述要求（用于 AI 图片生成）
1. 每个场景的 description 必须是具体、可视化的画面描述
2. 包含：环境细节、光线效果、色调氛围、角色位置和姿态
3. 角色出现时，必须包含其外貌特征（参考上方角色设定）
4. 描述长度：100-200字

### 对话要求
1. 对话要简洁有力，每句不超过20字
2. 符合角色性格和说话风格
3. 推动剧情发展，避免废话
4. 每个场景 1-3 句对话为宜

### 场景连贯性
1. 场景之间要有逻辑连接
2. 时间线要清晰
3. 角色情绪变化要自然

## 输出格式
请输出 JSON 数组：
[
  {
    "id": "scene_1",
    "title": "场景标题（简短概括）",
    "description": "详细的视觉描述，包括环境、光线、氛围、角色外貌和动作等（100-200字）",
    "setting": {
      "location": "具体地点",
      "timeOfDay": "dawn|morning|noon|afternoon|evening|night",
      "mood": "氛围描述（如：紧张、温馨、神秘）",
      "weather": "天气（可选）"
    },
    "characters": [
      { "name": "角色名", "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined", "action": "具体动作描述" }
    ],
    "dialogues": [
      { "character": "角色名", "text": "台词内容（简洁有力）", "emotion": "情绪" }
    ],
    "duration": 6,
    "actId": "act_1|act_2|act_3"
  }
]

请直接输出 JSON 数组，不要包含其他内容。`

  try {
    // 从数据库获取提示词模板
    const promptContent = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCENE_GENERATION,
      {
        outline: JSON.stringify(outline),
        characters: characterInfo,
        targetSceneCount: String(targetSceneCount)
      }
    )

    // 如果数据库有配置，使用数据库的提示词；否则使用默认提示词
    const finalPrompt = promptContent?.userPrompt || prompt

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
