import { z } from 'zod'
import {
  findVideoModel
} from '../../../utils/model-provider'
import { getWorkflowModels } from '../../models/workflow.get'
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

const RequestSchema = z.object({
  scene: SceneSchema,
  style: z.string().optional().default(''),
  aspectRatio: AspectRatioSchema.optional().default('16:9'),
  references: z.object({
    environmentImage: z.string().optional(),
    characterImage: z.string().optional()
  })
}).superRefine((payload, ctx) => {
  const hasEnvironment = typeof payload.references.environmentImage === 'string'
    && payload.references.environmentImage.trim().length > 0
  const hasCharacter = typeof payload.references.characterImage === 'string'
    && payload.references.characterImage.trim().length > 0

  if (!hasEnvironment && !hasCharacter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['references'],
      message: '至少提供一张参考图'
    })
  }
})

type InputMode = 'single_image' | 'text_only'

function hasText(value?: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeImageInput(value?: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function detectImageMimeType(base64Payload: string): string {
  const head = base64Payload.trim()
  if (head.startsWith('/9j/')) return 'image/jpeg'
  if (head.startsWith('iVBOR')) return 'image/png'
  if (head.startsWith('R0lGOD')) return 'image/gif'
  if (head.startsWith('UklGR')) return 'image/webp'
  if (head.startsWith('Qk')) return 'image/bmp'
  if (head.startsWith('SUkq') || head.startsWith('TU0A')) return 'image/tiff'
  return 'image/png'
}

function isLikelyBase64Image(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return compact.startsWith('/9j/')
    || compact.startsWith('iVBOR')
    || compact.startsWith('R0lGOD')
    || compact.startsWith('UklGR')
    || compact.startsWith('Qk')
    || compact.startsWith('SUkq')
    || compact.startsWith('TU0A')
}

function toImageUrlInput(value?: string): string | undefined {
  if (!value) return undefined

  const raw = value.trim()
  if (!raw) return undefined

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw
  }

  if (raw.startsWith('/') && !isLikelyBase64Image(raw)) {
    return raw
  }

  const dataUriMatch = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[2]) {
    const payload = dataUriMatch[2].replace(/\s+/g, '')
    const mimeType = detectImageMimeType(payload)
    return `data:${mimeType};base64,${payload}`
  }

  const payload = raw.replace(/\s+/g, '')
  const mimeType = detectImageMimeType(payload)
  return `data:${mimeType};base64,${payload}`
}

function clampDuration(value?: number): number {
  const numeric = Number.isFinite(value) ? Number(value) : 8
  return Math.max(2, Math.min(15, Math.round(numeric)))
}

function hasSceneCharacters(scene: z.infer<typeof SceneSchema>): boolean {
  return Array.isArray(scene.characters) && scene.characters.length > 0
}

function buildVideoReferenceImages(options: {
  characterImage?: string
  environmentImage?: string
}): string[] {
  const { characterImage, environmentImage } = options
  const unique = new Set<string>()

  // 角色放前，优先约束身份
  for (const image of [characterImage, environmentImage]) {
    if (!image) continue
    const normalized = toImageUrlInput(image)
    if (!normalized) continue
    unique.add(normalized)
  }

  return Array.from(unique).slice(0, 3)
}

function buildReferenceGuide(options: {
  inputMode: InputMode
  hasCharacterRef: boolean
  hasEnvironmentRef: boolean
  useMultiReference?: boolean
}): string {
  const { inputMode, hasCharacterRef, hasEnvironmentRef, useMultiReference } = options

  if (inputMode === 'single_image') {
    if (useMultiReference && hasEnvironmentRef && hasCharacterRef) {
      return '参考图说明：将同时引用环境图与角色图（多参考图）；环境用于构图与空间，角色用于身份外观锁定。'
    }
    if (hasEnvironmentRef && hasCharacterRef) {
      return '参考图说明：将优先使用环境图锁定构图，并结合角色设定与文本保持人物身份连续。'
    }
    if (hasEnvironmentRef) {
      return '参考图说明：请严格保持环境参考图的空间结构、光照与主色调稳定。'
    }
    if (hasCharacterRef) {
      return '参考图说明：未提供环境图，需保持角色身份稳定并依据文本补全环境。'
    }
  }

  return '未提供可用参考图，请仅依据文本生成并保持叙事一致。'
}

