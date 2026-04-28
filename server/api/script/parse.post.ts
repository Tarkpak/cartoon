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

function estimateRecommendedMinScenes(textLength: number, scriptParseMode: ScriptParseMode): number {
  const safeLength = Math.max(0, Math.floor(textLength))

  // 推荐值用于提示模型“场景密度”，不应过高到超出单次输出承载能力。
  // 这里采用中等密度估算：长文本应显著增加场景，但仍保持可生成范围。
  if (scriptParseMode === 'short_drama') {
    const shortDramaScenes = Math.ceil(safeLength / 1000) + 2
    return Math.max(8, Math.min(60, shortDramaScenes))
  }

  // 精品剧更强调细节延展，密度略低于短剧但仍需随篇幅增长。
  const premiumDramaScenes = Math.ceil(safeLength / 1300) + 1
  return Math.max(4, Math.min(45, premiumDramaScenes))
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

  const { text, workflowType, style, scriptParseMode } = parseResult.data
  const normalizedWorkflow = normalizeProjectWorkflowType(workflowType)
  const normalizedScriptParseMode = normalizeScriptParseMode(scriptParseMode)
  const eraHint = resolveScriptEraHint({
    text,
    style
  })
  const parsingPromptTemplateId: PromptTemplateId = normalizedScriptParseMode === 'short_drama'
    ? PROMPT_TEMPLATE_IDS.SCRIPT_PARSING_SHORT_DRAMA
    : PROMPT_TEMPLATE_IDS.SCRIPT_PARSING

  try {
    const textLength = text.trim().length
    const recommendedMinScenes = estimateRecommendedMinScenes(textLength, normalizedScriptParseMode)
    const promptLang = await getPromptLang(parsingPromptTemplateId, normalizedWorkflow)
    const scriptParseModeLabel = resolveScriptParseModeLabel(normalizedScriptParseMode, promptLang)

    // 2. 从数据库获取提示词模板
    const interpolatedPrompt = await getInterpolatedPrompt(
      parsingPromptTemplateId,
      {
        novelText: text,
        style: style?.trim() || '默认画风',
        textLength: String(text.trim().length),
        recommendedMinScenes: String(recommendedMinScenes),
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
    const prompt = interpolatedPrompt

    // 3. 使用业务模型配置的模型解析
    const result = await generateJSONForWorkflow<ParsedScript>('script_parsing', {
      prompt,
      temperature: 0.3,
      maxRetries: 2
    })

    // 4. 归一化并验证输出格式
    const normalizedResult = normalizeParsedScriptOutput(result, {
      fallbackEra: eraHint
    })
    const validated = ParsedScriptSchema.safeParse(normalizedResult)
    if (!validated.success) {
      console.error('[ScriptParse] 输出格式验证失败:', validated.error)
      throw createError({
        statusCode: 500,
        statusMessage: '解析结果格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
    }

    const finalParsedScript = validated.data
    const timelineScript = buildFormattedTimelineScript(finalParsedScript)

    return {
      success: true,
      data: finalParsedScript,
      formattedTimeline: timelineScript,
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
