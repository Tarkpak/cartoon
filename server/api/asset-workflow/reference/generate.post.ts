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
import {
  resolveTimeOfDayText,
  normalizeOptionalSceneEraValue,
  inferSceneEraFromText
} from '../../../../shared/types/script'
import {
  PANORAMA_SOURCE_ASPECT_RATIO,
  resolvePanoramaSourceProfile,
  type PanoramaSourceProfile
} from './panorama-source'

const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1'])

const SceneSettingSchema = z.object({
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  era: z.string().optional(),
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
  'text',
  '鱼眼',
  '透视畸变',
  '桶形畸变',
  '枕形畸变',
  '边缘拉伸',
  '夸张广角',
  'fisheye',
  'fish-eye',
  'lens distortion',
  'barrel distortion',
  'pincushion distortion',
  'warped lines',
  'curved horizon',
  'extreme perspective',
  'ultra wide angle'
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
const TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]\s*/u
const TIMELINE_LINE_CAPTURE_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:].+$/gmu
const LEADING_SHOT_AND_CAMERA_REGEX = /^(?:(?:大远景|远景|全景|中全景|中景|中近景|近景|特写镜头|特写|细节特写|细节|固定镜头|缓慢推近|缓慢拉远|镜头左摇|镜头右摇|镜头上摇|镜头下摇|跟随镜头|手持镜头|变焦推近|变焦拉远|移镜头|升降镜头|环绕镜头)[，,、\s]*)+/u
const ENVIRONMENT_DETAIL_KEYWORDS = [
  '环境', '空间', '场景', '地点', '建筑', '房间', '走廊', '长廊', '大厅', '前台', '办公室', '病房', '病区', '手术室',
  '诊室', '急诊室', '候诊区', '会议室', '休息室', '楼梯间', '电梯间', '停车场', '天台', '仓库', '门厅', '通道',
  '后巷', '教室', '宿舍', '食堂', '实验室', '审讯室', '指挥室', '机房', '车间', '包厢', '吧台', '客厅', '卧室',
  '厨房', '浴室', '阳台', '庭院', '荒野', '古道', '戈壁', '沙地', '山', '山峦', '树林', '森林', '河', '湖', '海',
  '天空', '云', '裂缝', '黑洞', '黑雾', '雾', '烟', '火', '火焰', '残阳', '日光', '月光', '灯', '灯光', '光线',
  '阴影', '地面', '土地', '尘土', '石头', '经书', '门', '窗', '墙', '屋顶', '地板', '桌', '椅', '床', '屏风',
  '帘', '雨', '雪', '风', '雷', '闪电', '天气', '空气', '色调', '材质', '道具'
]

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

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    '【主环境上下文】',
    environmentRoot ? `主环境锚点：${environmentRoot}` : '',
    anchorTitle || anchorLocation
      ? `母体参考场景：${anchorTitle || '未命名场景'}${anchorLocation ? `（${anchorLocation}）` : ''}`
      : '',
    anchorDescription
      ? `母体环境描述：${anchorDescription}`
      : '',
    siblingLocations.length > 0
      ? `同组子空间：${siblingLocations.join('、')}`
      : ''
  ].filter(Boolean)

  return lines.join('\n')
}

function extractTimelineLines(text: string): string[] {
  if (!text) return []
  const matches = text.match(TIMELINE_LINE_CAPTURE_REGEX) || []
  return matches
    .map(line => line.trim())
    .filter(Boolean)
}

