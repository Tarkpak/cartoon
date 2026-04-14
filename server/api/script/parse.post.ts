import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import {
  ParseScriptRequestSchema,
  ParsedScriptSchema,
  type ParsedScript
} from '../../../shared/types/script'

const SCRIPT_MIN_DURATION = 2
const SCRIPT_MAX_DURATION = 15
const DEFAULT_SCENE_DURATION = 8
const DEFAULT_TIME_OF_DAY = 'morning'
const VALID_TIME_OF_DAY = new Set([
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'evening',
  'night'
])

function normalizeSceneDuration(rawDuration: unknown): number {
  const numericDuration = typeof rawDuration === 'number'
    ? rawDuration
    : typeof rawDuration === 'string'
      ? Number(rawDuration)
      : Number.NaN

  if (!Number.isFinite(numericDuration)) return DEFAULT_SCENE_DURATION

  const clamped = Math.min(SCRIPT_MAX_DURATION, Math.max(SCRIPT_MIN_DURATION, numericDuration))
  return Math.round(clamped * 2) / 2
}

function normalizeTimeOfDay(rawTimeOfDay: unknown): string {
  if (typeof rawTimeOfDay !== 'string') return DEFAULT_TIME_OF_DAY

  const value = rawTimeOfDay.trim().toLowerCase()
  if (!value) return DEFAULT_TIME_OF_DAY
  if (VALID_TIME_OF_DAY.has(value)) return value

  if (/none|null|unknown|n\/a|na|unspecified|未指定|未知|无/.test(value)) return DEFAULT_TIME_OF_DAY

  if (/dawn|sunrise|break of day|拂晓|黎明|凌晨/.test(value)) return 'dawn'
  if (/morning|am|forenoon|清晨|早晨|早上|上午/.test(value)) return 'morning'
  if (/noon|midday|中午|正午/.test(value)) return 'noon'
  if (/afternoon|pm|下午/.test(value)) return 'afternoon'
  if (/evening|sunset|dusk|傍晚|黄昏|日落/.test(value)) return 'evening'
  if (/night|midnight|深夜|夜晚|晚上|午夜/.test(value)) return 'night'

  return DEFAULT_TIME_OF_DAY
}

function normalizeParsedScriptOutput(output: unknown): unknown {
  let parsedObject: Record<string, unknown>

  if (Array.isArray(output)) {
    const firstItem = output[0]
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem) && 'scenes' in firstItem) {
      parsedObject = firstItem as Record<string, unknown>
    } else {
      parsedObject = { scenes: output, characters: [] }
    }
  } else if (output && typeof output === 'object') {
    parsedObject = output as Record<string, unknown>
  } else {
    return output
  }

  const rawScenes = Array.isArray(parsedObject.scenes) ? parsedObject.scenes : []
  const normalizedScenes = rawScenes.map((scene, index) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return scene
    const sceneObj = scene as Record<string, unknown>
    const rawSetting = sceneObj.setting && typeof sceneObj.setting === 'object' && !Array.isArray(sceneObj.setting)
      ? sceneObj.setting as Record<string, unknown>
      : {}
    const location = typeof rawSetting.location === 'string' && rawSetting.location.trim().length > 0
      ? rawSetting.location
      : '未知地点'
    return {
      ...sceneObj,
      id: typeof sceneObj.id === 'string' && sceneObj.id.trim().length > 0
        ? sceneObj.id
        : `scene_${String(index + 1).padStart(3, '0')}`,
      duration: normalizeSceneDuration(sceneObj.duration),
      setting: {
        ...rawSetting,
        location,
        timeOfDay: normalizeTimeOfDay(rawSetting.timeOfDay)
      }
    }
  })

  const totalDuration = normalizedScenes.reduce((sum, scene) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return sum
    const duration = (scene as Record<string, unknown>).duration
    return sum + (typeof duration === 'number' && Number.isFinite(duration) ? duration : DEFAULT_SCENE_DURATION)
  }, 0)

  return {
    ...parsedObject,
    scenes: normalizedScenes,
    characters: Array.isArray(parsedObject.characters) ? parsedObject.characters : [],
    totalDuration: Math.round(totalDuration * 10) / 10
  }
}

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

  const { text, workflowType, style } = parseResult.data
  const normalizedWorkflow = normalizeProjectWorkflowType(workflowType)

  try {
    // 2. 从数据库获取提示词模板
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCRIPT_PARSING,
      {
        novelText: text,
        style: style?.trim() || '默认画风'
      },
      undefined,
      normalizedWorkflow
    )

    if (!prompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }

    const textLength = text.trim().length
    let recommendedMinScenes = 6
    if (textLength > 3200) recommendedMinScenes = 20
    else if (textLength > 2400) recommendedMinScenes = 16
    else if (textLength > 1600) recommendedMinScenes = 12
    else if (textLength > 900) recommendedMinScenes = 8

    // 兜底约束：确保旁白不丢失（兼容旧模板未显式要求 narration 字段的情况）
    const promptWithNarration = `${prompt}

【补充约束 - narration 字段】
1. 场景中的旁白/画外音/内心独白需要输出到 scenes[i].narration（字符串或 null）。
2. dialogues 仅保留真实角色台词，不要把“旁白”作为角色写入 dialogues。
3. 若某场景无旁白，narration 返回 null 或空字符串。

【补充约束 - 剧情覆盖与场景密度】
1. 必须覆盖输入文本的完整主线，不要省略关键事件和关键旁白信息。
2. 本次输入文本长度约 ${textLength} 字，场景数量不少于 ${recommendedMinScenes} 场。
3. 若同一场景包含多个动作转折、情绪转折或叙事跳跃，必须拆分成连续多个场景。
4. 每个场景的 duration 必须是数字，且在 ${SCRIPT_MIN_DURATION}-${SCRIPT_MAX_DURATION} 秒之间。
5. totalDuration 必须严格等于所有 scenes[i].duration 的总和。
6. scenes[i].setting.timeOfDay 只能是 dawn、morning、noon、afternoon、evening、night 之一，严禁输出 none/unknown/day。

【补充约束 - 主环境风格一致性】
1. 同一主环境（如“医院”“学校”“警局”）在不同子空间（如“走廊”“办公室”“病房”）必须保持同一建筑年代、装修档次、材质语言和维护状态。
2. 除非原文明确写出“翻修区/废弃区/新旧分区”，禁止输出冲突风格（例如同一医院里“走廊豪华现代”但“办公室破旧老化”）。
3. setting.location 请优先使用“主环境-子空间”或“主环境/子空间”的中性命名，不要把“豪华、破旧、现代、老旧”等风格形容词写进地点名。`

    // 3. 使用业务流程配置的模型解析
    const result = await generateJSONForWorkflow<ParsedScript>('script_parsing', {
      prompt: promptWithNarration,
      temperature: 0.3,
      maxRetries: 2
    })

    // 4. 归一化并验证输出格式
    const normalizedResult = normalizeParsedScriptOutput(result)
    const validated = ParsedScriptSchema.safeParse(normalizedResult)
    if (!validated.success) {
      console.error('[ScriptParse] 输出格式验证失败:', validated.error)
      throw createError({
        statusCode: 500,
        statusMessage: '解析结果格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
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
