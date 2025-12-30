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
    // 从数据库获取提示词模板（已合并系统提示词和用户提示词）
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCENE_VISUAL,
      {
        sceneDescription,
        setting: JSON.stringify(setting),
        style
      }
    ) || buildSceneVisualPrompt(sceneDescription, setting, style)

    // 不再需要单独的系统提示词
    const systemInstruction = undefined

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
 * 构建场景画面提示词（备用默认值）
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
