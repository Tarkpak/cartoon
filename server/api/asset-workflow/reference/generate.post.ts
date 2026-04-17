import { z } from 'zod'
import type { H3Event } from 'h3'
import { readFileSync, statSync } from 'node:fs'
import {
  IMAGE_MODELS,
  findImageModel,
  generateImage,
  type GenerateImageResult
} from '../../../utils/model-provider'
import { imageLimiter } from '../../../utils/concurrency'
import {
  getGeneratedImageCandidatePaths,
  persistImageToPublic
} from '../../../utils/image-storage'
import { getWorkflowModels, getWorkflowModelOptions } from '../../models/workflow.get'
import { getInterpolatedPrompt } from '../../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../../shared/types/prompt-template'

const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1'])

const SceneSettingSchema = z.object({
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
  weather: z.string().optional()
}).optional()

const SceneCharacterSchema = z.object({
  name: z.string(),
  appearance: z.string().optional(),
  emotion: z.string().optional()
})

const SceneDialogueSchema = z.object({
  character: z.string(),
  text: z.string(),
  emotion: z.string().optional()
})

const SceneSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string(),
  cameraNote: z.string().optional(),
  duration: z.number().optional(),
  setting: SceneSettingSchema,
  narration: z.string().optional(),
  characters: z.array(SceneCharacterSchema).optional().default([]),
  dialogues: z.array(SceneDialogueSchema).optional().default([])
})

const EnvironmentContextSchema = z.object({
  environmentRoot: z.string().optional(),
  anchorSceneId: z.string().optional(),
  anchorSceneTitle: z.string().optional(),
  anchorLocation: z.string().optional(),
  anchorDescription: z.string().optional(),
  siblingLocations: z.array(z.string()).optional().default([])
}).optional()

const GenerateReferenceRequestSchema = z.object({
  scene: SceneSchema,
  style: z.string().optional().default(''),
  aspectRatio: AspectRatioSchema.optional().default('16:9'),
  environmentContext: EnvironmentContextSchema,
  regeneration: z.object({
    customPrompt: z.string().optional(),
    referenceImage: z.string().optional()
  }).optional(),
  // 兼容旧字段：资产一致性新流程下该字段将被忽略（场景资产必须为纯环境）
  characterReferenceImages: z.array(z.string()).optional().default([])
})

const ENVIRONMENT_ONLY_NEGATIVE_PROMPT = [
  '人物',
  '角色',
  '人脸',
  '人体',
  '手',
  '剪影',
  '人群',
  'human',
  'person',
  'people',
  'face',
  'portrait',
  'character',
  'body',
  'hands',
  'crowd',
  'watermark',
  'logo',
  'text'
].join(', ')

const LOCATION_SUBSPACE_SUFFIXES = [
  '走廊',
  '长廊',
  '大厅',
  '前台',
  '办公室',
  '病房',
  '病区',
  '手术室',
  '诊室',
  '急诊室',
  '候诊区',
  '会议室',
  '休息室',
  '楼梯间',
  '电梯间',
  '停车场',
  '天台',
  '仓库',
  '门厅',
  '通道',
  '后巷',
  '教室',
  '宿舍',
  '食堂',
  '实验室',
  '审讯室',
  '指挥室',
  '机房',
  '车间',
  '包厢',
  '吧台',
  '客厅',
  '卧室',
  '厨房',
  '浴室',
  '阳台',
  '庭院'
]
const LOCATION_ANCHOR_KEYWORDS = [
  '医院',
  '诊所',
  '医务室',
  '警察局',
  '警局',
  '派出所',
  '学校',
  '校园',
  '大学',
  '中学',
  '小学',
  '公司',
  '写字楼',
  '工厂',
  '商场',
  '酒店',
  '旅馆',
  '餐厅',
  '咖啡馆',
  '酒吧',
  '公寓',
  '别墅',
  '车站',
  '地铁站',
  '火车站',
  '机场',
  '码头',
  '港口',
  '法庭',
  '监狱',
  '图书馆'
]
const LOCATION_STYLE_PREFIX_REGEX = /^(?:豪华|奢华|现代|陈旧|老旧|破旧|残破|高端|高级|复古|阴暗|明亮|干净|凌乱|宽敞|狭窄|未来感|futuristic|modern|luxury|run[- ]?down|dilapidated|abandoned|vintage|old)\s*/i

