import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { getInterpolatedPrompt, getPromptLang } from '../../utils/prompt-template'
import {
  PROMPT_TEMPLATE_IDS,
  type PromptTemplateId
} from '../../../shared/types/prompt-template'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import {
  normalizeScriptParseMode,
  resolveScriptParseModeLabel,
  normalizeTimeOfDayValue,
  normalizeOptionalSceneEraValue,
  inferSceneEraFromText,
  ParseScriptRequestSchema,
  ParsedScriptSchema,
  type ScriptParseMode,
  type ParsedScript,
  type SceneEra
} from '../../../shared/types/script'

const SCRIPT_MIN_DURATION = 2
const SCRIPT_MAX_DURATION = 15
const DEFAULT_SCENE_DURATION = 8
const DEFAULT_SHOT_TYPE = 'medium'
const VALID_SHOT_TYPE = new Set([
  'extreme_wide',
  'wide',
  'medium_wide',
  'medium',
  'medium_close',
  'close',
  'extreme_close',
  'detail'
])
const SHOT_TYPE_LABEL_MAP: Record<string, string> = {
  extreme_wide: '大远景',
  wide: '全景',
  medium_wide: '中全景',
  medium: '中景',
  medium_close: '中近景',
  close: '近景',
  extreme_close: '特写',
  detail: '细节特写'
}

const DEFAULT_CAMERA_MOVEMENT = 'static'
const VALID_CAMERA_MOVEMENT = new Set([
  'static',
  'push',
  'pull',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'track',
  'dolly',
  'zoom_in',
  'zoom_out',
  'crane',
  'handheld',
  'arc'
])
const CAMERA_MOVEMENT_LABEL_MAP: Record<string, string> = {
  static: '固定镜头',
  push: '缓慢推近',
  pull: '缓慢拉远',
  pan_left: '镜头左摇',
  pan_right: '镜头右摇',
  tilt_up: '镜头上摇',
  tilt_down: '镜头下摇',
  track: '跟随镜头',
  dolly: '移镜头',
  zoom_in: '变焦推近',
  zoom_out: '变焦拉远',
  crane: '升降镜头',
  handheld: '手持镜头',
  arc: '环绕镜头'
}
const TIMELINE_LINE_CAPTURE_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:].+$/gmu
const TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]\s*/u
const STRUCTURED_DESCRIPTION_HEADING_REGEX = /^(?:场景功能\/情绪定位|场景功能|情绪定位|镜头设计|声音设计|台词节奏|表演关键点|Scene function \/ emotional beat|Shot design|Sound design|Dialogue rhythm|Performance notes)\s*[：:]?\s*$/u
const LIVE_ACTION_STYLE_HINT_REGEX = /(ai\s*真人|live[-\s]?action|真人剧|live action)/iu
const LONG_SCRIPT_SEGMENT_THRESHOLD = 15_000
const LONG_SCRIPT_TARGET_CHARS = 15_000
const LONG_SCRIPT_OVERLAP_CHARS = 1_200
const LONG_SCRIPT_MAX_SEGMENTS = 12
const CHUNK_RECOMMENDED_MIN_SCENES_FLOOR = 4

type ParsedScriptCharacterRole = NonNullable<ParsedScript['characters'][number]['role']>
const CHARACTER_ROLE_PRIORITY: Record<ParsedScriptCharacterRole, number> = {
  protagonist: 3,
  antagonist: 2,
  supporting: 1
}

function resolveSceneCountHint(maxScenesHint?: number): number | undefined {
  if (typeof maxScenesHint !== 'number' || !Number.isFinite(maxScenesHint) || maxScenesHint <= 0) {
    return undefined
  }
  return Math.max(1, Math.min(240, Math.round(maxScenesHint)))
}

function normalizeScriptInputText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

