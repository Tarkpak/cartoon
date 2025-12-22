import { generateJSON, TextModels, GeminiError } from '../../utils/gemini'
import {
  ExtractSceneVisualRequestSchema,
  SceneVisualSchema,
  type SceneVisual
} from '../../../shared/types/scene-visual'

/**
 * 场景画面提取 API
 * POST /api/scene/visual
 *
 * 基于飞书文档 2.5 的场景画面创作流程
 * 从场景描述中提取视觉元素，生成文生图提示词
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  const body = await readBody(event)
  const parseResult = ExtractSceneVisualRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { sceneId, sceneDescription, setting, style } = parseResult.data

  try {
    const systemInstruction = buildSceneVisualSystemPrompt()
    const prompt = buildSceneVisualPrompt(sceneDescription, setting, style)

    const result = await generateJSON<SceneVisual>({
      model: TextModels.SCRIPT_PARSER,
      prompt,
      systemInstruction,
      temperature: 0.4,
      maxRetries: 2
    })

    // 补充 sceneId
    result.sceneId = sceneId

    const validated = SceneVisualSchema.safeParse(result)
    if (!validated.success) {
      throw createError({
        statusCode: 500,
        statusMessage: '场景画面格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
    }

    return {
      success: true,
      data: validated.data,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `场景画面提取失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 场景画面系统提示词 (基于飞书文档 2.5.1)
 */
function buildSceneVisualSystemPrompt(): string {
  return `你是一个场景提取大师，善于将用户输入的剧本，提取出各个镜头的场景画面，并输出场景画面的文生图提示词。

## 分析思路

我会按照以下逻辑处理：
1. 拆解场景核心信息：时间（清晨/深夜）、地点（老巷/海边悬崖/医院走廊）、空间类型（封闭/开放）
2. 提取关键视觉元素：建筑/道具（旧报刊亭、藤编桌、手术灯）、自然/人文景观（梧桐树影、海浪礁石、褪色墙皮）
3. 捕捉氛围与情绪：静谧怀旧/紧张压抑/温暖治愈（通过光线、气味、声音等细节强化）
4. 补充感官细节（虽图片无声音，但能增强画面代入感）：比如"咸湿海风""豆浆香气"
5. 优化提示词结构：用「核心场景 + 视觉元素 + 氛围情绪 + 技术风格」的公式

## 输出格式

{
  "sceneId": "场景ID",
  "time": "深冬傍晚（雪后）",
  "location": "老北京胡同四合院",
  "visualElements": [
    "灰色砖墙（顶有薄雪）",
    "朱红门环（挂冰棱）",
    "枣树下的掉漆二八大杠",
    "车把上的保温桶（糖炒栗子香）",
    "暖黄窗光（玻璃白雾）",
    "屋内擦桌子的人影"
  ],
  "atmosphere": "温暖怀旧、烟火气、雪后的清冽感",
  "sensoryDetails": "糖炒栗子的香气、雪后的清冽空气、远处的叫卖声",
  "imagePrompt": "日式动漫风格，深冬傍晚雪后的老北京胡同四合院，灰色砖墙顶部覆盖薄雪，朱红色门环上挂着冰棱，枣树下停着一辆掉漆的二八大杠自行车，车把上挂着保温桶，暖黄色的窗光透过白雾玻璃，屋内隐约可见擦桌子的人影，温暖怀旧的烟火气氛围，高清质量，16:9宽屏"
}

## 限制

1. 场景描述中不包含人物角色的内容（人物单独处理）
2. 提示词要具体、可视化，便于 AI 图片生成
3. 视觉元素要丰富但不杂乱
4. 氛围描述要能引导画面情绪`
}

/**
 * 构建场景画面提示词
 */
function buildSceneVisualPrompt(
  sceneDescription: string,
  setting: { location: string, timeOfDay: string, mood?: string, weather?: string },
  style?: string
): string {
  return `请分析以下场景，提取视觉元素并生成文生图提示词：

## 场景描述
${sceneDescription}

## 场景设定
- 地点: ${setting.location}
- 时间: ${setting.timeOfDay}
${setting.mood ? `- 氛围: ${setting.mood}` : ''}
${setting.weather ? `- 天气: ${setting.weather}` : ''}

## 画风
${style || '日式动漫'}

## 要求
1. 提取 5-8 个关键视觉元素
2. 每个视觉元素要具体、有细节（如"灰色砖墙（顶有薄雪）"）
3. 氛围描述要能引导画面情绪
4. 生成的 imagePrompt 要包含画风、场景、视觉元素、氛围、技术参数
5. 不要包含人物角色描述`
}