function stripDialogueAndNarration(text: string): string {
  return text
    .replace(/画外音[（(][^）)]*[）)]\s*说：'[^']*'/gu, ' ')
    .replace(/(?:[^\s，。！？；;:："“”'「」]+)\s*说：'[^']*'/gu, ' ')
    .replace(/'[^']*'/gu, ' ')
}

function sanitizeEnvironmentLine(
  line: string,
  characterNames: string[]
): string {
  let output = line
    .replace(TIMELINE_PREFIX_REGEX, '')
    .replace(/(?:\[(?:图片|Image\s*#)\s*\d+\]|@(?:图片|Image\s*#)\s*\d+)/giu, ' ')

  output = stripDialogueAndNarration(output)

  for (const characterName of characterNames) {
    if (!characterName) continue
    const matcher = new RegExp(escapeRegExp(characterName), 'gu')
    output = output.replace(matcher, ' ')
  }

  return output
    .replace(LEADING_SHOT_AND_CAMERA_REGEX, '')
    .replace(/[“”"'「」]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[，,、；;:：。\-. ]+/u, '')
    .replace(/[，,、；;:：。\-. ]+$/u, '')
    .trim()
}

function extractEnvironmentFragments(text: string): string[] {
  return text
    .split(/[，,。；;]/u)
    .map(fragment => fragment.trim())
    .filter(Boolean)
    .filter((fragment) => {
      return ENVIRONMENT_DETAIL_KEYWORDS.some(keyword => fragment.includes(keyword))
    })
}

function buildEnvironmentSummary(scene: z.infer<typeof SceneSchema>): string {
  const timelineLines = extractTimelineLines(scene.description)
  const fallbackLines = scene.description
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const candidateLines = timelineLines.length > 0 ? timelineLines : fallbackLines
  const characterNames = Array.from(new Set(
    (scene.characters || [])
      .map(character => character.name?.trim() || '')
      .filter(Boolean)
  ))

  const detailLines = candidateLines
    .flatMap((line) => {
      const sanitized = sanitizeEnvironmentLine(line, characterNames)
      return extractEnvironmentFragments(sanitized)
    })
    .filter(line => line.length >= 4)
  const uniqueDetailLines = Array.from(new Set(detailLines)).slice(0, 6)

  const summaryLines = [
    scene.setting?.location ? `核心空间：${scene.setting.location}` : '',
    scene.setting?.timeOfDay ? `时间：${resolveTimeOfDayText(scene.setting.timeOfDay)}` : '',
    scene.setting?.weather ? `天气：${scene.setting.weather}` : '',
    scene.setting?.mood ? `氛围：${scene.setting.mood}` : '',
    hasText(scene.cameraNote) ? `镜头取景重点：${scene.cameraNote!.trim()}` : ''
  ].filter(Boolean)

  if (uniqueDetailLines.length > 0) {
    summaryLines.push(`环境细节：${uniqueDetailLines.join('；')}`)
  }

  return summaryLines.join('\n') || '仅保留该场景的核心环境、空间结构、光照与天气信息。'
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
  panoramaSource: PanoramaSourceProfile,
  environmentContext: z.infer<typeof EnvironmentContextSchema>,
  customPrompt?: string
): Promise<string> {
  const normalizedCustomPrompt = customPrompt?.trim() || ''
  const environmentSummary = buildEnvironmentSummary(scene)
  const environmentSceneTitle = scene.setting?.location?.trim() || scene.title || '未命名场景'
  const antiDistortionText = '必须避免鱼眼/桶形/枕形/夸张广角畸变，保持地平线水平与建筑竖线自然，边缘不要拉伸变形'
  const panoramaFallbackHint = panoramaSource.fallbackApplied
    ? `当前模型不支持 AR ${PANORAMA_SOURCE_ASPECT_RATIO}，已自动改为该模型支持的 AR ${panoramaSource.aspectRatio}（${panoramaSource.size}）。`
    : ''
  const panoramaAspectText = [
    panoramaFallbackHint,
    `目标输出画幅：${aspectRatio}`,
    `全景源图画幅：${panoramaSource.aspectRatio}`,
    `全景源图尺寸：${panoramaSource.size}`,
    aspectRatio === '16:9'
      ? '裁切策略：默认使用全景源图中的 16:9 区域'
      : `裁切策略：后续从全景源图裁切为 ${aspectRatio}`,
    `全景源图要求：先生成 360 环绕等距柱状环境全景源图（左右边缘需可衔接），默认采用中远景/全景观察距离，保留更完整空间结构，${antiDistortionText}`
  ].filter(Boolean).join('\n')
  const timeOfDay = resolveTimeOfDayText(scene.setting?.timeOfDay)
  const era = normalizeOptionalSceneEraValue(scene.setting?.era)
    || inferSceneEraFromText([
      scene.title || '',
      scene.description || '',
      scene.setting?.location || ''
    ].filter(Boolean).join('\n'))
  const settingText = scene.setting
    ? [scene.setting.location, era ? `时代：${era}` : '', timeOfDay, scene.setting.mood, scene.setting.weather]
        .filter(Boolean)
        .join(' / ')
    : '未提供'
  const cameraNoteText = hasText(scene.cameraNote)
    ? scene.cameraNote!.trim()
    : '无'
  const environmentConsistencyText = buildEnvironmentConsistencyText(scene, environmentContext) || '无'

  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.ENVIRONMENT_REFERENCE_GENERATION,
    {
      sceneTitle: environmentSceneTitle,
      sceneDescription: environmentSummary,
      setting: settingText,
      style,
      aspectRatio: panoramaAspectText,
      environmentConsistency: environmentConsistencyText,
      cameraNote: cameraNoteText,
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
    const panoramaSource = resolvePanoramaSourceProfile(modelConfig)
    if (panoramaSource.fallbackApplied) {
      console.warn(
        `[AssetWorkflow/Reference] 模型 ${modelId} 不支持 ${PANORAMA_SOURCE_ASPECT_RATIO}，自动降级为 ${panoramaSource.aspectRatio}（${panoramaSource.size}）`
      )
    }
    const prompt = await buildSceneReferencePrompt(
      scene,
      style,
      aspectRatio,
      panoramaSource,
      environmentContext,
      customPrompt
    )
    const negativePromptTemplate = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.ENVIRONMENT_REFERENCE_NEGATIVE_PROMPT,
      {},
      undefined,
      'asset_consistency'
    )
    const resolvedNegativePrompt = negativePromptTemplate?.trim() || ENVIRONMENT_ONLY_NEGATIVE_PROMPT
    const normalizedReference = referenceImage
      ? await normalizeReferenceImageInput(referenceImage, event)
      : null

    if (!negativePromptTemplate) {
      console.warn('[AssetWorkflow/Reference] 负向提示词模板缺失，已回退到内置环境负向约束')
    }

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
        aspectRatio: panoramaSource.aspectRatio,
        negativePrompt: resolvedNegativePrompt,
        size: panoramaSource.size,
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
        sourceAspectRatio: panoramaSource.aspectRatio,
        sourceSize: panoramaSource.size,
        sourceAspectRatioFallback: panoramaSource.fallbackApplied,
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