function splitScriptTextByWindow(options: {
  text: string
  targetChars: number
  overlapChars: number
  maxSegments: number
}): string[] {
  const safeTargetChars = Math.max(2_000, Math.floor(options.targetChars))
  const safeOverlapChars = Math.max(
    0,
    Math.min(Math.floor(options.overlapChars), Math.floor(safeTargetChars / 2))
  )
  const chunks: string[] = []
  let start = 0

  while (start < options.text.length && chunks.length < options.maxSegments) {
    let end = Math.min(options.text.length, start + safeTargetChars)

    if (end < options.text.length) {
      const minBreakPosition = start + Math.floor(safeTargetChars * 0.6)
      const doubleBreak = options.text.lastIndexOf('\n\n', end)
      if (doubleBreak >= minBreakPosition) {
        end = doubleBreak
      } else {
        const singleBreak = options.text.lastIndexOf('\n', end)
        if (singleBreak >= minBreakPosition) {
          end = singleBreak
        }
      }
    }

    if (end <= start) {
      end = Math.min(options.text.length, start + safeTargetChars)
    }

    const chunkText = options.text.slice(start, end).trim()
    if (chunkText) {
      chunks.push(chunkText)
    }

    if (end >= options.text.length) break

    const nextStart = Math.max(0, end - safeOverlapChars)
    start = nextStart > start ? nextStart : end
  }

  if (start < options.text.length && chunks.length > 0) {
    const remainingText = options.text.slice(start).trim()
    if (remainingText) {
      if (chunks.length >= options.maxSegments) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n\n${remainingText}`
      } else {
        chunks.push(remainingText)
      }
    }
  }

  if (chunks.length === 0) {
    return [options.text.trim()]
  }

  return chunks
}

function buildScriptParsingChunks(text: string): string[] {
  const normalizedText = normalizeScriptInputText(text)
  if (!normalizedText) return []
  if (normalizedText.length <= LONG_SCRIPT_SEGMENT_THRESHOLD) return [normalizedText]

  return splitScriptTextByWindow({
    text: normalizedText,
    targetChars: LONG_SCRIPT_TARGET_CHARS,
    overlapChars: LONG_SCRIPT_OVERLAP_CHARS,
    maxSegments: LONG_SCRIPT_MAX_SEGMENTS
  })
}

function buildSegmentedParsingPrompt(options: {
  basePrompt: string
  chunkIndex: number
  chunkCount: number
  chunkLength: number
  totalLength: number
}): string {
  const percentage = options.totalLength > 0
    ? (options.chunkLength / options.totalLength) * 100
    : 0

  return `${options.basePrompt}

【分段解析上下文（系统追加）】
- 当前仅处理原文第 ${options.chunkIndex + 1}/${options.chunkCount} 段，禁止补写未提供段落。
- 本段文本长度：约 ${options.chunkLength} 字（全量占比约 ${percentage.toFixed(1)}%）。
- 输出仍需保持原文顺序；若与前段重叠，请避免重复同一场景。`
}

function normalizeSceneDedupToken(value?: string | null): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[\s\r\n\t]+/g, '')
    .replace(/[，。！？,.!?:：'"“”‘’（）(){}<>《》、]/g, '')
    .slice(0, 120)
}

function buildSceneDedupKey(scene: ParsedScript['scenes'][number]): string {
  const location = normalizeSceneDedupToken(scene.setting?.location || '')
  const title = normalizeSceneDedupToken(scene.title || '')
  const summary = normalizeSceneDedupToken(buildSceneDescriptionSummary(scene.description || ''))
  const dialogueSeed = normalizeSceneDedupToken(
    (scene.dialogues || [])
      .slice(0, 2)
      .map(dialogue => `${dialogue.character || ''}:${dialogue.text || ''}`)
      .join('|')
  )
  return [location, title, summary || dialogueSeed].join('|')
}

function toSequentialSceneId(index: number): string {
  return `scene_${String(index + 1).padStart(3, '0')}`
}

function pickPreferredCharacterRole(
  currentRole?: ParsedScriptCharacterRole,
  nextRole?: ParsedScriptCharacterRole
): ParsedScriptCharacterRole | undefined {
  if (!currentRole) return nextRole
  if (!nextRole) return currentRole
  return CHARACTER_ROLE_PRIORITY[nextRole] > CHARACTER_ROLE_PRIORITY[currentRole]
    ? nextRole
    : currentRole
}

function mergeParsedScriptSegments(segmentResults: ParsedScript[]): ParsedScript {
  const mergedScenes: ParsedScript['scenes'] = []
  const recentSceneKeys: string[] = []

  for (const segment of segmentResults) {
    for (const scene of segment.scenes || []) {
      const dedupKey = buildSceneDedupKey(scene)
      if (dedupKey && recentSceneKeys.includes(dedupKey)) {
        continue
      }
      if (dedupKey) {
        recentSceneKeys.push(dedupKey)
        if (recentSceneKeys.length > 10) {
          recentSceneKeys.shift()
        }
      }
      mergedScenes.push(scene)
    }
  }

  const reindexedScenes = mergedScenes.map((scene, index) => ({
    ...scene,
    id: toSequentialSceneId(index)
  }))

  const mergedCharacterMap = new Map<string, ParsedScript['characters'][number]>()
  const upsertCharacter = (character: {
    name?: string | null
    description?: string | null
    role?: ParsedScriptCharacterRole
  }) => {
    const name = character.name?.trim()
    if (!name) return

    const nextDescription = character.description?.trim() || ''
    const existing = mergedCharacterMap.get(name)
    if (!existing) {
      mergedCharacterMap.set(name, {
        name,
        description: nextDescription,
        role: character.role
      })
      return
    }

    const preferredDescription = nextDescription.length > existing.description.length
      ? nextDescription
      : existing.description
    const preferredRole = pickPreferredCharacterRole(existing.role, character.role)
    mergedCharacterMap.set(name, {
      name,
      description: preferredDescription,
      role: preferredRole
    })
  }

  for (const segment of segmentResults) {
    for (const character of segment.characters || []) {
      upsertCharacter(character)
    }
  }

  for (const scene of reindexedScenes) {
    for (const character of scene.characters || []) {
      upsertCharacter({
        name: character.name,
        description: character.appearance || '',
        role: 'supporting'
      })
    }
  }

  const mergedTitle = segmentResults
    .map(segment => segment.title?.trim() || '')
    .find(Boolean)

  const totalDuration = reindexedScenes.reduce((sum, scene) => {
    return sum + normalizeSceneDuration(scene.duration)
  }, 0)

  return {
    title: mergedTitle || undefined,
    scenes: reindexedScenes,
    characters: Array.from(mergedCharacterMap.values()),
    totalDuration: Math.round(totalDuration * 10) / 10
  }
}

function resolveScriptEraHint(options: {
  text: string
  style?: string
}): SceneEra | undefined {
  const normalizedStyle = options.style?.trim() || ''
  const inferredFromText = inferSceneEraFromText(`${options.text}\n${normalizedStyle}`)
  if (inferredFromText) return inferredFromText

  if (LIVE_ACTION_STYLE_HINT_REGEX.test(normalizedStyle)) {
    return '现代'
  }

  return undefined
}

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

function inferShotTypeFromText(text: string): string {
  const value = text.toLowerCase()

  if (/大远景|极远景|establishing|extreme wide/.test(value)) return 'extreme_wide'
  if (/全景|远景|\bwide\b/.test(value)) return 'wide'
  if (/中全景|medium wide/.test(value)) return 'medium_wide'
  if (/中近景|medium close/.test(value)) return 'medium_close'
  if (/特写|close-up|close up|extreme close/.test(value)) return 'extreme_close'
  if (/近景|\bclose\b/.test(value)) return 'close'
  if (/细节|detail/.test(value)) return 'detail'
  if (/中景|\bmedium\b/.test(value)) return 'medium'

  return DEFAULT_SHOT_TYPE
}

function normalizeShotType(rawShotType: unknown, fallbackText = ''): string {
  if (typeof rawShotType === 'string') {
    const value = rawShotType.trim().toLowerCase()
    if (VALID_SHOT_TYPE.has(value)) return value
    if (value) {
      return inferShotTypeFromText(value)
    }
  }

  return inferShotTypeFromText(fallbackText)
}

function inferCameraMovementFromText(text: string): string {
  const value = text.toLowerCase()

  if (/环绕|arc/.test(value)) return 'arc'
  if (/手持|handheld/.test(value)) return 'handheld'
  if (/升降|crane/.test(value)) return 'crane'
  if (/变焦拉|zoom\s*out/.test(value)) return 'zoom_out'
  if (/变焦推|zoom\s*in/.test(value)) return 'zoom_in'
  if (/移镜|dolly/.test(value)) return 'dolly'
  if (/跟随|跟镜|track/.test(value)) return 'track'
  if (/下摇|tilt\s*down/.test(value)) return 'tilt_down'
  if (/上摇|tilt\s*up/.test(value)) return 'tilt_up'
  if (/右摇|pan\s*right/.test(value)) return 'pan_right'
  if (/左摇|pan\s*left/.test(value)) return 'pan_left'
  if (/拉远|缓慢拉|pull/.test(value)) return 'pull'
  if (/推近|缓慢推|push/.test(value)) return 'push'
  if (/固定|static/.test(value)) return 'static'

  return DEFAULT_CAMERA_MOVEMENT
}

function normalizeCameraMovement(rawCameraMovement: unknown, fallbackText = ''): string {
  if (typeof rawCameraMovement === 'string') {
    const value = rawCameraMovement.trim().toLowerCase()
    if (VALID_CAMERA_MOVEMENT.has(value)) return value
    if (value) {
      return inferCameraMovementFromText(value)
    }
  }

  return inferCameraMovementFromText(fallbackText)
}

function formatTimelineSeconds(seconds: number): string {
  const normalized = Math.round(Math.max(0, seconds) * 10) / 10
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(1).replace(/\.0$/, '')
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractTimelineLines(text: string): string[] {
  if (!text) return []
  const matches = text.match(TIMELINE_LINE_CAPTURE_REGEX) || []
  return matches
    .map(line => line.trim())
    .filter(Boolean)
}

function buildSceneDescriptionSummary(text: string): string {
  const timelineLines = extractTimelineLines(text)

  if (timelineLines.length > 0) {
    return timelineLines
      .slice(0, 2)
      .map(line => line.replace(TIMELINE_PREFIX_REGEX, '').trim())
      .join(' ')
      .trim()
  }

  const summary = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => !!line && !STRUCTURED_DESCRIPTION_HEADING_REGEX.test(line))
    .slice(0, 3)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return summary
}

function annotateFirstOccurrenceWithImageTag(text: string, keyword: string, imageIndex: number): string {
  const safeKeyword = keyword.trim()
  if (!safeKeyword) return text

  // Normalize any existing image tag chain after keyword (e.g. 角色名[图片2] or 角色名@图片2) to a single @图片N.
  const matcher = new RegExp(`${escapeRegExp(safeKeyword)}(?:\\s*(?:\\[[^\\]\\n]+\\]|@(?:图片|Image\\s*#)\\s*\\d+))*`)
  if (!matcher.test(text)) return text
  return text.replace(matcher, `${safeKeyword}@图片${imageIndex}`)
}

function buildFormattedTimelineScript(data: ParsedScript): {
  lines: string[]
  text: string
  constraints: string
} {
  const characterImageRef = new Map<string, number>()
  const locationImageRef = new Map<string, number>()
  let nextImageIndex = 1

  for (const scene of data.scenes) {
    const location = scene.setting?.location?.trim()
    if (location && !locationImageRef.has(location)) {
      locationImageRef.set(location, nextImageIndex)
      nextImageIndex += 1
    }

    for (const character of scene.characters || []) {
      const name = character.name?.trim()
      if (name && !characterImageRef.has(name)) {
        characterImageRef.set(name, nextImageIndex)
        nextImageIndex += 1
      }
    }
  }

  let cursorSeconds = 0
  const lines = data.scenes.map((scene) => {
    const start = cursorSeconds
    const duration = normalizeSceneDuration(scene.duration)
    const end = start + duration
    cursorSeconds = end

    const shotType = normalizeShotType(scene.shotType, `${scene.title || ''} ${scene.description || ''}`)
    const shotLabel = SHOT_TYPE_LABEL_MAP[shotType] || SHOT_TYPE_LABEL_MAP[DEFAULT_SHOT_TYPE]

    let annotatedDescription = buildSceneDescriptionSummary(scene.description || '')
    const location = scene.setting?.location?.trim() || ''
    const locationImageIndex = locationImageRef.get(location)
    if (locationImageIndex) {
      const locationTag = `${location}@图片${locationImageIndex}`
      annotatedDescription = annotateFirstOccurrenceWithImageTag(
        annotatedDescription,
        location,
        locationImageIndex
      )
      if (location && !annotatedDescription.includes(locationTag)) {
        annotatedDescription = annotatedDescription
          ? `${locationTag}，${annotatedDescription}`
          : locationTag
      }
    }

    const sceneCharacterNames = Array.from(new Set(
      (scene.characters || [])
        .map(character => character.name?.trim() || '')
        .filter(Boolean)
    ))
    for (const characterName of sceneCharacterNames) {
      const imageIndex = characterImageRef.get(characterName)
      if (!imageIndex) continue
      annotatedDescription = annotateFirstOccurrenceWithImageTag(
        annotatedDescription,
        characterName,
        imageIndex
      )
    }

    const dialogueText = (scene.dialogues || [])
      .map((dialogue) => {
        const speaker = dialogue.character?.trim() || '角色'
        const imageIndex = characterImageRef.get(speaker)
        const speakerWithTag = imageIndex
          ? `${speaker}@图片${imageIndex}`
          : speaker
        const content = dialogue.text?.trim() || ''
        if (!content) return ''
        return `${speakerWithTag}说：'${content}'`
      })
      .filter(Boolean)
      .join(' ')

    const narrationText = scene.narration?.trim()
      ? `画外音说：'${scene.narration.trim()}'`
      : ''

    const content = [
      annotatedDescription,
      dialogueText,
      narrationText
    ].filter(Boolean).join(' ')

    const cameraMovementLabel = CAMERA_MOVEMENT_LABEL_MAP[scene.cameraMovement || DEFAULT_CAMERA_MOVEMENT] || CAMERA_MOVEMENT_LABEL_MAP[DEFAULT_CAMERA_MOVEMENT]

    return `${formatTimelineSeconds(start)}-${formatTimelineSeconds(end)}秒：，${shotLabel}，${cameraMovementLabel}。${content}`
  })

  return {
    lines,
    text: lines.join('\n'),
    constraints: ''
  }
}

function normalizeParsedScriptOutput(
  output: unknown,
  options: {
    fallbackEra?: SceneEra
  } = {}
): unknown {
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
    const fallbackText = [
      typeof sceneObj.title === 'string' ? sceneObj.title : '',
      typeof sceneObj.description === 'string' ? sceneObj.description : '',
      typeof location === 'string' ? location : ''
    ].join(' ')
    const normalizedEra = normalizeOptionalSceneEraValue(rawSetting.era)
      || inferSceneEraFromText(fallbackText)
      || options.fallbackEra
    return {
      ...sceneObj,
      id: typeof sceneObj.id === 'string' && sceneObj.id.trim().length > 0
        ? sceneObj.id
        : `scene_${String(index + 1).padStart(3, '0')}`,
      shotType: normalizeShotType(sceneObj.shotType ?? sceneObj.shot_type, fallbackText),
      cameraMovement: normalizeCameraMovement(sceneObj.cameraMovement ?? sceneObj.camera_movement, fallbackText),
      duration: normalizeSceneDuration(sceneObj.duration),
      setting: {
        ...rawSetting,
        location,
        timeOfDay: normalizeTimeOfDayValue(rawSetting.timeOfDay),
        era: normalizedEra
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

export interface ScriptParseProgressEvent {
  step: string
  message: string
  progress?: number
  chunkIndex?: number
  chunkCount?: number
}

export interface ScriptParseExecutionInput {
  text: string
  workflowType?: 'asset_consistency'
  scriptParseMode?: ScriptParseMode
  style?: string
  maxScenes?: number
}

export interface ScriptParseExecutionResult {
  data: ParsedScript
  formattedTimeline: ReturnType<typeof buildFormattedTimelineScript>
  parseStrategy: {
    segmented: boolean
    chunkCount: number
    recommendedMinScenes?: number
    chunkRecommendedSceneHints?: number[]
  }
}

function reportScriptParseProgress(
  reporter: ((event: ScriptParseProgressEvent) => void) | undefined,
  event: ScriptParseProgressEvent
) {
  if (!reporter) return
  try {
    reporter(event)
  } catch (error) {
    console.warn('[ScriptParse] 进度回调执行失败，已忽略:', error)
  }
}

export async function executeScriptParse(
  input: ScriptParseExecutionInput & {
    onProgress?: (event: ScriptParseProgressEvent) => void
  }
): Promise<ScriptParseExecutionResult> {
  const normalizedInputText = normalizeScriptInputText(input.text)
  const normalizedWorkflow = normalizeProjectWorkflowType(input.workflowType)
  const normalizedScriptParseMode = normalizeScriptParseMode(input.scriptParseMode)
  const eraHint = resolveScriptEraHint({
    text: normalizedInputText,
    style: input.style
  })
  const parsingPromptTemplateId: PromptTemplateId = normalizedScriptParseMode === 'short_drama'
    ? PROMPT_TEMPLATE_IDS.SCRIPT_PARSING_SHORT_DRAMA
    : PROMPT_TEMPLATE_IDS.SCRIPT_PARSING

  const textLength = normalizedInputText.length
  const recommendedMinScenes = resolveSceneCountHint(input.maxScenes)

  reportScriptParseProgress(input.onProgress, {
    step: 'initializing',
    message: '正在初始化解析任务',
    progress: 5
  })

  const promptLang = await getPromptLang(parsingPromptTemplateId, normalizedWorkflow)
  const scriptParseModeLabel = resolveScriptParseModeLabel(normalizedScriptParseMode, promptLang)

  const runScriptParsePass = async (options: {
    chunkText: string
    recommendedMinScenesHint?: number
    chunkIndex?: number
    chunkCount?: number
  }): Promise<ParsedScript> => {
    const interpolatedPrompt = await getInterpolatedPrompt(
      parsingPromptTemplateId,
      {
        novelText: options.chunkText,
        style: input.style?.trim() || '默认画风',
        textLength: String(options.chunkText.length),
        recommendedMinScenes: options.recommendedMinScenesHint === undefined
          ? '由模型根据剧情承载自行决定（不设固定场数）'
          : String(options.recommendedMinScenesHint),
        sceneDurationMin: String(SCRIPT_MIN_DURATION),
        sceneDurationMax: String(SCRIPT_MAX_DURATION),
        scriptParseModeLabel,
        scriptParseModeRules: '',
        eraHint: eraHint || ''
      },
      promptLang,
      normalizedWorkflow
    )

    if (!interpolatedPrompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }

    const prompt = options.chunkCount && options.chunkCount > 1
      ? buildSegmentedParsingPrompt({
          basePrompt: interpolatedPrompt,
          chunkIndex: options.chunkIndex || 0,
          chunkCount: options.chunkCount,
          chunkLength: options.chunkText.length,
          totalLength: textLength
        })
      : interpolatedPrompt

    const result = await generateJSONForWorkflow<ParsedScript>('script_parsing', {
      prompt,
      temperature: 0.3,
      maxRetries: 2
    })

    const normalizedResult = normalizeParsedScriptOutput(result, {
      fallbackEra: eraHint
    })
    const validated = ParsedScriptSchema.safeParse(normalizedResult)
    if (!validated.success) {
      console.error('[ScriptParse] 输出格式验证失败:', validated.error)
      throw new Error(validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', '))
    }

    return validated.data
  }

  const scriptChunks = buildScriptParsingChunks(normalizedInputText)
  reportScriptParseProgress(input.onProgress, {
    step: scriptChunks.length > 1 ? 'segmenting' : 'single-pass',
    message: scriptChunks.length > 1
      ? `已拆分为 ${scriptChunks.length} 段，开始顺序解析`
      : '开始单段解析',
    progress: 12,
    chunkCount: scriptChunks.length
  })

  let finalParsedScript: ParsedScript
  const chunkRecommendedSceneHints: number[] = []

  if (scriptChunks.length <= 1) {
    reportScriptParseProgress(input.onProgress, {
      step: 'model-running',
      message: '模型解析中，请稍候',
      progress: 35,
      chunkIndex: 1,
      chunkCount: 1
    })
    finalParsedScript = await runScriptParsePass({
      chunkText: normalizedInputText,
      recommendedMinScenesHint: recommendedMinScenes
    })
  } else {
    console.log('[ScriptParse] 启用长文本分段解析:', {
      textLength,
      chunkCount: scriptChunks.length,
      recommendedMinScenes
    })

    const chunkResults: ParsedScript[] = []
    for (let index = 0; index < scriptChunks.length; index++) {
      const chunkText = scriptChunks[index]
      if (!chunkText) continue

      const chunkRatio = textLength > 0
        ? (chunkText.length / textLength)
        : (1 / scriptChunks.length)
      const chunkRecommendedMinScenes = recommendedMinScenes === undefined
        ? undefined
        : Math.max(
            CHUNK_RECOMMENDED_MIN_SCENES_FLOOR,
            Math.round(recommendedMinScenes * chunkRatio * 1.2)
          )
      if (chunkRecommendedMinScenes !== undefined) {
        chunkRecommendedSceneHints.push(chunkRecommendedMinScenes)
      }

      const chunkProgress = Math.min(
        82,
        18 + Math.round((index / scriptChunks.length) * 62)
      )
      reportScriptParseProgress(input.onProgress, {
        step: 'chunk-parsing',
        message: `正在解析第 ${index + 1}/${scriptChunks.length} 段`,
        progress: chunkProgress,
        chunkIndex: index + 1,
        chunkCount: scriptChunks.length
      })

      const parsedChunk = await runScriptParsePass({
        chunkText,
        recommendedMinScenesHint: chunkRecommendedMinScenes,
        chunkIndex: index,
        chunkCount: scriptChunks.length
      })
      chunkResults.push(parsedChunk)

      reportScriptParseProgress(input.onProgress, {
        step: 'chunk-parsed',
        message: `第 ${index + 1}/${scriptChunks.length} 段解析完成`,
        progress: Math.min(
          86,
          24 + Math.round(((index + 1) / scriptChunks.length) * 62)
        ),
        chunkIndex: index + 1,
        chunkCount: scriptChunks.length
      })
    }

    reportScriptParseProgress(input.onProgress, {
      step: 'merging',
      message: '正在合并分段结果',
      progress: 88,
      chunkCount: scriptChunks.length
    })

    const mergedResult = mergeParsedScriptSegments(chunkResults)
    const normalizedMergedResult = normalizeParsedScriptOutput(mergedResult, {
      fallbackEra: eraHint
    })
    const validatedMergedResult = ParsedScriptSchema.safeParse(normalizedMergedResult)
    if (!validatedMergedResult.success) {
      console.error('[ScriptParse] 分段结果合并后格式验证失败:', validatedMergedResult.error)
      throw new Error(validatedMergedResult.error.issues.map(i => `${i.path}: ${i.message}`).join(', '))
    }

    finalParsedScript = validatedMergedResult.data
  }

  reportScriptParseProgress(input.onProgress, {
    step: 'formatting',
    message: '正在生成时间轴展示内容',
    progress: 95
  })
  const timelineScript = buildFormattedTimelineScript(finalParsedScript)

  reportScriptParseProgress(input.onProgress, {
    step: 'completed',
    message: '解析完成',
    progress: 100
  })

  return {
    data: finalParsedScript,
    formattedTimeline: timelineScript,
    parseStrategy: {
      segmented: scriptChunks.length > 1,
      chunkCount: scriptChunks.length,
      ...(recommendedMinScenes !== undefined ? { recommendedMinScenes } : {}),
      ...(chunkRecommendedSceneHints.length > 0 ? { chunkRecommendedSceneHints } : {})
    }
  }
}

/**
 * 剧本解析 API
 * POST /api/script/parse
 *
 * 使用业务模型配置的模型智能解析小说文本，自动提取场景、角色、对话
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

  try {
    const parsed = await executeScriptParse(parseResult.data)

    return {
      success: true,
      data: parsed.data,
      formattedTimeline: parsed.formattedTimeline,
      parseStrategy: parsed.parseStrategy,
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
