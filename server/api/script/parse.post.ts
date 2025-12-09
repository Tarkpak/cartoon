import { generateJSON, TextModels, GeminiError } from '../../utils/gemini'
import {
  ParseScriptRequestSchema,
  ParsedScriptSchema,
  type ParsedScript,
  type Scene,
} from '../../../shared/types/script'

/**
 * 剧本解析 API
 * POST /api/script/parse
 * 
 * 使用 Gemini 3 Pro 智能解析小说文本，自动提取场景、角色、对话
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = ParseScriptRequestSchema.safeParse(body)
  
  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', '),
    })
  }

  const { text, maxScenes } = parseResult.data

  try {
    // 2. 构建解析提示词
    const systemInstruction = buildSystemPrompt()
    const prompt = buildParsePrompt(text, maxScenes)

    // 3. 调用 Gemini 解析
    const result = await generateJSON<ParsedScript>({
      model: TextModels.SCRIPT_PARSER,
      prompt,
      systemInstruction,
      temperature: 0.3, // 较低温度保证输出稳定
      maxRetries: 2,
    })

    // 4. 验证输出格式
    const validated = ParsedScriptSchema.safeParse(result)
    if (!validated.success) {
      console.error('[ScriptParse] 输出格式验证失败:', validated.error)
      // 尝试修复常见问题
      const fixed = fixParsedResult(result)
      const revalidated = ParsedScriptSchema.safeParse(fixed)
      if (!revalidated.success) {
        throw createError({
          statusCode: 500,
          statusMessage: '解析结果格式错误',
          message: revalidated.error.issues.map(i => `${i.path}: ${i.message}`).join(', '),
        })
      }
      return {
        success: true,
        data: revalidated.data,
        latencyMs: Date.now() - startTime,
      }
    }

    return {
      success: true,
      data: validated.data,
      latencyMs: Date.now() - startTime,
    }
  }
  catch (error) {
    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `剧本解析失败: ${error.code}`,
        message: error.message,
      })
    }
    throw error
  }
})

/**
 * 构建系统提示词
 */
function buildSystemPrompt(): string {
  return `你是一个专业的剧本分析师和编剧助手。你的任务是将小说文本解析为结构化的场景数据，用于生成AI漫剧视频。

## 输出要求

你必须输出有效的 JSON 格式，包含以下结构：

{
  "title": "剧本标题（从文本推断）",
  "scenes": [
    {
      "id": "scene_001",
      "title": "场景标题",
      "description": "场景的视觉描述，用于生成首尾帧图片",
      "setting": {
        "location": "具体地点",
        "timeOfDay": "dawn|morning|noon|afternoon|evening|night",
        "mood": "氛围描述",
        "weather": "天气（可选）"
      },
      "characters": [
        {
          "name": "角色名",
          "appearance": "外观描述",
          "action": "动作描述",
          "emotion": "neutral|happy|sad|angry|surprised|confused|excited|scared"
        }
      ],
      "dialogues": [
        {
          "character": "角色名",
          "text": "对话内容",
          "emotion": "情绪",
          "isInnerThought": false
        }
      ],
      "duration": 8,
      "narration": "旁白（可选）"
    }
  ],
  "characters": [
    {
      "name": "角色名",
      "description": "角色描述",
      "role": "protagonist|antagonist|supporting"
    }
  ],
  "totalDuration": 24
}

## 场景拆分原则

1. **视觉变化**: 当场景地点、时间或主要角色发生变化时，应拆分为新场景
2. **时长控制**: 每个场景 4-8 秒，根据内容复杂度调整
3. **画面可描述**: 场景描述应具体、视觉化，便于 AI 图片生成
4. **情节完整**: 每个场景应有完整的小情节或情感表达

## 角色情绪识别

- neutral: 平静、正常
- happy: 高兴、满足、微笑
- sad: 悲伤、难过、沮丧
- angry: 愤怒、生气、不满
- surprised: 惊讶、震惊
- confused: 困惑、疑惑
- excited: 兴奋、激动
- scared: 害怕、恐惧

## 内心独白处理

当文本包含角色内心想法时（通常用引号或特定描述表示），将 isInnerThought 设为 true。`
}

