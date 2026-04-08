import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import {
  ParseScriptRequestSchema,
  ParsedScriptSchema,
  type ParsedScript
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

  const { text } = parseResult.data

  try {
    // 2. 从数据库获取提示词模板
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCRIPT_PARSING,
      {
        novelText: text,
        style: '默认画风' // 剧本解析阶段可能还没有画风设置
      }
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
3. 若同一场景包含多个动作转折、情绪转折或叙事跳跃，必须拆分成连续多个场景。`

    // 3. 使用业务流程配置的模型解析
    const result = await generateJSONForWorkflow<ParsedScript>('script_parsing', {
      prompt: promptWithNarration,
      temperature: 0.3,
      maxRetries: 2
    })

    // 4. 验证输出格式
    const validated = ParsedScriptSchema.safeParse(result)
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
