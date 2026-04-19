import { z } from 'zod'
import {
  findVideoModel
} from '../../../utils/model-provider'
import * as kling from '../../../utils/kling'
import { getWorkflowModels } from '../../models/workflow.get'
import { getInterpolatedPrompt } from '../../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../../shared/types/prompt-template'
import { resolveTimeOfDayText } from '../../../../shared/types/script'

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
  sceneIndex: z.number().int().min(1).optional(),
  description: z.string(),
  cameraNote: z.string().optional(),
  duration: z.number().optional(),
  setting: SceneSettingSchema,
  narration: z.string().optional(),
  characters: z.array(SceneCharacterSchema).optional().default([]),
  dialogues: z.array(SceneDialogueSchema).optional().default([])
})

const EnvironmentReferenceAssetSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.literal('environment').optional(),
  image: z.string().optional()
}).optional()
const CharacterReferenceAssetSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.enum(['character', 'prop', 'other']).optional(),
  image: z.string()
})

const RequestSchema = z.object({
  scene: SceneSchema,
  style: z.string().optional().default(''),
  aspectRatio: AspectRatioSchema.optional().default('16:9'),
  references: z.object({
    environmentImage: z.string().optional(),
    characterImage: z.string().optional(),
    characterImages: z.array(z.string()).optional(),
    environmentAsset: EnvironmentReferenceAssetSchema,
    characterAssets: z.array(CharacterReferenceAssetSchema).optional()
  })
}).superRefine((payload, ctx) => {
  const hasEnvironment = (
    typeof payload.references.environmentImage === 'string'
    && payload.references.environmentImage.trim().length > 0
  ) || (
    typeof payload.references.environmentAsset?.image === 'string'
    && payload.references.environmentAsset.image.trim().length > 0
  )
  const hasLegacyCharacter = typeof payload.references.characterImage === 'string'
    && payload.references.characterImage.trim().length > 0
  const hasCharacterArray = Array.isArray(payload.references.characterImages)
    && payload.references.characterImages.some(item => typeof item === 'string' && item.trim().length > 0)
  const hasCharacterAssets = Array.isArray(payload.references.characterAssets)
    && payload.references.characterAssets.some(item => typeof item.image === 'string' && item.image.trim().length > 0)
  const hasCharacter = hasLegacyCharacter || hasCharacterArray || hasCharacterAssets

  if (!hasEnvironment && !hasCharacter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['references'],
      message: '至少提供一张参考图'
    })
  }
})

type InputMode = 'single_image' | 'text_only'
type ReferenceAssetKind = 'environment' | 'character' | 'prop' | 'other'

interface ReferenceAssetBinding {
  assetId: string
  name: string
  type: ReferenceAssetKind
  image: string
  normalizedImage: string
}

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

function resolveReferenceTypeLabel(type: ReferenceAssetKind): string {
  if (type === 'environment') return '环境'
  if (type === 'prop') return '道具'
  if (type === 'other') return '其他'
  return '角色'
}

function normalizeReferenceAssetName(name: string | undefined, fallback: string): string {
  const normalized = name?.trim()
  return normalized || fallback
}

function resolveEnvironmentReferenceBinding(options: {
  scene: z.infer<typeof SceneSchema>
  environmentImage?: string
  environmentAsset?: z.infer<typeof EnvironmentReferenceAssetSchema>
}): ReferenceAssetBinding | undefined {
  const rawImage = normalizeImageInput(options.environmentImage || options.environmentAsset?.image)
  const normalizedImage = toImageUrlInput(rawImage)
  if (!rawImage || !normalizedImage) return undefined

  const assetId = options.environmentAsset?.id?.trim() || `env:${options.scene.id}`
  const fallbackName = options.scene.setting?.location?.trim() || options.scene.title || '环境'
  const name = normalizeReferenceAssetName(options.environmentAsset?.name, fallbackName)

  return {
    assetId,
    name,
    type: 'environment',
    image: rawImage,
    normalizedImage
  }
}

