import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
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
    // 2. 构建解析提示词
    const systemInstruction = buildSystemPrompt()
    const prompt = buildParsePrompt(text, maxScenes)

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
 * 构建系统提示词 (基于飞书文档 2.2.1 剧本创作提示词优化)
 */
function buildSystemPrompt(): string {
  return `你是一个专业的剧本分析师和编剧助手。你的任务是将小说文本解析为结构化的场景数据，用于生成AI漫剧视频。

## 剧本内容要求 (基于飞书文档)

一、「内容逻辑」：用「绝境 + 强钩子」戳中人性痛点，形成 "爽点闭环"
1. 视频的底层逻辑：把主角逼到 "生存 + 繁衍" 的双重绝境，再抛出一个 "能同时解决两个问题" 的强钩子
2. 绝境铺垫：主角处于一个绝境的环境中
3. 强钩子抛出：剧情能激起观众追剧的欲望
4. 爽点闭环：情绪层层递进，最后用 "未完待续" 留悬念

二、「角色设计」：用「反差感 + 真实感」打造 "接地气的角色"
1. 主角：角色越 "真实" 越有代入感
2. 配角：完美还原真实性格，让观众产生共鸣

三、「视觉风格」：用「写实细节 + 科幻反差」营造 "沉浸式感觉"
1. 场景的 "写实感"：细节要强化真实感
2. 设定的 "科幻反差"：增加科幻/奇幻的场景与要点

## 输出要求

你必须输出有效的 JSON 格式，包含以下结构：

{
  "title": "剧本标题（从文本推断）",
  "scenes": [
    {
      "id": "scene_001",
      "title": "场景标题",
      "description": "场景的视觉描述，用于生成首尾帧图片，要具体、可视化",
      "setting": {
        "location": "具体地点",
        "timeOfDay": "dawn|morning|noon|afternoon|evening|night",
        "mood": "氛围描述",
        "weather": "天气（可选）"
      },
      "characters": [
        {
          "name": "角色名",
          "appearance": "外观描述（发型、服装等，50-100字）",
          "action": "动作描述",
          "emotion": "neutral|happy|sad|angry|surprised|confused|excited|scared|worried|concerned|determined|thoughtful|nervous|relieved|hopeful|disappointed"
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
      "description": "角色详细外貌描述（见下方要求）",
      "role": "protagonist|antagonist|supporting"
    }
  ],
  "totalDuration": 24
}

## 角色外貌描述要求（characters.description 字段）【重要】

每个角色的 description 必须是详细的视觉描述，用于生成角色立绘，需包含：

### 主角（protagonist）：200-300字，必须包含以下所有类别
1. **基础信息**：性别、年龄段、身材体型
2. **面部特征**：脸型、眼睛（颜色+形状）、眉毛、肤色、其他特征（酒窝/痣等）
3. **发型发色**：发色、发型（长度+样式）、刘海、发饰
4. **服装搭配**：上装（款式+颜色+细节）、下装、鞋袜
5. **配饰**：首饰、眼镜等
6. **整体气质**：气质关键词、主色调

### 配角（supporting/antagonist）：100-150字
至少包含：性别年龄、发型发色、服装特点、整体气质

### 示例
- 主角示例："青年女性，约20岁，身材纤细高挑。精致的鹅蛋脸，皮肤白皙，脸颊有淡淡红晕。清澈的深棕色大眼睛，双眼皮，睫毛浓密。柳叶眉，小巧挺直的鼻子，淡粉色嘴唇。一头乌黑亮丽的长直发及腰，斜刘海轻遮右眼。穿白色衬衫配深蓝色高腰A字裙，脚踩棕色小皮鞋。戴银色手表和小巧耳钉。气质清新文艺，主色调白蓝棕。"
- 配角示例："中年男性，约45岁，身材中等。国字脸，戴银框眼镜，两鬓微白的黑色短发。穿深蓝色中山装，气质儒雅稳重。"

## 场景拆分原则

1. **视觉变化**: 当场景地点、时间或主要角色发生变化时，应拆分为新场景
2. **时长控制**: 每个场景 4-8 秒，根据内容复杂度调整
3. **画面可描述**: 场景描述应具体、视觉化，便于 AI 图片生成
4. **情节完整**: 每个场景应有完整的小情节或情感表达

## 对话提取规则 (重要!)

1. **必须提取所有对话**: 文本中所有引号内的内容都是对话，必须提取到 dialogues 数组
2. **识别对话格式**:
   - 中文引号："xxx" 或 「xxx」
   - 英文引号: "xxx" 或 'xxx'
3. **对话归属**: 根据上下文判断对话属于哪个角色
4. **内心独白**: 如果是心理活动而非说出的话，设置 isInnerThought: true
5. **不要遗漏**: 即使场景很短，只要有对话就必须提取

## 角色识别规则【重要】

1. **识别所有有名字的角色**：包括主角、配角，都要加入 characters 数组
2. **识别无名但重要的角色**：如"神秘老人"、"店主"等，用描述性名称
3. **第一人称"我"**：如果是第一人称叙述，"我"也是一个角色，需要根据上下文推断其特征并命名
4. **不要遗漏角色**：场景中出现的所有角色都必须在 characters 数组中有对应条目

## 角色情绪识别

- neutral: 平静、正常
- happy: 高兴、满足、微笑
- sad: 悲伤、难过、沮丧
- angry: 愤怒、生气、不满
- surprised: 惊讶、震惊
- confused: 困惑、疑惑
- excited: 兴奋、激动
- scared: 害怕、恐惧
- worried: 担心、忧虑
- concerned: 关切、担心他人
- determined: 坚定、决心
- thoughtful: 沉思、若有所思
- nervous: 紧张、不安
- relieved: 如释重负、松了口气
- hopeful: 满怀希望、期待
- disappointed: 失望、沮丧

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