/**
 * 构建解析提示词
 */
function buildParsePrompt(text: string, maxScenes: number): string {
  return `请解析以下小说文本，提取不超过 ${maxScenes} 个场景：

---
${text}
---

请严格按照系统提示中的 JSON 格式输出解析结果。确保：
1. 每个场景的 id 格式为 scene_001, scene_002 等
2. 所有情绪值都是有效的枚举值
3. 时间段 (timeOfDay) 是有效的枚举值
4. 角色角色 (role) 是有效的枚举值
5. 场景时长在 4-8 秒之间
6. totalDuration 等于所有场景时长之和`
}

/**
 * 修复常见的解析问题
 */
function fixParsedResult(result: unknown): ParsedScript {
  const data = result as Record<string, unknown>
  
  // 确保 scenes 是数组
  let scenes = Array.isArray(data.scenes) ? data.scenes : []
  
  // 修复每个场景
  scenes = scenes.map((scene: Record<string, unknown>, index: number) => {
    return {
      id: scene.id || `scene_${String(index + 1).padStart(3, '0')}`,
      title: scene.title || `场景 ${index + 1}`,
      description: scene.description || '',
      setting: fixSetting(scene.setting),
      characters: Array.isArray(scene.characters) 
        ? scene.characters.map(fixCharacter)
        : [],
      dialogues: Array.isArray(scene.dialogues) 
        ? scene.dialogues.map(fixDialogue)
        : [],
      duration: typeof scene.duration === 'number' 
        ? Math.min(8, Math.max(4, scene.duration))
        : 8,
      narration: scene.narration,
    }
  }) as Scene[]

  // 提取所有角色
  const characterNames = new Set<string>()
  scenes.forEach((scene: Scene) => {
    scene.characters.forEach(c => characterNames.add(c.name))
  })

  const characters = Array.isArray(data.characters) 
    ? data.characters 
    : Array.from(characterNames).map(name => ({
        name,
        description: '',
        role: 'supporting' as const,
      }))

  // 计算总时长
  const totalDuration = scenes.reduce((sum: number, s: Scene) => sum + s.duration, 0)

  return {
    title: data.title as string || undefined,
    scenes,
    characters,
    totalDuration,
  }
}

function fixSetting(setting: unknown): { location: string; timeOfDay: string; mood?: string; weather?: string } {
  const s = (setting || {}) as Record<string, unknown>
  const validTimeOfDay = ['dawn', 'morning', 'noon', 'afternoon', 'evening', 'night']
  
  return {
    location: String(s.location || '未知地点'),
    timeOfDay: validTimeOfDay.includes(String(s.timeOfDay)) 
      ? String(s.timeOfDay) 
      : 'morning',
    mood: s.mood ? String(s.mood) : undefined,
    weather: s.weather ? String(s.weather) : undefined,
  }
}

function fixCharacter(char: unknown): { name: string; appearance?: string; action?: string; emotion?: string } {
  const c = (char || {}) as Record<string, unknown>
  const validEmotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'excited', 'scared']
  
  return {
    name: String(c.name || '未知角色'),
    appearance: c.appearance ? String(c.appearance) : undefined,
    action: c.action ? String(c.action) : undefined,
    emotion: validEmotions.includes(String(c.emotion)) 
      ? String(c.emotion) 
      : undefined,
  }
}

function fixDialogue(dialogue: unknown): { character: string; text: string; emotion?: string; isInnerThought?: boolean } {
  const d = (dialogue || {}) as Record<string, unknown>
  const validEmotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'excited', 'scared']
  
  return {
    character: String(d.character || '未知'),
    text: String(d.text || ''),
    emotion: validEmotions.includes(String(d.emotion)) 
      ? String(d.emotion) 
      : undefined,
    isInnerThought: Boolean(d.isInnerThought),
  }
}