function resolveCharacterReferenceBindings(options: {
  scene: z.infer<typeof SceneSchema>
  characterImages: string[]
  characterAssets?: z.infer<typeof CharacterReferenceAssetSchema>[]
}): ReferenceAssetBinding[] {
  const { scene, characterImages } = options
  const characterAssets = Array.isArray(options.characterAssets) ? options.characterAssets : []

  const metadataBuckets = new Map<string, z.infer<typeof CharacterReferenceAssetSchema>[]>()
  for (const item of characterAssets) {
    const rawImage = normalizeImageInput(item.image)
    const normalizedImage = toImageUrlInput(rawImage)
    if (!rawImage || !normalizedImage) continue

    const existing = metadataBuckets.get(normalizedImage) || []
    existing.push(item)
    metadataBuckets.set(normalizedImage, existing)
  }

  const bindings: ReferenceAssetBinding[] = []
  const seenNormalized = new Set<string>()

  const appendBinding = (rawImage: string, fallbackIndex: number) => {
    const normalizedImage = toImageUrlInput(rawImage)
    if (!normalizedImage || seenNormalized.has(normalizedImage)) return

    const bucket = metadataBuckets.get(normalizedImage) || []
    const metadata = bucket.shift()
    if (bucket.length === 0) {
      metadataBuckets.delete(normalizedImage)
    } else {
      metadataBuckets.set(normalizedImage, bucket)
    }

    const type: ReferenceAssetKind = metadata?.type === 'prop'
      ? 'prop'
      : metadata?.type === 'other'
        ? 'other'
        : 'character'
    const fallbackName = scene.characters[fallbackIndex]?.name?.trim() || `角色参考${fallbackIndex + 1}`
    const name = normalizeReferenceAssetName(metadata?.name, fallbackName)
    const assetId = metadata?.id?.trim() || `${type}:auto_${fallbackIndex + 1}`

    seenNormalized.add(normalizedImage)
    bindings.push({
      assetId,
      name,
      type,
      image: rawImage,
      normalizedImage
    })
  }

  characterImages.forEach((rawImage, index) => appendBinding(rawImage, index))

  for (const bucket of metadataBuckets.values()) {
    for (const metadata of bucket) {
      const rawImage = normalizeImageInput(metadata.image)
      if (!rawImage) continue
      appendBinding(rawImage, bindings.length)
    }
  }

  return bindings
}

function buildVideoReferenceBindings(options: {
  environmentBinding?: ReferenceAssetBinding
  characterBindings?: ReferenceAssetBinding[]
  maxReferenceImages?: number
}): ReferenceAssetBinding[] {
  const { environmentBinding, characterBindings = [] } = options
  const maxReferenceImages = Math.max(1, Math.min(9, Math.round(options.maxReferenceImages ?? 3)))
  const seenReference = new Set<string>()
  const ordered: ReferenceAssetBinding[] = []

  const appendBinding = (binding?: ReferenceAssetBinding) => {
    if (!binding) return
    if (seenReference.has(binding.normalizedImage)) return
    seenReference.add(binding.normalizedImage)
    ordered.push({
      ...binding,
      image: binding.normalizedImage
    })
  }

  appendBinding(environmentBinding)
  for (const characterBinding of characterBindings) {
    if (ordered.length >= maxReferenceImages) break
    appendBinding(characterBinding)
  }

  return ordered.slice(0, maxReferenceImages)
}

function resolveReferenceBindingByImage(
  image: string | undefined,
  bindings: ReferenceAssetBinding[]
): ReferenceAssetBinding | undefined {
  const normalized = toImageUrlInput(image)
  if (!normalized) return undefined

  return bindings.find(item => item.normalizedImage === normalized)
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
    resolveTimeOfDayText(setting.timeOfDay),
    setting.mood,
    setting.weather
  ]
    .filter(Boolean)
    .join(' / ') || '未提供'
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clipText(value: string, maxChars = 120): string {
  const compacted = compactText(value)
  if (compacted.length <= maxChars) return compacted
  return `${compacted.slice(0, maxChars)}...`
}

function resolveSceneShotNumber(scene: z.infer<typeof SceneSchema>): number {
  if (typeof scene.sceneIndex === 'number' && Number.isFinite(scene.sceneIndex) && scene.sceneIndex >= 1) {
    return Math.max(1, Math.round(scene.sceneIndex))
  }

  const candidates = [scene.title, scene.id]
  for (const candidate of candidates) {
    if (!candidate) continue
    const match = candidate.match(/(\d+)/)
    if (!match?.[1]) continue
    const parsed = Number.parseInt(match[1], 10)
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed
    }
  }

  return 1
}