function buildSettingText(setting?: z.infer<typeof SceneSettingSchema>): string {
  if (!setting) return '未提供'

  return [
    setting.location,
    setting.timeOfDay,
    setting.mood,
    setting.weather
  ]
    .filter(Boolean)
    .join(' / ') || '未提供'
}

function buildDialogueLines(dialogues: z.infer<typeof SceneDialogueSchema>[]): string {
  if (dialogues.length === 0) return ''
  return dialogues.map(item => `${item.character}: ${item.text}`).join('\n')
}

function resolveCompatibleModel(
  preferredModelId: string,
  options: {
    needImageInput: boolean
    needReferenceImages?: boolean
  }
): { modelId: string, reason: string } {
  const preferred = findVideoModel(preferredModelId)

  if (!preferred) {
    return {
      modelId: preferredModelId,
      reason: 'workflow-model-not-found'
    }
  }

  // 资产一致性流程优先尊重工作流/全局模型配置，不自动切换到其它模型。
  // 不支持多参考图或图生视频时仅降级输入策略（多参考 -> 单图/文本）。
  if (options.needReferenceImages && !preferred.supportReferenceImages) {
    return {
      modelId: preferred.model,
      reason: 'workflow-selected:no-multi-reference'
    }
  }

  if (options.needImageInput && !preferred.supportImageToVideo) {
    return {
      modelId: preferred.model,
      reason: 'workflow-selected:no-image-input'
    }
  }

  return {
    modelId: preferred.model,
    reason: 'workflow-selected'
  }
}

function buildVideoPrompt(options: {
  scene: z.infer<typeof SceneSchema>
  style: string
  hasCharacterRef: boolean
  hasEnvironmentRef: boolean
  inputMode: InputMode
  useMultiReference?: boolean
  aspectRatio: z.infer<typeof AspectRatioSchema>
}): string {
  const {
    scene,
    style,
    hasCharacterRef,
    hasEnvironmentRef,
    inputMode,
    useMultiReference,
    aspectRatio
  } = options

  const referenceGuide = buildReferenceGuide({
    inputMode,
    hasCharacterRef,
    hasEnvironmentRef,
    useMultiReference
  })
  const settingText = buildSettingText(scene.setting)
  const dialogueLines = buildDialogueLines(scene.dialogues)

  const dialogueText = dialogueLines
    ? `【对白】\n${dialogueLines}`
    : ''

  const narrationText = hasText(scene.narration)
    ? `【旁白】\n${scene.narration!.trim()}`
    : ''

  const cameraNoteText = hasText(scene.cameraNote)
    ? `【镜头与资产备注】\n${scene.cameraNote!.trim()}`
    : ''

  return [
    `【风格】${style || '保持项目风格一致'}`,
    `【场景】${scene.title || scene.id}`,
    `【设定】${settingText}`,
    '【目标】生成一个连贯的单场景视频片段，镜头稳定、动作自然、时空一致。',
    referenceGuide,
    hasCharacterRef
      ? '角色一致性：保持角色脸部特征、发型、服装与体型稳定，不替换人物身份。'
      : '角色策略：本场景可无角色出镜，重点保持环境和镜头叙事连续。',
    `输出比例：${aspectRatio}`,
    `【场景描述】\n${scene.description}`,
    cameraNoteText,
    narrationText,
    dialogueText
  ]
    .filter(Boolean)
    .join('\n\n')
}

