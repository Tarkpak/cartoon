import { mergeNarrationTexts } from '~/lib/asset-workbench-scenes'
import { normalizeCharacterName } from '~/lib/asset-workbench-values'
import { normalizeCharacterGender, normalizeCharacterRole } from '#shared/types/character'
import type {
  SceneCameraMovement,
  SceneDramatic,
  SceneEnvironmentCaptureMode,
  SceneShotType
} from '#shared/types/script'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'

const SCENE_SHOT_TYPE_SET = new Set<SceneShotType>([
  'extreme_wide',
  'wide',
  'medium_wide',
  'medium',
  'medium_close',
  'close',
  'extreme_close',
  'detail'
])

const SCENE_CAMERA_MOVEMENT_SET = new Set<SceneCameraMovement>([
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

const SCENE_ENVIRONMENT_CAPTURE_MODE_SET = new Set<SceneEnvironmentCaptureMode>([
  'single',
  'four_view'
])

type ParsedSceneDramaticObject = NonNullable<SceneDramatic>
type ParsedSceneDramaticFunction = NonNullable<ParsedSceneDramaticObject['function']>
type ParsedSceneDramaticTextField = Exclude<keyof ParsedSceneDramaticObject, 'function'>

const SCENE_DRAMATIC_FUNCTION_SET = new Set<ParsedSceneDramaticFunction>([
  'hook',
  'escalation',
  'confrontation',
  'reversal',
  'payoff',
  'cliffhanger',
  'aftermath'
])

const SCENE_DRAMATIC_TEXT_FIELDS: ParsedSceneDramaticTextField[] = [
  'conflict',
  'emotionalCurve',
  'audienceHook',
  'painPoint',
  'payoff',
  'powerShift',
  'antagonistPressure',
  'protagonistCounter',
  'cliffhanger'
]

const SCENE_DRAMATIC_DESCRIPTION_LABELS: Partial<Record<ParsedSceneDramaticTextField, string>> = {
  conflict: '戏剧冲突',
  emotionalCurve: '情绪曲线',
  painPoint: '爽点\\/痛点',
  payoff: '反击或反转',
  cliffhanger: '结尾钩子'
}

const DESCRIPTION_DRAMATIC_LABEL_REGEX = /^\s*(?:戏剧冲突|爽点\s*[\/／]?\s*痛点|情绪曲线|反击或反转|结尾钩子)\s*[：:]/u
const SCENE_TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]/gmu
const MULTI_VIEW_HINT_REGEX = /(多视角|多个视角|多机位|多镜头|多景别|镜头切换|切换镜头|视角切换|镜头切到|切到|转到|angle switch|multi[- ]?angle|multi[- ]?shot)/iu
const SCENE_SHOT_KEYWORDS = [
  '全景',
  '远景',
  '中景',
  '近景',
  '特写',
  '俯拍',
  '仰拍',
  '主观镜头',
  'pov',
  'over-the-shoulder'
] as const

const NARRATION_SPEAKER_SET = new Set([
  '旁白',
  'narration',
  'voiceover',
  '画外音',
  'os',
  'vo',
  '内心独白'
].map(name => normalizeCharacterName(name)))

interface ParsedScriptScene {
  id: string
  episodeId?: string
  episodeTitle?: string
  episodeIndex?: number
  title?: string
  shotType?: unknown
  cameraMovement?: unknown
  environmentCaptureMode?: unknown
  dramatic?: unknown
  description: string
  characters?: Array<string | { name?: string, appearance?: string, emotion?: string }>
  props?: Array<string | { name?: string, description?: string }>
  dialogues?: Array<{ character?: string, speaker?: string, text?: string, emotion?: string }>
  narration?: unknown
  usePreviousLastFrameAsFirstFrame?: boolean
  continuityLinkReason?: string
  duration: number
  setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string }
}

interface ParsedScriptCharacter {
  name: string
  description?: string
  role?: string
  gender?: string
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined

  const value = raw.trim()
  return value || undefined
}

function normalizeEnumValue<T extends string>(
  raw: unknown,
  allowedValues: ReadonlySet<T>
): T | undefined {
  const value = normalizeOptionalString(raw)
  if (!value) return undefined

  return allowedValues.has(value as T) ? value as T : undefined
}

function countTimelineSegments(text: string): number {
  if (!text) return 0
  return Array.from(text.matchAll(SCENE_TIMELINE_PREFIX_REGEX)).length
}

function countShotKeywordKinds(text: string): number {
  if (!text) return 0
  const normalized = text.toLowerCase()
  let count = 0
  SCENE_SHOT_KEYWORDS.forEach((keyword) => {
    if (normalized.includes(keyword.toLowerCase())) {
      count += 1
    }
  })
  return count
}

