import type { CharacterView } from '#shared/types/character'
import type { SceneCameraMovement, SceneShotType } from '#shared/types/script'
import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import type {
  AssetWorkbenchTransitionType,
  CharacterData,
  SceneData
} from '~/composables/useAssetWorkbench'
import {
  toOptionalNumber,
  toOptionalString,
  toOptionalStringArray,
  toOptionalStringRecord
} from '~/lib/asset-workbench-values'

interface LoadedProjectScene {
  id: string
  title?: string | null
  description: string
  setting?: { location: string, timeOfDay: string, mood?: string, weather?: string } | null
  characters?: Array<{ name: string, appearance?: string, emotion?: string }>
  dialogues?: Array<{ character: string, text: string, emotion?: string }>
  narration?: string | null
  duration: number
  firstFrame?: string | null
  lastFrame?: string | null
  videoUrl?: string | null
  shotType?: SceneShotType | null
  cameraMovement?: SceneCameraMovement | null
  cameraNote?: string | null
  transitionIn?: AssetWorkbenchTransitionType | null
  transitionOut?: AssetWorkbenchTransitionType | null
  transitionDuration?: number | null
}

interface LoadedProjectCharacter {
  id: string
  name: string
  role?: string | null
  appearance: string
  personality?: string | null
  traits?: string[] | null
  background?: string | null
  motivation?: string | null
  speakingStyle?: string | null
  catchphrase?: string | null
  voiceTone?: string | null
  age?: number | null
  gender?: string | null
  imageUrl?: string | null
  baseImage?: string | null
  expressions?: Record<string, string> | null
  views?: Partial<Record<CharacterView, string>> | null
}

export function buildLoadedScenes(scenes: LoadedProjectScene[]): SceneData[] {
  return scenes.map((scene, index) => ({
    id: scene.id,
    title: scene.title || `场景 ${index + 1}`,
    description: scene.description,
    characters: scene.characters || [],
    dialogues: scene.dialogues || [],
    narration: scene.narration || undefined,
    duration: scene.duration || 8,
    setting: scene.setting || undefined,
    active: index === 0,
    shotType: scene.shotType || 'medium',
    cameraMovement: scene.cameraMovement || 'static',
    cameraNote: scene.cameraNote || '',
    transitionIn: scene.transitionIn || 'cut',
    transitionOut: scene.transitionOut || 'cut',
    transitionDuration: scene.transitionDuration ?? 0.5,
    firstFrame: scene.firstFrame || undefined,
    lastFrame: scene.lastFrame || undefined,
    videoUrl: normalizeProjectVideoUrl(scene.videoUrl) || undefined,
    frameError: undefined,
    videoError: undefined,
    frameStatus: scene.firstFrame ? 'done' : 'pending',
    videoStatus: scene.videoUrl ? 'done' : 'pending'
  }))
}

export function buildLoadedCharacters(characters: LoadedProjectCharacter[]): CharacterData[] {
  return characters.map(character => ({
    id: character.id,
    name: character.name,
    appearance: character.appearance,
    role: character.role || 'supporting',
    personality: toOptionalString(character.personality),
    traits: toOptionalStringArray(character.traits),
    background: toOptionalString(character.background),
    motivation: toOptionalString(character.motivation),
    speakingStyle: toOptionalString(character.speakingStyle),
    catchphrase: toOptionalString(character.catchphrase),
    voiceTone: toOptionalString(character.voiceTone),
    age: toOptionalNumber(character.age),
    gender: toOptionalString(character.gender),
    baseImage: toOptionalString(character.imageUrl) || toOptionalString(character.baseImage),
    expressions: toOptionalStringRecord(character.expressions),
    views: toOptionalStringRecord(character.views) as Partial<Record<CharacterView, string>> | undefined,
    generating: false,
    generatingViews: false
  }))
}

function normalizeScopedEntityId(
  entity: 'scene' | 'char',
  projectId: string,
  sourceId: string
): string {
  const scopedPrefix = `${entity}_${projectId}_`
  if (sourceId.startsWith(scopedPrefix)) return sourceId
  return `${scopedPrefix}${sourceId}`
}

export function applyScopedEntityIds(
  projectId: string,
  scenes: SceneData[],
  characters: CharacterData[]
) {
  scenes.forEach((scene) => {
    scene.id = normalizeScopedEntityId('scene', projectId, scene.id)
  })

  characters.forEach((character) => {
    character.id = normalizeScopedEntityId('char', projectId, character.id)
  })
}

export function buildSaveScenesPayload(scenes: SceneData[]) {
  return scenes.map(scene => ({
    id: scene.id,
    title: scene.title,
    description: scene.description,
    setting: scene.setting,
    characters: scene.characters,
    dialogues: scene.dialogues,
    narration: scene.narration,
    duration: scene.duration,
    shotType: scene.shotType,
    cameraMovement: scene.cameraMovement,
    cameraNote: scene.cameraNote,
    transitionIn: scene.transitionIn,
    transitionOut: scene.transitionOut,
    transitionDuration: scene.transitionDuration,
    firstFrame: scene.firstFrame,
    lastFrame: scene.lastFrame,
    videoUrl: scene.videoUrl,
    status: scene.videoStatus === 'done'
      ? 'video_ready'
      : (scene.frameStatus === 'done' ? 'frames_ready' : 'pending')
  }))
}

export function buildSaveCharactersPayload(characters: CharacterData[]) {
  return characters.map(character => ({
    id: character.id,
    name: character.name,
    role: character.role,
    appearance: character.appearance,
    personality: character.personality,
    traits: character.traits,
    background: character.background,
    motivation: character.motivation,
    speakingStyle: character.speakingStyle,
    catchphrase: character.catchphrase,
    voiceTone: character.voiceTone,
    age: character.age,
    gender: character.gender,
    baseImage: character.baseImage,
    expressions: toOptionalStringRecord(character.expressions),
    views: toOptionalStringRecord(character.views)
  }))
}
