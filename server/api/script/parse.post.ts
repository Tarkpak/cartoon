import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import { normalizeProjectWorkflowType } from '../../../shared/types/project'
import {
  ParseScriptRequestSchema,
  ParsedScriptSchema,
  type ParsedScript
} from '../../../shared/types/script'

const SCRIPT_MIN_DURATION = 2
const SCRIPT_MAX_DURATION = 15
const DEFAULT_SCENE_DURATION = 8
const DEFAULT_TIME_OF_DAY = 'morning'
const DEFAULT_SHOT_TYPE = 'medium'
const VALID_TIME_OF_DAY = new Set([
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'evening',
  'night'
])
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

function normalizeTimeOfDay(rawTimeOfDay: unknown): string {
  if (typeof rawTimeOfDay !== 'string') return DEFAULT_TIME_OF_DAY

  const value = rawTimeOfDay.trim().toLowerCase()
  if (!value) return DEFAULT_TIME_OF_DAY
  if (VALID_TIME_OF_DAY.has(value)) return value

  if (/none|null|unknown|n\/a|na|unspecified|未指定|未知|无/.test(value)) return DEFAULT_TIME_OF_DAY

  if (/dawn|sunrise|break of day|拂晓|黎明|凌晨/.test(value)) return 'dawn'
  if (/morning|am|forenoon|清晨|早晨|早上|上午/.test(value)) return 'morning'
  if (/noon|midday|中午|正午/.test(value)) return 'noon'
  if (/afternoon|pm|下午/.test(value)) return 'afternoon'
  if (/evening|sunset|dusk|傍晚|黄昏|日落/.test(value)) return 'evening'
  if (/night|midnight|深夜|夜晚|晚上|午夜/.test(value)) return 'night'

  return DEFAULT_TIME_OF_DAY
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

function formatTimelineSeconds(seconds: number): string {
  const normalized = Math.round(Math.max(0, seconds) * 10) / 10
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(1).replace(/\.0$/, '')
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function annotateFirstOccurrenceWithImageTag(text: string, keyword: string, imageIndex: number): string {
  const safeKeyword = keyword.trim()
  if (!safeKeyword) return text

  // Normalize any existing bracket tag chain after keyword (e.g. 角色名[角色名][图片2]) to a single [图片N].
  const matcher = new RegExp(`${escapeRegExp(safeKeyword)}(?:\\s*\\[[^\\]\\n]+\\])*`)
  if (!matcher.test(text)) return text
  return text.replace(matcher, `${safeKeyword}[图片${imageIndex}]`)
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

    let annotatedDescription = (scene.description || '').trim()
    const location = scene.setting?.location?.trim() || ''
    const locationImageIndex = locationImageRef.get(location)
    if (locationImageIndex) {
      const locationTag = `${location}[图片${locationImageIndex}]`
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
          ? `${speaker}[图片${imageIndex}]`
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

    return `${formatTimelineSeconds(start)}-${formatTimelineSeconds(end)}秒：，${shotLabel}，固定镜头。${content}`
  })

  return {
    lines,
    text: lines.join('\n'),
    constraints: ''
  }
}

function normalizeParsedScriptOutput(output: unknown): unknown {
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
      typeof sceneObj.description === 'string' ? sceneObj.description : ''
    ].join(' ')
    return {
      ...sceneObj,
      id: typeof sceneObj.id === 'string' && sceneObj.id.trim().length > 0
        ? sceneObj.id
        : `scene_${String(index + 1).padStart(3, '0')}`,
      shotType: normalizeShotType(sceneObj.shotType ?? sceneObj.shot_type, fallbackText),
      duration: normalizeSceneDuration(sceneObj.duration),
      setting: {
        ...rawSetting,
        location,
        timeOfDay: normalizeTimeOfDay(rawSetting.timeOfDay)
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
 * 使用业务流程配置的模型智能解析小说文本，自动提取场景、角色、对话
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

  const { text, workflowType, style } = parseResult.data
  const normalizedWorkflow = normalizeProjectWorkflowType(workflowType)

  try {
    const textLength = text.trim().length
    let recommendedMinScenes = 6
    if (textLength > 3200) recommendedMinScenes = 20
    else if (textLength > 2400) recommendedMinScenes = 16
    else if (textLength > 1600) recommendedMinScenes = 12
    else if (textLength > 900) recommendedMinScenes = 8

    // 2. 从数据库获取提示词模板
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.SCRIPT_PARSING,
      {
        novelText: text,
        style: style?.trim() || '默认画风',
        textLength: String(text.trim().length),
        recommendedMinScenes: String(recommendedMinScenes),
        sceneDurationMin: String(SCRIPT_MIN_DURATION),
        sceneDurationMax: String(SCRIPT_MAX_DURATION)
      },
      undefined,
      normalizedWorkflow
    )

    if (!prompt) {
      throw new Error('无法获取提示词模板，请检查数据库配置')
    }

    // 3. 使用业务流程配置的模型解析
    const result = await generateJSONForWorkflow<ParsedScript>('script_parsing', {
      prompt,
      temperature: 0.3,
      maxRetries: 2
    })

    // 4. 归一化并验证输出格式
    const normalizedResult = normalizeParsedScriptOutput(result)
    const validated = ParsedScriptSchema.safeParse(normalizedResult)
    if (!validated.success) {
      console.error('[ScriptParse] 输出格式验证失败:', validated.error)
      throw createError({
        statusCode: 500,
        statusMessage: '解析结果格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
    }

    const timelineScript = buildFormattedTimelineScript(validated.data)

    return {
      success: true,
      data: validated.data,
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