function normalizeParsedSceneShotType(raw: unknown): SceneShotType | undefined {
  const exact = normalizeEnumValue(raw, SCENE_SHOT_TYPE_SET)
  if (exact) return exact

  const value = normalizeOptionalString(raw)
  if (!value) return undefined

  const lower = value.toLowerCase()
  if (lower === 'extreme wide' || lower === 'establishing') return 'extreme_wide'
  if (lower === 'wide shot' || lower === 'full shot') return 'wide'
  if (lower === 'medium wide') return 'medium_wide'
  if (lower === 'medium shot') return 'medium'
  if (lower === 'medium close' || lower === 'medium close-up' || lower === 'medium closeup') return 'medium_close'
  if (lower === 'close-up' || lower === 'closeup' || lower === 'close shot') return 'close'
  if (lower === 'extreme close-up' || lower === 'extreme closeup') return 'extreme_close'
  if (lower === 'detail shot' || lower === 'insert shot') return 'detail'

  if (/大远景|超远景/u.test(value)) return 'extreme_wide'
  if (/中全景/u.test(value)) return 'medium_wide'
  if (/中近景/u.test(value)) return 'medium_close'
  if (/中景/u.test(value)) return 'medium'
  if (/全景|远景/u.test(value)) return 'wide'
  if (/近景/u.test(value)) return 'close'
  if (/大特写|特写/u.test(value)) return 'extreme_close'
  if (/细节|插入镜头/u.test(value)) return 'detail'

  return undefined
}

function normalizeParsedSceneCameraMovement(raw: unknown): SceneCameraMovement | undefined {
  const exact = normalizeEnumValue(raw, SCENE_CAMERA_MOVEMENT_SET)
  if (exact) return exact

  const value = normalizeOptionalString(raw)
  if (!value) return undefined

  const lower = value.toLowerCase()
  if (lower === 'fixed' || lower === 'locked' || lower === 'still') return 'static'
  if (lower === 'push in' || lower === 'push-in') return 'push'
  if (lower === 'pull out' || lower === 'pull-out') return 'pull'
  if (lower === 'pan left') return 'pan_left'
  if (lower === 'pan right') return 'pan_right'
  if (lower === 'tilt up') return 'tilt_up'
  if (lower === 'tilt down') return 'tilt_down'
  if (lower === 'tracking' || lower === 'tracking shot') return 'track'
  if (lower === 'zoom in') return 'zoom_in'
  if (lower === 'zoom out') return 'zoom_out'
  if (lower === 'handheld shot') return 'handheld'
  if (lower === 'orbit' || lower === 'arc shot') return 'arc'

  if (/固定|定镜|静止/u.test(value)) return 'static'
  if (/推镜|推进|推近/u.test(value)) return 'push'
  if (/拉镜|拉远|后拉/u.test(value)) return 'pull'
  if (/左摇/u.test(value)) return 'pan_left'
  if (/右摇/u.test(value)) return 'pan_right'
  if (/上摇/u.test(value)) return 'tilt_up'
  if (/下摇/u.test(value)) return 'tilt_down'
  if (/跟拍|跟镜/u.test(value)) return 'track'
  if (/变焦推|放大/u.test(value)) return 'zoom_in'
  if (/变焦拉|缩小/u.test(value)) return 'zoom_out'
  if (/升降/u.test(value)) return 'crane'
  if (/手持/u.test(value)) return 'handheld'
  if (/环绕/u.test(value)) return 'arc'

  return undefined
}

function inferParsedEnvironmentCaptureMode(options: {
  description?: string
  cameraNote?: string
}): SceneEnvironmentCaptureMode {
  const description = options.description?.trim() || ''
  const cameraNote = options.cameraNote?.trim() || ''
  const text = [description, cameraNote].filter(Boolean).join('\n')
  if (!text) return 'single'

  if (countTimelineSegments(description) >= 2) return 'four_view'
  if (MULTI_VIEW_HINT_REGEX.test(text)) return 'four_view'
  if (countShotKeywordKinds(description) >= 2) return 'four_view'

  return 'single'
}