function resolveEnvironmentReferenceModel(preferredModelId: string): { modelId: string, reason: string } {
  const preferred = findImageModel(preferredModelId)

  if (!preferred) {
    const globalFallback = IMAGE_MODELS.find(model => !model.requireReferenceImage)
    return {
      modelId: globalFallback?.model || preferredModelId,
      reason: globalFallback ? `fallback-no-ref:not-found->${globalFallback.model}` : 'workflow-model-not-found'
    }
  }

  if (!preferred.requireReferenceImage) {
    return {
      modelId: preferred.model,
      reason: 'workflow-default'
    }
  }

  const providerFallback = IMAGE_MODELS.find(
    model => model.provider === preferred.provider && !model.requireReferenceImage
  )
  const globalFallback = IMAGE_MODELS.find(model => !model.requireReferenceImage)
  const fallback = providerFallback || globalFallback

  if (fallback) {
    return {
      modelId: fallback.model,
      reason: `fallback-no-ref:${preferred.model}->${fallback.model}`
    }
  }

  return {
    modelId: preferred.model,
    reason: 'no-no-ref-fallback'
  }
}

function hasText(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stripLocationStylePrefix(value: string): string {
  let output = value.trim()
  while (LOCATION_STYLE_PREFIX_REGEX.test(output)) {
    output = output.replace(LOCATION_STYLE_PREFIX_REGEX, '').trim()
  }
  return output
}

function inferEnvironmentRoot(location?: string): string {
  if (!hasText(location)) return ''

  let normalized = location
    .trim()
    .replace(/[（(][^()（）]{0,24}[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[，,。.!！？；;]+$/g, '')
    .trim()

  if (!normalized) return ''

  normalized = stripLocationStylePrefix(normalized)
  const primary = normalized.split(/[，,。.;；/\\|｜>]+/)[0]?.trim() || normalized
  const compact = stripLocationStylePrefix(primary)

  for (const keyword of LOCATION_ANCHOR_KEYWORDS) {
    const index = compact.indexOf(keyword)
    if (index >= 0) {
      return compact.slice(0, index + keyword.length).trim()
    }
  }

  let candidate = compact.replace(/\s+/g, '')
  for (const suffix of LOCATION_SUBSPACE_SUFFIXES) {
    if (candidate.endsWith(suffix) && candidate.length > suffix.length) {
      candidate = candidate.slice(0, -suffix.length)
      break
    }
  }

  candidate = stripLocationStylePrefix(candidate)
  return candidate || compact
}

function buildEnvironmentConsistencyText(
  scene: z.infer<typeof SceneSchema>,
  environmentContext?: z.infer<typeof EnvironmentContextSchema>
): string {
  const explicitRoot = environmentContext?.environmentRoot?.trim() || ''
  const inferredRoot = inferEnvironmentRoot(scene.setting?.location)
  const environmentRoot = explicitRoot || inferredRoot

  const siblingLocations = Array.from(
    new Set(
      (environmentContext?.siblingLocations || [])
        .map(item => item?.trim())
        .filter((item): item is string => !!item)
    )
  ).slice(0, 8)

  const anchorTitle = environmentContext?.anchorSceneTitle?.trim()
  const anchorLocation = environmentContext?.anchorLocation?.trim()
  const anchorDescription = environmentContext?.anchorDescription?.trim()

  if (!environmentRoot && !anchorDescription && siblingLocations.length === 0) return ''

  const lines = [
    '【主环境一致性约束】',
    environmentRoot ? `主环境锚点：${environmentRoot}` : '',
    anchorTitle || anchorLocation
      ? `母体参考场景：${anchorTitle || '未命名场景'}${anchorLocation ? `（${anchorLocation}）` : ''}`
      : '',
    anchorDescription
      ? `母体环境描述（需保持同一建筑年代/装修档次/材质语言/照明逻辑）：${anchorDescription}`
      : '',
    siblingLocations.length > 1
      ? `同组子空间：${siblingLocations.join('、')}`
      : '',
    '当前画面视为同一主环境下的子空间，不得出现互相冲突的装修与维护状态。',
    '除非场景文本明确出现“翻修区/废弃区/新旧分区”，否则禁止出现“走廊豪华现代、办公室破旧老化”这类冲突。'
  ].filter(Boolean)

  return lines.join('\n')
}

function resolveImageSizeByAspectRatio(aspectRatio: z.infer<typeof AspectRatioSchema>): string {
  switch (aspectRatio) {
    case '9:16':
      return '720*1280'
    case '1:1':
      return '960*960'
    case '16:9':
    default:
      return '1280*720'
  }
}

async function resolveGeneratedImage(result: GenerateImageResult): Promise<{ imageData: string, mimeType: string }> {
  const source = result.imageData || result.imageUrl || ''
  if (!source) {
    throw new Error('未返回可用图片数据')
  }

  try {
    const localImagePath = await persistImageToPublic({
      source,
      prefix: 'scene_ref'
    })
    return {
      imageData: localImagePath,
      mimeType: 'image/url'
    }
  } catch (persistError) {
    console.error('[AssetWorkflow/Reference] 图片本地持久化失败，降级为原始返回:', persistError)
    return {
      imageData: source,
      mimeType: result.imageUrl ? 'image/url' : (result.mimeType || 'image/png')
    }
  }
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

function readLocalReferenceImage(rawPath: string): Buffer | null {
  const trimmed = rawPath.trim()
  if (!trimmed) return null

  let filename = ''
  if (trimmed.startsWith('/generated-images/')) {
    filename = decodeURIComponent(trimmed.slice('/generated-images/'.length))
  } else if (trimmed.startsWith('/api/image/file/')) {
    filename = decodeURIComponent(trimmed.slice('/api/image/file/'.length))
  } else {
    return null
  }

  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null
  }

  const filePath = getGeneratedImageCandidatePaths(filename)
    .find((candidate) => {
      try {
        return statSync(candidate).isFile()
      } catch {
        return false
      }
    })

  if (!filePath) return null
  return readFileSync(filePath)
}

interface NormalizedReferenceImage {
  geminiReference: {
    data: string
    mimeType: string
  }
  providerReference: string
}

async function normalizeReferenceImageInput(
  source: string,
  event: H3Event
): Promise<NormalizedReferenceImage> {
  const raw = source.trim()
  if (!raw) {
    throw new Error('环境参考图为空，无法进行二次生成')
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
      throw new Error(`下载环境参考图失败: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = normalizeImageMimeType(response.headers.get('content-type') || '')
      || detectImageMimeTypeFromBuffer(buffer)
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
    const localBuffer = readLocalReferenceImage(raw)
    if (localBuffer) {
      const mimeType = detectImageMimeTypeFromBuffer(localBuffer)
      const data = localBuffer.toString('base64')
      const requestUrl = getRequestURL(event)
      const absoluteUrl = new URL(raw, `${requestUrl.protocol}//${requestUrl.host}`).toString()
      return {
        geminiReference: {
          data,
          mimeType
        },
        providerReference: absoluteUrl
      }
    }

    const requestUrl = getRequestURL(event)
    const absoluteUrl = new URL(raw, `${requestUrl.protocol}//${requestUrl.host}`).toString()
    const response = await fetch(absoluteUrl)
    if (!response.ok) {
      throw new Error(`下载环境参考图失败: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = normalizeImageMimeType(response.headers.get('content-type') || '')
      || detectImageMimeTypeFromBuffer(buffer)
    const data = buffer.toString('base64')
    return {
      geminiReference: {
        data,
        mimeType
      },
      providerReference: absoluteUrl
    }
  }

  const compact = raw.replace(/\s+/g, '')
  const buffer = Buffer.from(compact, 'base64')
  if (!buffer.length) {
    throw new Error('环境参考图格式无效，请提供有效的 URL 或 base64 数据')
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

async function buildSceneReferencePrompt(
  scene: z.infer<typeof SceneSchema>,
  style: string,
  aspectRatio: z.infer<typeof AspectRatioSchema>,
  environmentContext: z.infer<typeof EnvironmentContextSchema>,
  customPrompt?: string
): Promise<string> {
  const normalizedCustomPrompt = customPrompt?.trim() || ''
  const settingText = scene.setting
    ? [scene.setting.location, scene.setting.timeOfDay, scene.setting.mood, scene.setting.weather]
        .filter(Boolean)
        .join(' / ')
    : '未提供'
  const narrationText = hasText(scene.narration)
    ? scene.narration!.trim()
    : '无'
  const dialogueText = (scene.dialogues || []).length > 0
    ? scene.dialogues.map(item => `${item.character}: ${item.text}`).join('\n')
    : '无'
  const cameraNoteText = hasText(scene.cameraNote)
    ? scene.cameraNote!.trim()
    : '无'
  const environmentConsistencyText = buildEnvironmentConsistencyText(scene, environmentContext) || '无'

  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.ENVIRONMENT_REFERENCE_GENERATION,
    {
      sceneTitle: scene.title || '未命名场景',
      sceneDescription: scene.description,
      setting: settingText,
      style,
      aspectRatio,
      environmentConsistency: environmentConsistencyText,
      cameraNote: cameraNoteText,
      narration: narrationText,
      dialogues: dialogueText,
      customPrompt: normalizedCustomPrompt || '无'
    },
    undefined,
    'asset_consistency'
  )

  if (!templatePrompt) {
    console.error('[AssetWorkflow/Reference] 环境参考图模板缺失，请检查提示词配置')
    throw new Error('无法获取环境参考图生成模板，请在设置中检查提示词配置')
  }

  return templatePrompt
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  const body = await readBody(event)
  const parseResult = GenerateReferenceRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    })
  }

  const { scene, style, aspectRatio, environmentContext, regeneration } = parseResult.data
  const customPrompt = regeneration?.customPrompt?.trim()
  const referenceImage = regeneration?.referenceImage?.trim()

  try {
    const [workflowModels, workflowModelOptions] = await Promise.all([
      getWorkflowModels(),
      getWorkflowModelOptions()
    ])
    const preferredModelId = workflowModels.frame_generation
    const isRegeneration = !!customPrompt
    const modelDecision = isRegeneration
      ? {
          modelId: preferredModelId,
          reason: 'workflow-regeneration'
        }
      : resolveEnvironmentReferenceModel(preferredModelId)
    const modelId = modelDecision.modelId
    const modelConfig = findImageModel(modelId)
    const geminiImageSize = workflowModelOptions.image_options.geminiImageSize
    const prompt = await buildSceneReferencePrompt(scene, style, aspectRatio, environmentContext, customPrompt)
    const normalizedReference = referenceImage
      ? await normalizeReferenceImageInput(referenceImage, event)
      : null

    if (isRegeneration && !normalizedReference) {
      throw new Error('环境二次生成需要参考图，请先生成或上传环境图后再试')
    }

    if (isRegeneration && !modelId) {
      throw new Error('当前未配置环境图生成模型，请先在设置中选择图片模型')
    }

    if (isRegeneration && !modelConfig) {
      throw new Error(`当前环境图模型不可用：${modelId}`)
    }

    if (isRegeneration && modelConfig?.supportReferenceImage === false) {
      throw new Error(`当前环境图模型「${modelConfig.displayName}」不支持参考图。请在设置中切换到支持图生图的图片模型后重试。`)
    }

    const provider = modelConfig?.provider || 'gemini'
    const referenceOptions = normalizedReference
      ? (
          provider === 'gemini'
            ? {
                referenceImage: normalizedReference.geminiReference
              }
            : {
                referenceImages: [normalizedReference.providerReference]
              }
        )
      : {}

    const generated = await imageLimiter.execute(() =>
      generateImage({
        modelId,
        prompt,
        imageSize: geminiImageSize,
        negativePrompt: ENVIRONMENT_ONLY_NEGATIVE_PROMPT,
        size: resolveImageSizeByAspectRatio(aspectRatio),
        ...referenceOptions,
        maxRetries: 2
      })
    )

    const normalized = await resolveGeneratedImage(generated)

    return {
      success: true,
      referenceImage: normalized.imageData,
      mimeType: normalized.mimeType,
      latencyMs: Date.now() - startTime,
      usage: {
        modelId,
        modelDecision: modelDecision.reason,
        aspectRatio,
        characterReferences: 0,
        referenceImageUsed: !!normalizedReference
      }
    }
  } catch (error) {
    console.error('[AssetWorkflow/Reference] 生成失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '场景环境图生成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
