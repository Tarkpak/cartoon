import { resolveTimeOfDayText } from '../../shared/types/script'
import {
  extractSceneDialoguesFromDescription,
  type SceneDialogueItem
} from './scene-dialogue'

const SCENE_ASSET_MENTION_SECTION_REGEX = /\n{0,2}\[引用资产\]\n(?:@[^\n]*\n?)+/gu
const SCENE_IMAGE_TAG_REGEX = /(?:\[(?:图片|Image\s*#)\s*\d+\]|@(?:图片|Image\s*#)\s*\d+)/giu
const SCENE_LEGACY_AUDIO_CONSTRAINT_REGEX = /\n?\s*不添加字幕，不添加BGM[。.]?\s*$/gu
const FILE_NAME_INVALID_CHAR_REGEX = /[\\/:*?"<>|]/g
const FILE_NAME_SPACE_REGEX = /\s+/g

export interface ScriptDocxSceneCharacterInput {
  name?: string | null
}

export interface ScriptDocxSceneDialogueInput {
  character?: string | null
  text?: string | null
}

export interface ScriptDocxSceneInput {
  title?: string | null
  description?: string | null
  narration?: string | null
  duration?: number | null
  setting?: {
    location?: string | null
    timeOfDay?: string | null
  } | null
  characters?: ScriptDocxSceneCharacterInput[] | null
  dialogues?: ScriptDocxSceneDialogueInput[] | null
}

export interface NormalizedScriptDocxScene {
  title: string
  description: string
  narration: string
  duration: number | null
  location: string
  timeOfDay: string
  characters: string[]
  dialogues: SceneDialogueItem[]
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeDuration(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return Math.round(value * 10) / 10
}

function dedupeDialogues(dialogues: SceneDialogueItem[]): SceneDialogueItem[] {
  const seen = new Set<string>()
  const deduped: SceneDialogueItem[] = []

  for (const dialogue of dialogues) {
    const character = normalizeText(dialogue.character)
    const text = normalizeText(dialogue.text)
    if (!character || !text) continue

    const key = `${character}::${text}`
    if (seen.has(key)) continue

    seen.add(key)
    deduped.push({
      character,
      text
    })
  }

  return deduped
}

function normalizeDialogues(dialogues?: ScriptDocxSceneDialogueInput[] | null): SceneDialogueItem[] {
  if (!Array.isArray(dialogues) || dialogues.length === 0) return []

  return dedupeDialogues(dialogues.map(item => ({
    character: normalizeText(item?.character),
    text: normalizeText(item?.text)
  })))
}

function normalizeCharacters(characters?: ScriptDocxSceneCharacterInput[] | null): string[] {
  if (!Array.isArray(characters) || characters.length === 0) return []

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const character of characters) {
    const name = normalizeText(character?.name)
    if (!name || seen.has(name)) continue
    seen.add(name)
    normalized.push(name)
  }

  return normalized
}

export function sanitizeSceneDescription(raw?: string | null): string {
  const text = normalizeText(raw)
  if (!text) return ''

  return text
    .replace(SCENE_IMAGE_TAG_REGEX, '')
    .replace(SCENE_LEGACY_AUDIO_CONSTRAINT_REGEX, '')
    .replace(SCENE_ASSET_MENTION_SECTION_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

export function normalizeScriptDocxScenes(
  scenes: ScriptDocxSceneInput[],
  options: {
    includeDialoguesFromDescription?: boolean
  } = {}
): NormalizedScriptDocxScene[] {
  const includeDialoguesFromDescription = options.includeDialoguesFromDescription !== false

  return scenes.map((scene, index) => {
    const title = normalizeText(scene?.title) || `场景 ${index + 1}`
    const description = sanitizeSceneDescription(scene?.description)
    const narration = normalizeText(scene?.narration)
    const duration = normalizeDuration(scene?.duration)
    const location = normalizeText(scene?.setting?.location)
    const timeOfDay = resolveTimeOfDayText(scene?.setting?.timeOfDay, '')
    const characters = normalizeCharacters(scene?.characters)
    const explicitDialogues = normalizeDialogues(scene?.dialogues)
    const inferredDialogues = includeDialoguesFromDescription
      ? extractSceneDialoguesFromDescription(description)
      : []
    const dialogues = dedupeDialogues([
      ...explicitDialogues,
      ...inferredDialogues
    ])

    return {
      title,
      description,
      narration,
      duration,
      location,
      timeOfDay,
      characters,
      dialogues
    }
  })
}

export function buildScriptDocxFileName(projectName?: string | null, now = new Date()): string {
  const dateTag = now.toISOString().slice(0, 10)
  const baseName = normalizeText(projectName)
    .replace(FILE_NAME_INVALID_CHAR_REGEX, '_')
    .replace(FILE_NAME_SPACE_REGEX, '_')
    .slice(0, 48)

  const safeName = baseName || '剧本'
  return `${safeName}-格式化剧本-${dateTag}.docx`
}