function normalizeParsedEnvironmentCaptureMode(raw: unknown): SceneEnvironmentCaptureMode | undefined {
  const exact = normalizeEnumValue(raw, SCENE_ENVIRONMENT_CAPTURE_MODE_SET)
  if (exact) return exact

  const value = normalizeOptionalString(raw)
  if (!value) return undefined

  const lower = value.toLowerCase()
  if (lower === 'single view' || lower === 'single image') return 'single'
  if (lower === 'four view' || lower === 'four views' || lower === 'multi view' || lower === 'multi-view') return 'four_view'
  if (/单视角|单张|单图/u.test(value)) return 'single'
  if (/四视图|四视角|多视角|多角度/u.test(value)) return 'four_view'

  return undefined
}

function pickDramaticTextFromDescription(description: string, labelPattern: string): string | undefined {
  const match = description.match(new RegExp(`${labelPattern}\\s*[：:]\\s*([^\\n]+)`, 'u'))
  return match?.[1]?.trim() || undefined
}

function normalizeParsedSceneDramatic(raw: unknown, fallbackDescription = ''): SceneDramatic | undefined {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const normalized: ParsedSceneDramaticObject = {}
  const rawFunction = normalizeOptionalString(source.function)
  if (rawFunction && SCENE_DRAMATIC_FUNCTION_SET.has(rawFunction as ParsedSceneDramaticFunction)) {
    normalized.function = rawFunction as ParsedSceneDramaticFunction
  }

  SCENE_DRAMATIC_TEXT_FIELDS.forEach((key) => {
    const value = normalizeOptionalString(source[key])
      || (SCENE_DRAMATIC_DESCRIPTION_LABELS[key]
        ? pickDramaticTextFromDescription(fallbackDescription, SCENE_DRAMATIC_DESCRIPTION_LABELS[key])
        : undefined)
    if (value) {
      normalized[key] = value
    }
  })

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function stripDramaticMetadataFromDescription(description: string): string {
  return description
    .split('\n')
    .filter(line => !DESCRIPTION_DRAMATIC_LABEL_REGEX.test(line))
    .join('\n')
    .trim()
}

function normalizeTimelineLinePunctuation(description: string): string {
  return description.replace(/(秒\s*[：:])\s*[，,]\s*/gu, '$1')
}

function normalizeSceneDescription(description: string, dramatic?: SceneDramatic): string {
  const normalizedDescription = description.trim()
  if (normalizedDescription || !dramatic) return normalizedDescription

  const fallback = [
    dramatic.conflict || dramatic.antagonistPressure,
    dramatic.protagonistCounter || dramatic.payoff,
    dramatic.cliffhanger || dramatic.audienceHook
  ].filter(Boolean).join('；')

  return fallback ? `场景功能/情绪定位：${fallback}` : ''
}

function normalizeParsedSceneNarration(raw: unknown): string | undefined {
  const text = normalizeOptionalString(raw)
  if (text) return text

  if (!Array.isArray(raw)) return undefined

  const lines = raw
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        return normalizeOptionalString((item as { text?: unknown }).text) || ''
      }
      return ''
    })
    .filter((item): item is string => !!item)

  return lines.length > 0 ? lines.join('\n') : undefined
}

function normalizeParsedSceneCharacters(
  characters: ParsedScriptScene['characters']
): SceneData['characters'] {
  if (!Array.isArray(characters)) return []

  return characters
    .map((character) => {
      if (typeof character === 'string') {
        return {
          name: character.trim()
        }
      }

      return {
        name: character?.name?.trim() || '',
        appearance: character?.appearance,
        emotion: character?.emotion
      }
    })
    .filter(character => !!character.name)
}

function normalizeParsedSceneProps(
  props: ParsedScriptScene['props']
): NonNullable<SceneData['props']> {
  if (!Array.isArray(props)) return []

  return props
    .map((prop) => {
      if (typeof prop === 'string') {
        return {
          name: prop.trim()
        }
      }

      return {
        name: normalizeOptionalString(prop?.name) || '',
        description: normalizeOptionalString(prop?.description)
      }
    })
    .filter(prop => !!prop.name)
}

function normalizeParsedSceneDialogues(
  dialogues: ParsedScriptScene['dialogues']
): Array<{ character: string, text: string, emotion?: string }> {
  if (!Array.isArray(dialogues)) return []

  return dialogues
    .map((dialogue) => {
      const character = (dialogue.character || dialogue.speaker || '').trim()
      const text = dialogue.text?.trim() || ''
      return {
        character,
        text,
        emotion: dialogue.emotion
      }
    })
    .filter(dialogue => !!dialogue.character && !!dialogue.text)
}

function appendLegacyDialoguesToDescription(
  description: string,
  dialogues: Array<{ character: string, text: string }>
): string {
  const normalizedDescription = description.trim()
  const lines = dialogues
    .filter(dialogue => !normalizedDescription.includes(dialogue.text.trim()))
    .map(dialogue => `- ${dialogue.character}：${dialogue.text}`)

  if (lines.length === 0) return normalizedDescription
  return [
    normalizedDescription,
    '对白：',
    ...lines
  ].filter(Boolean).join('\n')
}