export default defineEventHandler(async (event) => {
  const startTime = Date.now()
  const body = await readBody(event)
  const parseResult = RequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    })
  }

  const { scene, style, aspectRatio, references } = parseResult.data

  const environmentImage = normalizeImageInput(references.environmentImage)
  const characterImage = normalizeImageInput(references.characterImage)
  const hasCharactersInScene = hasSceneCharacters(scene)
  const hasCharacterRef = !!characterImage
  const hasEnvironmentRef = !!environmentImage
  const candidateReferenceImages = buildVideoReferenceImages({
    characterImage,
    environmentImage
  })
  const wantsMultiReference = hasCharactersInScene && candidateReferenceImages.length > 1

  const workflowModels = await getWorkflowModels()
  const preferredModelId = workflowModels.video_generation
  const primaryReferenceCandidate = environmentImage || characterImage

  const modelDecision = resolveCompatibleModel(preferredModelId, {
    needImageInput: !!primaryReferenceCandidate,
    needReferenceImages: wantsMultiReference
  })

  const selectedModel = findVideoModel(modelDecision.modelId)
  const supportsMultiReferenceImages = !!selectedModel?.supportReferenceImages
  const multiReferenceImages = supportsMultiReferenceImages && wantsMultiReference
    ? candidateReferenceImages
    : []

  // Gemini 多参考图时优先环境图作为单图输入，保留空间构图；其它模型仍优先角色图锁身份
  const primaryReference = hasCharactersInScene
    ? (supportsMultiReferenceImages
        ? (environmentImage || characterImage)
        : (characterImage || environmentImage))
    : (environmentImage || characterImage)

  let inputMode: InputMode = 'text_only'
  if (selectedModel?.supportImageToVideo && primaryReference) {
    inputMode = 'single_image'
  }

  const referenceGuide = buildReferenceGuide({
    inputMode,
    hasCharacterRef,
    hasEnvironmentRef,
    useMultiReference: multiReferenceImages.length > 0
  })
  const fallbackPrompt = buildVideoPrompt({
    scene,
    style,
    hasCharacterRef,
    hasEnvironmentRef,
    inputMode,
    useMultiReference: multiReferenceImages.length > 0,
    aspectRatio
  })
  const finalDuration = clampDuration(scene.duration)
  const settingText = buildSettingText(scene.setting)
  const dialogueLines = buildDialogueLines(scene.dialogues)
  const narrationText = hasText(scene.narration) ? scene.narration.trim() : ''

  const templatedPrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.SCENE_VIDEO_GENERATION,
    {
      sceneTitle: scene.title || scene.id,
      sceneDescription: scene.description,
      style: style || '保持项目风格一致',
      referenceGuide,
      inputMode,
      hasCharacterRef: hasCharacterRef ? 'yes' : 'no',
      hasEnvironmentRef: hasEnvironmentRef ? 'yes' : 'no',
      duration: String(finalDuration),
      aspectRatio,
      // 将场景的镜头与资产备注并入 setting 字段，避免新增模板变量导致兼容复杂度增加
      setting: [
        settingText,
        multiReferenceImages.length > 0 ? `参考图策略：多参考图模式（${multiReferenceImages.length} 张）` : '',
        hasText(scene.cameraNote) ? `镜头与资产备注：${scene.cameraNote!.trim()}` : ''
      ].filter(Boolean).join('\n'),
      narration: narrationText || '无',
      dialogues: dialogueLines || '无'
    },
    undefined,
    'asset_consistency'
  )

  const prompt = `${templatedPrompt || fallbackPrompt}\n\n[Aspect Ratio Override]\nStrict output ratio: ${aspectRatio}`

  const config: Record<string, unknown> = {
    prompt,
    duration: finalDuration,
    resolution: '720p',
    aspectRatio,
    withAudio: true,
    model: 'fast',
    modelId: modelDecision.modelId
  }

  if (inputMode === 'single_image') {
    const imageUrl = toImageUrlInput(primaryReference)
    if (imageUrl) {
      config.imageUrl = imageUrl
    }
  }

  if (multiReferenceImages.length > 0) {
    config.referenceImages = multiReferenceImages
  }

  try {
    const response = await $fetch<{
      success: boolean
      taskId?: string
      error?: string
    }>('/api/video/generate', {
      method: 'POST',
      body: {
        sceneId: scene.id,
        config
      }
    })

    if (!response.success || !response.taskId) {
      throw new Error(response.error || '视频任务创建失败')
    }

    return {
      success: true,
      taskId: response.taskId,
      latencyMs: Date.now() - startTime,
      debug: {
        inputMode,
        preferredModelId,
        actualModelId: modelDecision.modelId,
        modelDecision: modelDecision.reason,
        supportsMultiReferenceImages,
        referenceImagesCount: multiReferenceImages.length,
        primaryReferenceType: hasCharactersInScene
          ? (supportsMultiReferenceImages
              ? (environmentImage ? 'environment' : characterImage ? 'character' : 'none')
              : (characterImage ? 'character' : environmentImage ? 'environment' : 'none'))
          : (environmentImage ? 'environment' : characterImage ? 'character' : 'none'),
        hasCharacterRef,
        hasEnvironmentRef
      }
    }
  } catch (error) {
    console.error('[AssetWorkflow/Video] 任务创建失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '场景视频生成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
