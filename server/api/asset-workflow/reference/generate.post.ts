import { z } from 'zod'
import {
  IMAGE_MODELS,
  findImageModel,
  generateImage,
  type GenerateImageResult
} from '../../../utils/model-provider'
import { imageLimiter } from '../../../utils/concurrency'
import { persistImageToPublic } from '../../../utils/image-storage'
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
    customPrompt: z.string().optional()
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

async function buildSceneReferencePrompt(
  scene: z.infer<typeof SceneSchema>,
  style: string,
  aspectRatio: z.infer<typeof AspectRatioSchema>,
  environmentContext: z.infer<typeof EnvironmentContextSchema>,
  customPrompt?: string
): Promise<string> {
  const normalizedCustomPrompt = customPrompt?.trim() || ''
  const templatePrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.FIRST_FRAME_GENERATION,
    {
      sceneDescription: scene.description,
      // 场景资产图只生成环境底图，角色信息在该步骤必须忽略
      characters: '[]',
      style,
      setting: JSON.stringify(scene.setting || {}),
      storyboardShot: '{}'
    },
    undefined,
    'asset_consistency'
  )

  const narrationText = hasText(scene.narration)
    ? `【旁白】\n${scene.narration!.trim()}`
    : ''

  const dialogueText = (scene.dialogues || []).length > 0
    ? `【关键对白】\n${scene.dialogues.map(item => `${item.character}: ${item.text}`).join('\n')}`
    : ''

  const cameraNoteText = hasText(scene.cameraNote)
    ? `【镜头与资产备注】\n${scene.cameraNote!.trim()}`
    : ''

  const regenerationText = normalizedCustomPrompt
    ? `【二次生成要求】\n${normalizedCustomPrompt}`
    : ''
  const environmentConsistencyText = buildEnvironmentConsistencyText(scene, environmentContext)

  const extraRules = [
    '【输出规则】',
    '仅生成 1 张环境资产参考图，不要拼图，不要分镜排版。',
    `画面比例必须为 ${aspectRatio}。`,
    '不要文字、水印、logo，不要画面边框。',
    '这是纯环境图：禁止出现任何人物/人脸/肢体/剪影。',
    '若原文包含人物动作或对白，仅提取地点、建筑、地形、道具、光照与天气信息。',
    '画面需覆盖场景核心空间关系，作为后续视频的环境基底参考。'
  ].join('\n')

  if (templatePrompt) {
    return [
      templatePrompt,
      environmentConsistencyText,
      cameraNoteText,
      narrationText,
      dialogueText,
      regenerationText,
      extraRules
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const settingText = scene.setting
    ? [scene.setting.location, scene.setting.timeOfDay, scene.setting.mood, scene.setting.weather]
        .filter(Boolean)
        .join(' / ')
    : '未提供'

  return [
    '请生成一张用于视频生成的环境资产参考图（纯环境，无人物）。',
    `风格: ${style || '保持项目默认风格'}`,
    `场景标题: ${scene.title || '未命名场景'}`,
    `场景设定: ${settingText}`,
    `场景描述: ${scene.description}`,
    environmentConsistencyText,
    cameraNoteText,
    narrationText,
    dialogueText,
    regenerationText,
    extraRules
  ]
    .filter(Boolean)
    .join('\n\n')
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

  try {
    const [workflowModels, workflowModelOptions] = await Promise.all([
      getWorkflowModels(),
      getWorkflowModelOptions()
    ])
    const modelDecision = resolveEnvironmentReferenceModel(workflowModels.frame_generation)
    const modelId = modelDecision.modelId
    const geminiImageSize = workflowModelOptions.image_generation.geminiImageSize
    const prompt = await buildSceneReferencePrompt(scene, style, aspectRatio, environmentContext, customPrompt)

    const generated = await imageLimiter.execute(() =>
      generateImage({
        modelId,
        prompt,
        imageSize: geminiImageSize,
        negativePrompt: ENVIRONMENT_ONLY_NEGATIVE_PROMPT,
        size: resolveImageSizeByAspectRatio(aspectRatio),
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
        characterReferences: 0
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
