import { findImageModel, generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { VolcengineError } from '../../utils/volcengine'
import { imageLimiter } from '../../utils/concurrency'
import { getWorkflowModels, getWorkflowModelOptions } from '../models/workflow.get'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { persistImageToPublic } from '../../utils/image-storage'
import { db, characters as charactersTable } from '../../db'
import { eq } from 'drizzle-orm'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import {
  GenerateCharacterRequestSchema,
  type CharacterAsset,
  type Character
} from '../../../shared/types/character'

interface CharacterRegenerationOptions {
  customPrompt?: string
  referenceImage?: string
}

const CHARACTER_GENDER_PROMPT_MAP: Record<string, string> = {
  male: '男性。必须呈现明确男性特征，不要女性化脸部、身形或服装轮廓。',
  female: '女性。必须呈现明确女性特征，不要男性化脸部、身形或服装轮廓。',
  other: '其他。按外貌描述保持中性或指定的性别呈现，不要擅自改成男性或女性模板。'
}

const CHARACTER_SHEET_ASPECT_RATIO = '16:9'

function resolveCharacterSheetSize(provider?: string): string {
  if (provider === 'qwen') return '1664*928'
  if (provider === 'volcengine') return '2560x1440'
  if (provider === 'custom_openai') return '1792x1024'
  return '1536*864'
}

function resolveCharacterGenderPrompt(gender?: string) {
  return CHARACTER_GENDER_PROMPT_MAP[gender || '']
    || '未明确。请仅依据外貌描述中的性别、年龄和身份线索生成，不要随机反转性别呈现。'
}

interface NormalizedReferenceImage {
  geminiReference: {
    data: string
    mimeType: string
  }
  providerReference: string
}

function looksLikeBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return 'image/png'
  if (
    buffer.length >= 6
    && buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
  ) return 'image/gif'
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) return 'image/webp'
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  return 'image/png'
}

function normalizeImageMimeType(value?: string): string | null {
  const normalized = (value || '').split(';')[0]?.trim().toLowerCase()
  if (!normalized?.startsWith('image/')) return null
  return normalized
}

function parseDataUri(value: string): { mimeType: string, data: string } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (!match?.[1] || !match[2]) return null
  return {
    mimeType: match[1],
    data: match[2].replace(/\s+/g, '')
  }
}

