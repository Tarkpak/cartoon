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

  const prompt = `你是一位专业的编剧和故事架构师。请根据以下故事创意，生成一个完整的故事大纲。

## 故事创意
${rawText}

## 创作要求

### 结构要求
1. 使用经典的三幕结构（铺垫-对抗-解决）
2. 目标长度：${lengthGuide[targetLength]}
${genre ? `3. 故事类型倾向：${genre}` : '3. 根据内容自动判断最合适的故事类型'}

### 内容要求（基于漫剧创作原则）

**内容逻辑**：用「绝境 + 强钩子」戳中人性痛点
- 把主角逼到困境，再抛出能解决问题的强钩子
- 情绪层层递进，用悬念吸引观众

**角色设计**：用「反差感 + 真实感」打造接地气的角色
- 主角要有代入感，性格真实
- 配角要有辨识度，完美还原真实性格

**世界观设定**：
- 场景要有「写实感」，细节强化真实感
- 可以加入「科幻/奇幻反差」增加吸引力

### 角色要求
1. 至少包含 1 个主角
2. 每个角色需要有明确的性格特点和动机
3. 角色描述要具体，便于后续生成角色立绘

## 输出格式
请严格按照以下 JSON 格式输出：

{
  "title": "故事标题（吸引人、有记忆点）",
  "logline": "一句话概括故事（25-50字，包含主角+困境+目标）",
  "synopsis": "故事梗概（200-500字，包含起承转合）",
  "genre": "romance|fantasy|action|comedy|drama|horror|mystery|scifi|slice_of_life",
  "pace": "slow|medium|fast",
  "theme": "故事主题/核心思想（如：成长、救赎、爱情等）",
  "setting": {
    "world": "世界观设定描述（100-200字）",
    "era": "时代背景（如：现代都市、古代仙侠、未来科幻）",
    "mainLocations": ["主要场景1", "主要场景2", "主要场景3"]
  },
  "acts": [
    {
      "id": "act_1",
      "name": "第一幕名称（如：命运的相遇）",
      "type": "setup",
      "summary": "本幕概要（50-100字）：介绍主角、建立世界观、引出核心冲突",
      "keyEvents": ["关键事件1", "关键事件2", "关键事件3"],
      "emotionalArc": "情感走向（如：从平静到好奇）",
      "estimatedDuration": 60
    },
    {
      "id": "act_2",
      "name": "第二幕名称",
      "type": "confrontation",
      "summary": "本幕概要：冲突升级、主角面临挑战、关系发展",
      "keyEvents": ["关键事件1", "关键事件2", "关键事件3", "关键事件4"],
      "emotionalArc": "情感走向（如：从希望到绝望再到转机）",
      "estimatedDuration": 120
    },
    {
      "id": "act_3",
      "name": "第三幕名称",
      "type": "resolution",
      "summary": "本幕概要：高潮、解决冲突、结局",
      "keyEvents": ["关键事件1", "关键事件2"],
      "emotionalArc": "情感走向（如：从紧张到释然）",
      "estimatedDuration": 60
    }
  ],
  "suggestedCharacters": [
    {
      "name": "角色名",
      "role": "protagonist|antagonist|supporting",
      "description": "外貌描述（发型、发色、眼睛、服装风格等，50-100字）",
      "personality": "性格特点（3-5个关键词或短句）",
      "motivation": "角色动机（驱动角色行动的核心原因）"
    }
  ]
}

请直接输出 JSON，不要包含其他内容。`

  try {
    // 从数据库获取提示词模板（已合并系统提示词和用户提示词）
    const finalPrompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.OUTLINE_GENERATION,
      {
        storyIdea: rawText,
        targetLength: lengthGuide[targetLength],
        genre: genre ? `3. 故事类型倾向：${genre}` : '3. 根据内容自动判断最合适的故事类型'
      }
    ) || prompt

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
