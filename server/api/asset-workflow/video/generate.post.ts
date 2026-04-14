import { z } from 'zod'
import {
  findVideoModel
} from '../../../utils/model-provider'
import * as kling from '../../../utils/kling'
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
    characterImage: z.string().optional(),
    characterImages: z.array(z.string()).optional()
  })
}).superRefine((payload, ctx) => {
  const hasEnvironment = typeof payload.references.environmentImage === 'string'
    && payload.references.environmentImage.trim().length > 0
  const hasLegacyCharacter = typeof payload.references.characterImage === 'string'
    && payload.references.characterImage.trim().length > 0
  const hasCharacterArray = Array.isArray(payload.references.characterImages)
    && payload.references.characterImages.some(item => typeof item === 'string' && item.trim().length > 0)
  const hasCharacter = hasLegacyCharacter || hasCharacterArray

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

function normalizeImageInputList(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return []

  const unique = new Set<string>()
  for (const value of values) {
    const normalized = normalizeImageInput(value)
    if (!normalized) continue
    unique.add(normalized)
  }

  return Array.from(unique)
}

function resolveCharacterReferenceImages(options: {
  legacyCharacterImage?: string
  characterImages?: string[]
}): string[] {
  const normalizedArray = normalizeImageInputList(options.characterImages)
  const unique = new Set<string>(normalizedArray)

  const legacy = normalizeImageInput(options.legacyCharacterImage)
  if (legacy) {
    unique.add(legacy)
  }

  return Array.from(unique)
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

function normalizeLegacyImagePath(raw: string): string {
  if (raw.startsWith('/generated-images/')) {
    const filename = raw.slice('/generated-images/'.length)
    return filename ? `/api/image/file/${encodeURIComponent(filename)}` : raw
  }
  return raw
}

function toImageUrlInput(value?: string): string | undefined {
  if (!value) return undefined

  const raw = value.trim()
  if (!raw) return undefined

  const normalizedPath = normalizeLegacyImagePath(raw)

  const dataUriMatch = normalizedPath.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if (dataUriMatch?.[2]) {
    const payload = dataUriMatch[2].replace(/\s+/g, '')
    const mimeType = detectImageMimeType(payload)
    return `data:${mimeType};base64,${payload}`
  }

  if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
    return normalizedPath
  }

  if (normalizedPath.startsWith('/') && !isLikelyBase64Image(normalizedPath)) {
    return normalizedPath
  }

  const payload = normalizedPath.replace(/\s+/g, '')
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
  characterImages?: string[]
  environmentImage?: string
  maxReferenceImages?: number
}): string[] {
  const { characterImages = [], environmentImage } = options
  const maxReferenceImages = Math.max(1, Math.min(9, Math.round(options.maxReferenceImages ?? 3)))
  const normalizedCharacters: string[] = []
  const seenReference = new Set<string>()

  for (const image of characterImages) {
    const normalized = toImageUrlInput(image)
    if (!normalized || seenReference.has(normalized)) continue
    seenReference.add(normalized)
    normalizedCharacters.push(normalized)
  }

  const normalizedEnvironment = toImageUrlInput(environmentImage)

  // 多参考图模式优先将环境图放在第一位，后续补角色图
  const ordered: string[] = []
  if (normalizedEnvironment && !seenReference.has(normalizedEnvironment)) {
    ordered.push(normalizedEnvironment)
    seenReference.add(normalizedEnvironment)
  }

  for (const characterImage of normalizedCharacters) {
    if (ordered.length >= maxReferenceImages) break
    ordered.push(characterImage)
  }

  return ordered.slice(0, maxReferenceImages)
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

  // 资产一致性流程优先尊重工作流/全局模型配置：
  // - 非关键能力缺失时仅降级输入策略（多参考 -> 单图/文本）
  // - 仅在“需要多参考图且可灵普通模型不支持”时自动切到 Omni
  if (options.needReferenceImages && !preferred.supportReferenceImages) {
    // 可灵普通模型（如 kling-v3）不支持 referenceImages；
    // 当场景明确需要多参考图时，自动切换到可灵 Omni 以确保参考图真正生效。
    if (preferred.provider === 'kling') {
      const omniFallbacks = [
        kling.KlingVideoModels.KLING_V3_OMNI,
        kling.KlingVideoModels.KLING_VIDEO_O1
      ]
      for (const fallbackModelId of omniFallbacks) {
        const fallbackModel = findVideoModel(fallbackModelId)
        if (fallbackModel?.supportReferenceImages) {
          return {
            modelId: fallbackModel.model,
            reason: `fallback-to-omni:${fallbackModel.model}`
          }
        }
      }
    }

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
  const characterImages = resolveCharacterReferenceImages({
    legacyCharacterImage: references.characterImage,
    characterImages: references.characterImages
  })
  const primaryCharacterImage = characterImages[0]
  const hasCharactersInScene = hasSceneCharacters(scene)
  const hasCharacterRef = characterImages.length > 0
  const hasEnvironmentRef = !!environmentImage
  const candidateReferenceImagesForDecision = buildVideoReferenceImages({
    characterImages,
    environmentImage,
    maxReferenceImages: 9
  })
  const wantsMultiReference = hasCharactersInScene && candidateReferenceImagesForDecision.length > 1

  const workflowModels = await getWorkflowModels()
  const preferredModelId = workflowModels.video_generation
  const primaryReferenceCandidate = environmentImage || primaryCharacterImage

  const modelDecision = resolveCompatibleModel(preferredModelId, {
    needImageInput: !!primaryReferenceCandidate,
    needReferenceImages: wantsMultiReference
  })

  const selectedModel = findVideoModel(modelDecision.modelId)
  const referenceLimit = Math.max(
    1,
    Math.min(
      9,
      Math.round(
        selectedModel?.maxReferenceImages
          ?? (selectedModel?.supportReferenceImages ? 3 : 1)
      )
    )
  )
  const candidateReferenceImages = buildVideoReferenceImages({
    characterImages,
    environmentImage,
    maxReferenceImages: referenceLimit
  })
  const supportsMultiReferenceImages = !!selectedModel?.supportReferenceImages && referenceLimit > 1
  const multiReferenceImages = supportsMultiReferenceImages && wantsMultiReference
    ? candidateReferenceImages
    : []

  // 说明：
  // - 可灵非多参考图模式下，imageUrl 会进入 image2video，被当作“首帧”而非纯参考图
  // - 资产一致性流程里优先用环境图做单图输入，避免角色参考图意外变成首帧
  const preferEnvironmentAsPrimary = selectedModel?.provider === 'kling' && !supportsMultiReferenceImages

  // Gemini 多参考图时优先环境图作为单图输入，保留空间构图；
  // 可灵单图模式也优先环境图，防止角色图被强制首帧化；
  // 其它模型仍优先角色图锁身份。
  const primaryReference = hasCharactersInScene
    ? (supportsMultiReferenceImages || preferEnvironmentAsPrimary
        ? (environmentImage || primaryCharacterImage)
        : (primaryCharacterImage || environmentImage))
    : (environmentImage || primaryCharacterImage)

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
        referenceImageLimit: referenceLimit,
        referenceImagesCount: multiReferenceImages.length,
        characterReferenceCount: characterImages.length,
        primaryReferenceType: hasCharactersInScene
          ? (supportsMultiReferenceImages || preferEnvironmentAsPrimary
              ? (environmentImage ? 'environment' : primaryCharacterImage ? 'character' : 'none')
              : (primaryCharacterImage ? 'character' : environmentImage ? 'environment' : 'none'))
          : (environmentImage ? 'environment' : primaryCharacterImage ? 'character' : 'none'),
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