async function normalizeReferenceImageInput(source: string): Promise<NormalizedReferenceImage> {
  const raw = source.trim()
  if (!raw) {
    throw new Error('参考图为空，无法进行角色二次生成')
  }

  const dataUri = parseDataUri(raw)
  if (dataUri) {
    return {
      geminiReference: {
        data: dataUri.data,
        mimeType: dataUri.mimeType
      },
      providerReference: `data:${dataUri.mimeType};base64,${dataUri.data}`
    }
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const response = await fetch(raw)
    if (!response.ok) {
      throw new Error(`下载参考图失败: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeTypeHeader = normalizeImageMimeType(response.headers.get('content-type') || '')
    const mimeType = mimeTypeHeader || detectImageMimeTypeFromBuffer(buffer)
    const data = buffer.toString('base64')
    return {
      geminiReference: {
        data,
        mimeType
      },
      providerReference: raw
    }
  }

  if (raw.startsWith('/') && !looksLikeBase64Image(raw)) {
    throw new Error('检测到站内路径参考图，请先使用可访问的 URL 或 base64 数据')
  }

  const compact = raw.replace(/\s+/g, '')
  const buffer = Buffer.from(compact, 'base64')
  if (!buffer.length) {
    throw new Error('参考图格式无效，请提供有效的 URL 或 base64 数据')
  }
  const mimeType = detectImageMimeTypeFromBuffer(buffer)

  return {
    geminiReference: {
      data: compact,
      mimeType
    },
    providerReference: `data:${mimeType};base64,${compact}`
  }
}

async function resolveLatestRegenerationOptions(
  characterId: string,
  regeneration?: CharacterRegenerationOptions
): Promise<CharacterRegenerationOptions | undefined> {
  const customPrompt = regeneration?.customPrompt?.trim()
  if (!customPrompt) return undefined

  let referenceImage = regeneration?.referenceImage?.trim()

  try {
    const latestCharacter = await db.select({
      baseImage: charactersTable.baseImage
    })
      .from(charactersTable)
      .where(eq(charactersTable.id, characterId))
      .limit(1)

    const latestBaseImage = latestCharacter[0]?.baseImage?.trim()
    if (latestBaseImage) {
      referenceImage = latestBaseImage
    }
  } catch (error) {
    console.warn('[CharacterGen] 读取角色最新参考图失败，回退请求参数:', error)
  }

  return {
    customPrompt,
    referenceImage
  }
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
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const {
    character,
    style,
    generateExpressions,
    regeneration
  } = parseResult.data
  const latestRegeneration = await resolveLatestRegenerationOptions(character.id, regeneration)

  try {
    // 生成角色设定图（一张图包含所有信息）
    console.log(`[CharacterGen] 开始生成角色设定图: ${character.name}`)
    const sheetResult = await generateCharacterSheet(
      character,
      style,
      generateExpressions,
      latestRegeneration
    )

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

      const statusCode = (error as GeminiError).status || 500
      throw createError({
        statusCode,
        statusMessage: statusCode >= 500 ? 'Internal Server Error' : 'Bad Request',
        message: userMessage
      })
    }

    // 其他未知错误
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
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
  regeneration?: CharacterRegenerationOptions
): Promise<{ imageData: string, mimeType: string }> {
  const [workflowModels, workflowModelOptions] = await Promise.all([
    getWorkflowModels(),
    getWorkflowModelOptions()
  ])
  const modelId = workflowModels.character_portrait
  const geminiImageSize = workflowModelOptions.image_options.geminiImageSize
  const openaiImageQuality = workflowModelOptions.image_options.openaiImageQuality
  const modelConfig = modelId ? findImageModel(modelId) : undefined
  const customPrompt = regeneration?.customPrompt?.trim()
  const isRegeneration = !!customPrompt

  if (isRegeneration && modelConfig?.supportReferenceImage === false) {
    throw new Error(`当前角色模型「${modelConfig.displayName}」不支持参考图。请在设置中切换到支持图生图的图片模型后重试。`)
  }

  const genderPrompt = resolveCharacterGenderPrompt(character.gender)
  let effectivePrompt = ''
  if (isRegeneration) {
    const regenerationPrompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.CHARACTER_REGENERATION,
      {
        characterName: character.name,
        appearance: character.appearance,
        gender: genderPrompt,
        style,
        activeStyleConstraint: customPrompt || '',
        customPrompt: customPrompt || ''
      }
    )
    if (regenerationPrompt?.trim()) {
      effectivePrompt = regenerationPrompt.trim()
    } else {
      console.warn('[CharacterGen] 角色二次生成模板缺失，回退为用户输入的修改要求')
      effectivePrompt = customPrompt || ''
    }
  } else {
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.CHARACTER_SHEET,
      {
        characterName: character.name,
        appearance: character.appearance,
        gender: genderPrompt,
        style
      }
    )

    if (!prompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }
    effectivePrompt = prompt
  }
  console.log(`[CharacterGen] 使用图片模型: ${modelId}`)
  console.log(`[CharacterGen] 生成模式: ${isRegeneration ? '角色二次生成' : '角色初次生成'}`)
  console.log(`[CharacterGen] 视频模型: ${workflowModels.video_generation}, Seedance线稿约束: disabled`)

  let referenceImageOptions: {
    referenceImage?: { data: string, mimeType: string }
    referenceImages?: string[]
  } = {}

  if (isRegeneration) {
    const referenceImageRaw = regeneration?.referenceImage?.trim()
    if (!referenceImageRaw) {
      throw new Error('角色二次生成需要参考图，请先生成角色图后再试')
    }

    const normalizedReference = await normalizeReferenceImageInput(referenceImageRaw)
    const provider = modelConfig?.provider || 'gemini'
    referenceImageOptions = provider === 'gemini'
      ? {
          referenceImage: normalizedReference.geminiReference
        }
      : {
          referenceImages: [normalizedReference.providerReference]
        }
  }

  const generateWithPrompt = async (promptText: string, allowTextOnlyResult = false) => {
    return await imageLimiter.execute(() =>
      generateImage({
        modelId,
        prompt: promptText,
        imageSize: geminiImageSize,
        quality: openaiImageQuality,
        aspectRatio: CHARACTER_SHEET_ASPECT_RATIO,
        size: resolveCharacterSheetSize(modelConfig?.provider),
        ...referenceImageOptions,
        allowTextOnlyResult,
        maxRetries: 2
      })
    )
  }

  let result = await generateWithPrompt(effectivePrompt, isRegeneration)
  const hasImageResult = !!(result.imageData || result.imageUrl)

  // 兼容“提示词生成型”模板：若模型先返回了文本提示词，则自动再尝试一次出图
  if (isRegeneration && !hasImageResult && result.text?.trim()) {
    const fallbackPrompt = result.text.trim()
    console.warn('[CharacterGen] 二次生成返回文本结果，已自动使用该文本重试生成图片')
    result = await generateWithPrompt(fallbackPrompt)
  }

  const imageSource = result.imageData || result.imageUrl || ''
  if (!imageSource) {
    throw new Error('角色图生成失败：未返回可用图片数据')
  }

  try {
    const localImagePath = await persistImageToPublic({
      source: imageSource,
      prefix: `char_${character.id}`
    })

    return {
      imageData: localImagePath,
      mimeType: 'image/url'
    }
  } catch (persistError) {
    console.error('[CharacterGen] 图片本地持久化失败，降级为原始返回:', persistError)
    return {
      imageData: imageSource,
      mimeType: result.imageUrl ? 'image/url' : (result.mimeType || 'image/png')
    }
  }
}