export function buildParsedScenes(options: {
  scenes: ParsedScriptScene[]
  descriptionFormat?: 'visual' | 'timeline'
}): SceneData[] {
  return options.scenes.map((scene, index) => {
    const normalizedDescription = normalizeTimelineLinePunctuation((scene.description || '').trim())
    const descriptionWithoutDramaticMetadata = stripDramaticMetadataFromDescription(normalizedDescription)
    const fallbackText = [
      scene.title,
      descriptionWithoutDramaticMetadata,
      scene.setting?.location
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join(' ')
    const dramatic = normalizeParsedSceneDramatic(scene.dramatic, normalizedDescription)
    const characters = normalizeParsedSceneCharacters(scene.characters)
    const props = normalizeParsedSceneProps(scene.props)
    const dialogues = normalizeParsedSceneDialogues(scene.dialogues)
    const normalizedDialogues = dialogues.filter((dialogue) => {
      return !NARRATION_SPEAKER_SET.has(normalizeCharacterName(dialogue.character))
    })

    const narrationFromDialogues = dialogues
      .filter((dialogue) => {
        return NARRATION_SPEAKER_SET.has(normalizeCharacterName(dialogue.character))
      })
      .map(dialogue => dialogue.text?.trim())
      .filter((text): text is string => !!text)
      .join('\n')
    const descriptionWithLegacyDialogues = appendLegacyDialoguesToDescription(
      descriptionWithoutDramaticMetadata,
      normalizedDialogues
    )

    return {
      id: scene.id || `scene_${index + 1}`,
      episodeId: scene.episodeId,
      episodeTitle: scene.episodeTitle,
      episodeIndex: scene.episodeIndex,
      title: scene.title || `${scene.setting?.location || '场景'} - ${scene.setting?.timeOfDay || ''}`,
      dramatic,
      description: options.descriptionFormat === 'timeline'
        ? descriptionWithLegacyDialogues
        : normalizeSceneDescription(descriptionWithLegacyDialogues, dramatic),
      characters,
      props,
      narration: mergeNarrationTexts(normalizeParsedSceneNarration(scene.narration), narrationFromDialogues),
      duration: scene.duration || 8,
      setting: scene.setting,
      active: index === 0,
      shotType: normalizeParsedSceneShotType(scene.shotType)
        || normalizeParsedSceneShotType(fallbackText)
        || 'medium',
      cameraMovement: normalizeParsedSceneCameraMovement(scene.cameraMovement)
        || normalizeParsedSceneCameraMovement(fallbackText)
        || 'static',
      cameraNote: '',
      environmentCaptureMode: normalizeParsedEnvironmentCaptureMode(scene.environmentCaptureMode)
        || inferParsedEnvironmentCaptureMode({ description: scene.description, cameraNote: '' }),
      transitionIn: 'cut',
      transitionOut: 'cut',
      transitionDuration: 0.5,
      usePreviousLastFrameAsFirstFrame: scene.usePreviousLastFrameAsFirstFrame === true,
      continuityLinkReason: scene.continuityLinkReason?.trim() || undefined,
      referenceError: undefined,
      videoError: undefined,
      referenceStatus: 'pending',
      videoStatus: 'pending'
    }
  })
}

export function buildParsedCharacters(
  parsedCharacters: ParsedScriptCharacter[] | undefined,
  scenes: SceneData[]
): CharacterData[] {
  const sceneCharacterNames = new Set<string>()
  scenes.forEach((scene) => {
    scene.characters.forEach((character) => {
      if (character.name.trim()) {
        sceneCharacterNames.add(character.name)
      }
    })
  })

  if (parsedCharacters && parsedCharacters.length > 0) {
    return parsedCharacters.map((character, index) => ({
      id: `char_${index + 1}`,
      name: character.name,
      appearance: character.description || '',
      role: normalizeCharacterRole(character.role) || 'supporting',
      gender: normalizeCharacterGender(character.gender),
      generating: false,
      generatingViews: false
    }))
  }

  return Array.from(sceneCharacterNames).map((name, index) => {
    const sceneCharacter = scenes
      .flatMap(scene => scene.characters)
      .find(character => character.name === name)

    return {
      id: `char_${index + 1}`,
      name,
      appearance: sceneCharacter?.appearance || '',
      role: 'supporting',
      generating: false,
      generatingViews: false
    }
  })
}
