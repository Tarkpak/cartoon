import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { VolcengineError } from '../../utils/volcengine'
import { imageLimiter } from '../../utils/concurrency'
import { getWorkflowModels } from '../models/workflow.get'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import { normalizeProjectWorkflowType, type ProjectWorkflowType } from '../../../shared/types/project'
import {
  GenerateCharacterRequestSchema,
  type CharacterAsset,
  type Character
} from '../../../shared/types/character'

const SEEDANCE_VIDEO_MODEL_RE = /seedance/i
const LINEART_PROMPT_RE = /(线稿|line\s*art|black\s*and\s*white)/i
const CHARACTER_LINEART_PROMPT_SUFFIX = [
  '【Seedance 参考图规范】',
  '输出必须为黑白线稿（black and white line art），仅保留轮廓线与结构线，不要彩色填充，不要照片质感。',
  '保持角色身份特征与服装轮廓一致，不要新增人物，不要文字和水印。'
].join('\n')

function withCharacterLineartPrompt(prompt: string, enabled: boolean): string {
  if (!enabled) return prompt
  if (LINEART_PROMPT_RE.test(prompt)) return prompt
  return `${prompt}\n\n${CHARACTER_LINEART_PROMPT_SUFFIX}`
}

/**
 * 角色生成 API
 * POST /api/character/generate
 *
 * 生成角色设定图（Character Sheet），一张图包含：
 * - 三视图（正面、侧面、背面）
 * - 多种表情
 * - 服装/配饰细节
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = GenerateCharacterRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { character, style, generateExpressions, workflowType } = parseResult.data
  const normalizedWorkflow = normalizeProjectWorkflowType(workflowType)

  try {
    // 生成角色设定图（一张图包含所有信息）
    console.log(`[CharacterGen] 开始生成角色设定图: ${character.name}`)
    const sheetResult = await generateCharacterSheet(character, style, generateExpressions, normalizedWorkflow)

    // 构建资产对象
    const now = new Date().toISOString()
    const asset: CharacterAsset = {
      characterId: character.id,
      name: character.name,
      baseImage: sheetResult.imageData, // 角色设定图作为基础图
      expressions: {}, // 表情已包含在设定图中
      sheetType: 'full', // 角色设定图类型
      createdAt: now,
      updatedAt: now
    }

    console.log(`[CharacterGen] 角色设定图生成完成: ${character.name}, 耗时: ${Date.now() - startTime}ms, imageData长度: ${sheetResult.imageData?.length || 0}`)

    return {
      success: true,
      asset,
      sheetType: 'character-sheet', // 标识这是角色设定图
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error(`[CharacterGen] 生成失败:`, error)

    // 处理各种 AI 服务商的错误
    if (error instanceof GeminiError || error instanceof QwenError || error instanceof VolcengineError) {
      // 解析错误信息，提供更友好的提示
      let userMessage = error.message
      const errorCode = String((error as GeminiError).code || 'UNKNOWN')

      // 敏感内容检测错误
      if (error.message.includes('sensitive') || errorCode.includes('Sensitive')) {
        userMessage = '输入内容可能包含敏感信息，请修改角色描述后重试'
      } else if (errorCode === 'RESOURCE_EXHAUSTED' || error.message.includes('quota') || error.message.includes('rate limit')) {
        // 配额/限流错误
        userMessage = 'API 调用次数已达上限，请稍后重试'
      } else if (errorCode === 'UNAVAILABLE' || error.message.includes('unavailable')) {
        // 模型不可用
        userMessage = 'AI 服务暂时不可用，请稍后重试'
      }

      throw createError({
        statusCode: (error as GeminiError).status || 500,
        statusMessage: `角色生成失败`,
        message: userMessage
      })
    }

    // 其他未知错误
    throw createError({
      statusCode: 500,
      statusMessage: '角色生成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})

/**
 * 生成角色设定图（Character Sheet）
 * 一张图包含三视图、表情、细节等所有信息
 */
async function generateCharacterSheet(
  character: Character,
  style: string,
  _includeExpressions: boolean,
  workflowType: ProjectWorkflowType
): Promise<{ imageData: string, mimeType: string }> {
  const workflowModels = await getWorkflowModels()
  const modelId = workflowModels.character_portrait
  const useSeedanceLineart = SEEDANCE_VIDEO_MODEL_RE.test(workflowModels.video_generation || '')

  // 从数据库获取提示词模板
  const prompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.CHARACTER_SHEET,
    {
      characterName: character.name,
      appearance: character.appearance,
      style
    },
    undefined,
    workflowType
  )

  if (!prompt) {
    throw new Error('无法获取提示词模板，请检查数据库配置')
  }
  const effectivePrompt = withCharacterLineartPrompt(prompt, useSeedanceLineart)
  console.log(`[CharacterGen] 使用图片模型: ${modelId}`)
  console.log(`[CharacterGen] 视频模型: ${workflowModels.video_generation}, 线稿模式: ${useSeedanceLineart}`)

  const result = await imageLimiter.execute(() =>
    generateImage({
      modelId,
      prompt: effectivePrompt,
      maxRetries: 2
    })
  )

  // 处理返回的 URL 或 base64
  if (result.imageUrl) {
    console.log(`[CharacterGen] 下载图片: ${result.imageUrl.slice(0, 80)}...`)
    try {
      const response = await fetch(result.imageUrl)
      if (!response.ok) {
        console.error(`[CharacterGen] 图片下载失败: ${response.status} ${response.statusText}`)
        // 下载失败时直接返回 URL，让前端处理
        return {
          imageData: result.imageUrl,
          mimeType: 'image/url'
        }
      }
      const buffer = await response.arrayBuffer()
      console.log(`[CharacterGen] 图片下载成功, 大小: ${buffer.byteLength} bytes`)
      return {
        imageData: Buffer.from(buffer).toString('base64'),
        mimeType: 'image/png'
      }
    } catch (fetchError) {
      console.error(`[CharacterGen] 图片下载异常:`, fetchError)
      // 下载失败时直接返回 URL，让前端处理
      return {
        imageData: result.imageUrl,
        mimeType: 'image/url'
      }
    }
  }

  return {
    imageData: result.imageData || '',
    mimeType: result.mimeType || 'image/png'
  }
}
