import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
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
    // 从数据库获取提示词模板
    const promptContent = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCENE_VISUAL,
      {
        sceneDescription,
        setting: JSON.stringify(setting),
        style
      }
    )

    // 如果数据库没有配置，使用默认提示词
    const systemInstruction = promptContent?.systemPrompt || buildSceneVisualSystemPrompt()
    const prompt = promptContent?.userPrompt || buildSceneVisualPrompt(sceneDescription, setting, style)

    // 使用业务流程配置的模型
    const result = await generateJSONForWorkflow<SceneVisual>('scene_visual_extraction', {
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
    console.error('[SceneVisual] 提取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '场景画面提取失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})

/**
 * 场景画面系统提示词 (基于飞书文档 2.5.1 优化版)
 */
function buildSceneVisualSystemPrompt(): string {
  return `你是一个专业的场景视觉设计师，擅长将剧本场景转化为详细的视觉描述和文生图提示词。

## 核心任务

分析场景描述，提取关键视觉元素，生成高质量的文生图提示词（imagePrompt），用于 AI 图片生成。

## 分析思路

1. **时空定位**：确定时间（清晨/正午/黄昏/深夜）、地点（室内/室外/具体场所）、季节/天气
2. **视觉元素提取**：
   - 主体元素：场景中最重要的物体/建筑
   - 环境细节：背景、装饰、道具
   - 光影效果：光源方向、明暗对比、色调
3. **氛围营造**：通过色彩、光影、构图传达情绪（温馨/紧张/神秘/悲伤等）
4. **感官细节**：虽然是静态图片，但描述气味、声音等能增强代入感

## 输出格式

{
  "sceneId": "场景ID",
  "time": "具体时间描述（如：深秋傍晚、雨后清晨）",
  "location": "具体地点描述",
  "visualElements": [
    {
      "element": "元素名称",
      "description": "详细描述（颜色、材质、状态）",
      "importance": "primary|secondary|background"
    }
  ],
  "atmosphere": "氛围描述（2-3个关键词）",
  "sensoryDetails": {
    "visual": "视觉细节（光影、色彩）",
    "auditory": "听觉暗示（可选）",
    "olfactory": "嗅觉暗示（可选）"
  },
  "imagePrompt": "完整的文生图提示词（见下方要求）"
}

## imagePrompt 生成要求【重要】

imagePrompt 是最终用于 AI 图片生成的提示词，必须：

1. **结构**：画风 + 场景主体 + 环境细节 + 光影氛围 + 技术参数
2. **长度**：150-250 字（英文）或 200-350 字（中文）
3. **具体性**：每个元素都要有具体描述（颜色、材质、位置）
4. **画面感**：描述要能让人"看到"画面
5. **技术参数**：结尾加上"高清质量，16:9宽屏"

### imagePrompt 示例

示例1（室内温馨）：
"Chinese 2D style, manhua art, 温暖的咖啡厅室内场景，午后阳光透过落地窗洒入，木质地板上形成斑驳光影。靠窗的双人座位，深棕色皮质沙发，桌上放着两杯冒着热气的拿铁咖啡和一块提拉米苏蛋糕。墙上挂着复古风格的装饰画，角落里的绿植盆栽增添生机。整体色调温暖，以棕色、米色、暖黄为主，营造出慵懒惬意的下午茶氛围，高清质量，16:9宽屏"

示例2（室外紧张）：
"Japanese anime style, 深夜的城市小巷，狭窄的巷道两侧是斑驳的砖墙，墙上有涂鸦和褪色的海报。唯一的光源是巷口的路灯，投下长长的阴影。地面有积水反射着微弱的光芒，远处隐约可见霓虹灯的光晕。空气中弥漫着紧张压抑的气氛，色调以深蓝、灰黑为主，偶有红色霓虹点缀，高清质量，16:9宽屏"

示例3（自然场景）：
"2D animation style, 樱花盛开的公园小径，粉白色的花瓣随风飘落，铺满了石板路。两侧是高大的樱花树，枝条交织形成粉色的天幕。远处有一座红色的日式小桥横跨溪流，溪水清澈见底。阳光透过花瓣洒下，形成梦幻的光斑。整体色调粉嫩柔和，充满浪漫春日气息，高清质量，16:9宽屏"

## 注意事项

1. **不要描述具体人物动作**：人物会单独处理，这里只描述场景环境
2. **可以提及人物位置**：如"画面中央留出人物站立的空间"
3. **保持画风一致**：imagePrompt 开头要包含指定的画风
4. **避免敏感内容**：不要包含暴力、血腥等元素`
}

/**
 * 构建场景画面提示词
 */
function buildSceneVisualPrompt(
  sceneDescription: string,
  setting: { location: string, timeOfDay: string, mood?: string, weather?: string },
  style: string
): string {
  return `请分析以下场景，提取视觉元素并生成文生图提示词，输出 JSON 格式：

## 场景描述
${sceneDescription}

## 场景设定
- 地点: ${setting.location}
- 时间: ${setting.timeOfDay}
${setting.mood ? `- 氛围: ${setting.mood}` : ''}
${setting.weather ? `- 天气: ${setting.weather}` : ''}

## 画风
${style}

## 要求
1. 提取 5-8 个关键视觉元素
2. 每个视觉元素要具体、有细节（如"灰色砖墙（顶有薄雪）"）
3. 氛围描述要能引导画面情绪
4. 生成的 imagePrompt 要包含画风、场景、视觉元素、氛围、技术参数
5. 不要包含人物角色描述
6. 请严格按照 JSON 格式输出`
}
