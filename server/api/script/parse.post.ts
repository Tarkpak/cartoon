import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import {
  ParseScriptRequestSchema,
  ParsedScriptSchema,
  type ParsedScript,
  type Scene
} from '../../../shared/types/script'

/**
 * 剧本解析 API
 * POST /api/script/parse
 *
 * 使用业务流程配置的模型智能解析小说文本，自动提取场景、角色、对话
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
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { text, maxScenes } = parseResult.data

  try {
    // 2. 从数据库获取提示词模板（已合并系统提示词和用户提示词）
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCRIPT_PARSING,
      {
        novelText: text,
        style: '默认画风' // 剧本解析阶段可能还没有画风设置
      }
    ) || buildParsePrompt(text, maxScenes)

    // 不再需要单独的系统提示词
    const systemInstruction = undefined

    // 3. 使用业务流程配置的模型解析
    const result = await generateJSONForWorkflow<ParsedScript>('script_parsing', {
      prompt,
      systemInstruction,
      temperature: 0.3,
      maxRetries: 2
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
          message: revalidated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
        })
      }
      return {
        success: true,
        data: revalidated.data,
        latencyMs: Date.now() - startTime
      }
    }

    return {
      success: true,
      data: validated.data,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    if (error instanceof GeminiError || error instanceof QwenError) {
      const err = error as { status?: number, code?: string, message?: string }
      throw createError({
        statusCode: err.status || 500,
        statusMessage: `剧本解析失败: ${err.code}`,
        message: err.message || '未知错误'
      })
    }
    throw error
  }
})

/**
 * 构建解析提示词（备用默认值）
 */
function buildParsePrompt(text: string, maxScenes: number): string {
  return `请解析以下小说文本，提取不超过 ${maxScenes} 个场景：

---
${text}
---

请严格按照系统提示中的 JSON 格式输出解析结果。确保：

## 基本要求
1. 每个场景的 id 格式为 scene_001, scene_002 等
2. 所有情绪值都是有效的枚举值
3. 时间段 (timeOfDay) 是有效的枚举值
4. 角色类型 (role) 是有效的枚举值
5. 场景时长在 4-8 秒之间
6. totalDuration 等于所有场景时长之和

## 对话提取【重要】
必须提取文本中所有的对话内容到 dialogues 数组，包括：
- 引号内的对话 (如 "xxx" 或 "xxx")
- 说话动作后的内容 (如 xxx说道："...")
- 每条对话必须包含 character(说话人)、text(台词)、emotion(情绪)字段

## 角色描述【非常重要】
characters 数组中每个角色的 description 字段必须是详细的外貌描述：
- **主角**：200-300字，包含性别年龄、脸型肤色、眼睛特征、发型发色、服装搭配、配饰、整体气质
- **配角**：100-150字，至少包含性别年龄、发型发色、服装特点、气质

如果原文没有详细描述角色外貌，请根据角色性格、身份、故事背景合理推断设计。
禁止使用"普通""一般"等模糊词汇，必须给出具体的视觉特征。

## 角色识别
- 识别所有有名字的角色
- 第一人称"我"也是角色，需要命名并描述
- 场景中出现的角色必须在 characters 数组中有对应条目`
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
      narration: scene.narration ? String(scene.narration) : undefined
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
        role: 'supporting' as const
      }))

  // 计算总时长
  const totalDuration = scenes.reduce((sum: number, s: Scene) => sum + s.duration, 0)

  return {
    title: data.title as string || undefined,
    scenes,
    characters,
    totalDuration
  }
}

function fixSetting(setting: unknown): { location: string, timeOfDay: string, mood?: string, weather?: string } {
  const s = (setting || {}) as Record<string, unknown>
  const validTimeOfDay = ['dawn', 'morning', 'noon', 'afternoon', 'evening', 'night']

  return {
    location: String(s.location || '未知地点'),
    timeOfDay: validTimeOfDay.includes(String(s.timeOfDay))
      ? String(s.timeOfDay)
      : 'morning',
    mood: s.mood ? String(s.mood) : undefined,
    weather: s.weather ? String(s.weather) : undefined
  }
}

function fixCharacter(char: unknown): { name: string, appearance?: string, action?: string, emotion?: string } {
  const c = (char || {}) as Record<string, unknown>
  const validEmotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'excited', 'scared', 'worried', 'concerned', 'determined', 'thoughtful', 'nervous', 'relieved', 'hopeful', 'disappointed']

  return {
    name: String(c.name || '未知角色'),
    appearance: c.appearance ? String(c.appearance) : undefined,
    action: c.action ? String(c.action) : undefined,
    emotion: validEmotions.includes(String(c.emotion))
      ? String(c.emotion)
      : undefined
  }
}

function fixDialogue(dialogue: unknown): { character: string, text: string, emotion?: string, isInnerThought?: boolean } {
  const d = (dialogue || {}) as Record<string, unknown>
  const validEmotions = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'confused', 'excited', 'scared', 'worried', 'concerned', 'determined', 'thoughtful', 'nervous', 'relieved', 'hopeful', 'disappointed']

  return {
    character: String(d.character || '未知'),
    text: String(d.text || ''),
    emotion: validEmotions.includes(String(d.emotion))
      ? String(d.emotion)
      : undefined,
    isInnerThought: Boolean(d.isInnerThought)
  }
}