const TIMELINE_LINE_CAPTURE_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:].+$/gmu
const TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]\s*/u
const STRUCTURED_DESCRIPTION_HEADING_REGEX = /^(?:场景功能\/情绪定位|场景功能|情绪定位|镜头设计|声音设计|台词节奏|表演关键点|Scene function \/ emotional beat|Shot design|Sound design|Dialogue rhythm|Performance notes)\s*[：:]?\s*$/u

function extractTimelineLines(text: string): string[] {
  if (!text) return []
  const matches = text.match(TIMELINE_LINE_CAPTURE_REGEX) || []
  return matches
    .map(line => line.trim())
    .filter(Boolean)
}

function buildSceneDescriptionSummaryText(text: string): string {
  const timelineLines = extractTimelineLines(text)
  if (timelineLines.length > 0) {
    return timelineLines
      .slice(0, 2)
      .map(line => line.replace(TIMELINE_PREFIX_REGEX, '').trim())
      .join(' ')
      .trim()
  }

  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => !!line && !STRUCTURED_DESCRIPTION_HEADING_REGEX.test(line))
    .slice(0, 3)
    .join(' ')
    .trim()
}

function buildTimelineFallbackLine(scene: z.infer<typeof SceneSchema>, duration: number): string {
  const settingText = buildSettingText(scene.setting)
  const lineBody = [
    clipText(scene.description, 160),
    hasText(scene.cameraNote) ? `镜头备注：${clipText(scene.cameraNote!, 90)}` : '',
    settingText !== '未提供' ? `环境：${settingText}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return `0-${duration}秒：，中景，固定镜头。${lineBody || '保持动作与空间关系自然推进。'}`
}

function buildSceneTimelineText(scene: z.infer<typeof SceneSchema>, duration: number): string {
  const timelineLines = extractTimelineLines(scene.description)
  if (timelineLines.length > 0) {
    return timelineLines.join('\n')
  }

  return buildTimelineFallbackLine(scene, duration)
}

function buildSceneSummary(scene: z.infer<typeof SceneSchema>): string {
  const settingText = buildSettingText(scene.setting)
  return [
    scene.title?.trim() || '',
    settingText !== '未提供' ? settingText : '',
    clipText(buildSceneDescriptionSummaryText(scene.description), 90)
  ]
    .filter(Boolean)
    .join('，')
}

function buildReferenceMaterialLines(options: {
  primaryReferenceBinding?: ReferenceAssetBinding
  multiReferenceBindings: ReferenceAssetBinding[]
}): string[] {
  const { primaryReferenceBinding, multiReferenceBindings } = options
  const activeBindings = multiReferenceBindings.length > 0
    ? multiReferenceBindings
    : (primaryReferenceBinding ? [primaryReferenceBinding] : [])
  const lines: string[] = []

  if (activeBindings.length === 0) {
    lines.push('仅文本生成，无可用参考图。')
    return lines
  }

  activeBindings.forEach((binding, index) => {
    const figure = index + 1
    const label = resolveReferenceTypeLabel(binding.type)
    const detail = binding.type === 'environment'
      ? '锁定空间布局、光照与色调'
      : binding.type === 'prop'
        ? '锁定关键道具形态、材质与尺度'
        : binding.type === 'other'
          ? '锁定其他关键视觉资产的形态与质感'
          : '锁定角色身份、发型、服饰与体态'
    lines.push(`图${figure}：${label}参考图（${binding.name}，${detail}）`)
  })

  return lines
}

interface StructuredPromptSections {
  shotNumber: number
  sceneTitle: string
  sceneSummary: string
  style: string
  duration: number
  aspectRatio: z.infer<typeof AspectRatioSchema>
  timelineLines: string
  referenceMaterials: string
  executionConstraints: string
}

function buildStructuredPromptSections(options: {
  scene: z.infer<typeof SceneSchema>
  style: string
  aspectRatio: z.infer<typeof AspectRatioSchema>
  duration: number
  inputMode: InputMode
  referenceGuide: string
  hasCharacterRef: boolean
  hasEnvironmentRef: boolean
  primaryReferenceBinding?: ReferenceAssetBinding
  multiReferenceBindings: ReferenceAssetBinding[]
}): StructuredPromptSections {
  const {
    scene,
    style,
    aspectRatio,
    duration,
    inputMode,
    referenceGuide,
    hasCharacterRef,
    hasEnvironmentRef,
    primaryReferenceBinding,
    multiReferenceBindings
  } = options

  const shotNumber = resolveSceneShotNumber(scene)
  const sceneTitle = scene.title || scene.id
  const timelineLines = buildSceneTimelineText(scene, duration)
  const referenceMaterialLines = buildReferenceMaterialLines({
    primaryReferenceBinding,
    multiReferenceBindings
  })

  const executionConstraints = [
    `- 输入模式：${inputMode}。${referenceGuide}`,
    `- 角色参考图：${hasCharacterRef ? 'yes' : 'no'}；环境参考图：${hasEnvironmentRef ? 'yes' : 'no'}`,
    '- 严格保持角色身份、服装、发型与体态连续，禁止中途换脸或替换主角。',
    '- 严格保持环境空间关系、光照与主色调稳定，不新增无关关键物体。',
    '- 禁止生成字幕、台词卡、UI、Logo 或水印。'
  ].join('\n')

  return {
    shotNumber,
    sceneTitle,
    sceneSummary: buildSceneSummary(scene),
    style: style || '保持项目风格一致',
    duration,
    aspectRatio,
    timelineLines,
    referenceMaterials: referenceMaterialLines.join('\n'),
    executionConstraints
  }
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

  const environmentImage = normalizeImageInput(references.environmentImage || references.environmentAsset?.image)
  const rawCharacterImages = resolveCharacterReferenceImages({
    legacyCharacterImage: references.characterImage,
    characterImages: references.characterImages
  })
  const environmentReferenceBinding = resolveEnvironmentReferenceBinding({
    scene,
    environmentImage,
    environmentAsset: references.environmentAsset
  })
  const characterReferenceBindings = resolveCharacterReferenceBindings({
    scene,
    characterImages: rawCharacterImages,
    characterAssets: references.characterAssets
  })
  const characterImages = characterReferenceBindings.map(item => item.image)
  const primaryCharacterImage = characterImages[0]
  const hasCharactersInScene = hasSceneCharacters(scene)
  const hasCharacterRef = characterReferenceBindings.length > 0
  const hasEnvironmentRef = !!environmentReferenceBinding
  const candidateReferenceBindingsForDecision = buildVideoReferenceBindings({
    characterBindings: characterReferenceBindings,
    environmentBinding: environmentReferenceBinding,
    maxReferenceImages: 9
  })
  const wantsMultiReference = hasCharactersInScene && candidateReferenceBindingsForDecision.length > 1

  const workflowModels = await getWorkflowModels()
  const preferredModelId = workflowModels.video_generation
  const primaryReferenceCandidate = environmentReferenceBinding?.image || primaryCharacterImage

  const modelDecision = resolveCompatibleModel(preferredModelId, {
    needImageInput: !!primaryReferenceCandidate,
    needReferenceImages: wantsMultiReference
  })

  const selectedModel = findVideoModel(modelDecision.modelId)
  const referenceLimit = Math.max(
    1,
    Math.min(
      9,
      Math.round(selectedModel?.maxReferenceImages ?? (selectedModel?.supportReferenceImages ? 3 : 1))
    )
  )
  const candidateReferenceBindings = buildVideoReferenceBindings({
    characterBindings: characterReferenceBindings,
    environmentBinding: environmentReferenceBinding,
    maxReferenceImages: referenceLimit
  })
  const supportsMultiReferenceImages = !!selectedModel?.supportReferenceImages && referenceLimit > 1
  const multiReferenceBindings = supportsMultiReferenceImages && wantsMultiReference
    ? candidateReferenceBindings
    : []
  const multiReferenceImages = multiReferenceBindings.map(item => item.image)

  // 说明：
  // - 可灵非多参考图模式下，imageUrl 会进入 image2video，被当作“首帧”而非纯参考图
  // - 资产一致性流程里优先用环境图做单图输入，避免角色参考图意外变成首帧
  const preferEnvironmentAsPrimary = selectedModel?.provider === 'kling' && !supportsMultiReferenceImages

  // Gemini 多参考图时优先环境图作为单图输入，保留空间构图；
  // 可灵单图模式也优先环境图，防止角色图被强制首帧化；
  // 其它模型仍优先角色图锁身份。
  const primaryReference = hasCharactersInScene
    ? (supportsMultiReferenceImages || preferEnvironmentAsPrimary
        ? (environmentReferenceBinding?.image || primaryCharacterImage)
        : (primaryCharacterImage || environmentReferenceBinding?.image))
    : (environmentReferenceBinding?.image || primaryCharacterImage)

  const allReferenceBindings = [
    ...(environmentReferenceBinding ? [environmentReferenceBinding] : []),
    ...characterReferenceBindings
  ]
  const primaryReferenceBinding = resolveReferenceBindingByImage(primaryReference, allReferenceBindings)

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
  const finalDuration = clampDuration(scene.duration)
  const promptSections = buildStructuredPromptSections({
    scene,
    style,
    aspectRatio,
    duration: finalDuration,
    inputMode,
    referenceGuide,
    hasCharacterRef,
    hasEnvironmentRef,
    primaryReferenceBinding,
    multiReferenceBindings
  })
  const settingText = buildSettingText(scene.setting)
  const dialogueLines = scene.dialogues
    .map(item => `${item.character}: ${item.text}`)
    .join('\n')
  const narrationText = hasText(scene.narration) ? scene.narration.trim() : ''
  const interpolatedPrompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.SCENE_VIDEO_GENERATION,
    {
      shotNumber: String(promptSections.shotNumber),
      sceneTitle: promptSections.sceneTitle,
      sceneSummary: promptSections.sceneSummary,
      style: promptSections.style,
      duration: String(finalDuration),
      aspectRatio,
      timelineLines: promptSections.timelineLines,
      audioConstraint: '',
      referenceMaterials: promptSections.referenceMaterials,
      executionConstraints: promptSections.executionConstraints,
      // 兼容旧模板变量（让历史自定义模板继续可用）
      sceneDescription: scene.description,
      setting: [
        settingText,
        multiReferenceImages.length > 0 ? `参考图策略：多参考图模式（${multiReferenceImages.length} 张）` : '',
        hasText(scene.cameraNote) ? `镜头与资产备注：${scene.cameraNote!.trim()}` : ''
      ].filter(Boolean).join('\n'),
      referenceGuide,
      inputMode,
      hasCharacterRef: hasCharacterRef ? 'yes' : 'no',
      hasEnvironmentRef: hasEnvironmentRef ? 'yes' : 'no',
      narration: narrationText || '无',
      dialogues: dialogueLines || '无'
    },
    undefined,
    'asset_consistency'
  )
  if (!interpolatedPrompt) {
    console.error('[AssetWorkflow/Video] 场景视频生成模板缺失，请检查提示词配置')
    throw new Error('无法获取场景视频生成模板，请在设置中检查提示词配置')
  }
  const prompt = interpolatedPrompt

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
        characterReferenceCount: characterReferenceBindings.length,
        primaryReferenceType: hasCharactersInScene
          ? (supportsMultiReferenceImages || preferEnvironmentAsPrimary
              ? (environmentReferenceBinding ? 'environment' : primaryCharacterImage ? 'character' : 'none')
              : (primaryCharacterImage ? 'character' : environmentReferenceBinding ? 'environment' : 'none'))
          : (environmentReferenceBinding ? 'environment' : primaryCharacterImage ? 'character' : 'none'),
        hasCharacterRef,
        hasEnvironmentRef,
        referenceBindings: (multiReferenceBindings.length > 0
          ? multiReferenceBindings
          : (primaryReferenceBinding ? [primaryReferenceBinding] : [])
        ).map((binding, index) => ({
          figure: `图${index + 1}`,
          assetId: binding.assetId,
          assetName: binding.name,
          assetType: binding.type
        }))
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
