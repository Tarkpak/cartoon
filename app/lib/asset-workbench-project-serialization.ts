import {
  normalizeCharacterGenderText,
  normalizeCharacterRoleText,
  type CharacterView,
  type CharacterVoiceAsset
} from '#shared/types/character'
import {
  normalizeSceneEnvironmentCaptureMode,
  normalizeTimeOfDayValue,
  type SceneCameraAngle,
  type SceneDramatic,
  type SceneCameraMovement,
  type SceneSpeedEffect,
  type SceneShotType
} from '#shared/types/script'
import { normalizeProjectVideoUrl } from '#shared/utils/video-url'
import type {
  AssetWorkbenchTransitionType,
  CharacterData,
  SceneData
} from '~/composables/useAssetWorkbench'
import type { ArkVirtualAssetBinding, SceneDescriptionVersion } from '~/lib/asset-workbench-types'
import {
  toOptionalNumber,
  toOptionalString,
  toOptionalStringArray,
  toOptionalStringRecord
} from '~/lib/asset-workbench-values'

interface LoadedProjectScene {
  id: string
  episodeId?: string | null
  episodeTitle?: string | null
  episodeIndex?: number | null
  title?: string | null
  description: string
  descriptionHistory?: SceneDescriptionVersion[] | null
  dramatic?: SceneDramatic | null
  setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string } | null
  characters?: Array<{ name: string, assetId?: string, appearance?: string, emotion?: string }>
  props?: Array<{ name: string, description?: string }> | null
  narration?: string | null
  duration: number
  firstFrame?: string | null
  lastFrame?: string | null
  videoUrl?: string | null
  shotType?: SceneShotType | null
  cameraAngle?: SceneCameraAngle | null
  cameraMovement?: SceneCameraMovement | null
  speedEffect?: SceneSpeedEffect | null
  cameraNote?: string | null
  environmentCaptureMode?: string | null
  transitionIn?: AssetWorkbenchTransitionType | null
  transitionOut?: AssetWorkbenchTransitionType | null
  transitionDuration?: number | null
}

interface LoadedProjectCharacter {
  id: string
  parentCharacterId?: string | null
  variantName?: string | null
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
  voiceAsset?: CharacterVoiceAsset | null
  arkAsset?: ArkVirtualAssetBinding | null
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
    episodeId: scene.episodeId || undefined,
    episodeTitle: scene.episodeTitle || undefined,
    episodeIndex: typeof scene.episodeIndex === 'number' ? scene.episodeIndex : undefined,
    title: scene.title || `场景 ${index + 1}`,
    description: scene.description,
    descriptionHistory: Array.isArray(scene.descriptionHistory) ? scene.descriptionHistory : undefined,
    dramatic: scene.dramatic || undefined,
    characters: scene.characters || [],
    props: scene.props || [],
    narration: scene.narration || undefined,
    duration: scene.duration || 8,
    setting: scene.setting
      ? {
          ...scene.setting,
          timeOfDay: normalizeTimeOfDayValue(scene.setting.timeOfDay)
        }
      : undefined,
    active: index === 0,
    shotType: scene.shotType || '中景',
    cameraAngle: scene.cameraAngle || 'eye_level',
    cameraMovement: scene.cameraMovement || '固定镜头',
    speedEffect: scene.speedEffect || 'normal',
    cameraNote: scene.cameraNote || '',
    environmentCaptureMode: normalizeSceneEnvironmentCaptureMode(scene.environmentCaptureMode),
    transitionIn: scene.transitionIn || 'cut',
    transitionOut: scene.transitionOut || 'cut',
    transitionDuration: scene.transitionDuration ?? 0.5,
    firstFrame: scene.firstFrame || undefined,
    lastFrame: scene.lastFrame || undefined,
    videoUrl: normalizeProjectVideoUrl(scene.videoUrl) || undefined,
    referenceError: undefined,
    videoError: undefined,
    referenceStatus: scene.firstFrame ? 'done' : 'pending',
    videoStatus: scene.videoUrl ? 'done' : 'pending'
  }))
}

export function buildLoadedCharacters(characters: LoadedProjectCharacter[]): CharacterData[] {
  return characters.map(character => ({
    id: character.id,
    parentCharacterId: toOptionalString(character.parentCharacterId),
    variantName: toOptionalString(character.variantName),
    name: character.name,
    appearance: character.appearance,
    role: normalizeCharacterRoleText(character.role) || '配角',
    personality: toOptionalString(character.personality),
    traits: toOptionalStringArray(character.traits),
    background: toOptionalString(character.background),
    motivation: toOptionalString(character.motivation),
    speakingStyle: toOptionalString(character.speakingStyle),
    catchphrase: toOptionalString(character.catchphrase),
    voiceTone: toOptionalString(character.voiceTone),
    voiceAsset: character.voiceAsset || undefined,
    arkAsset: character.arkAsset || undefined,
    age: toOptionalNumber(character.age),
    gender: normalizeCharacterGenderText(character.gender),
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
  const characterIdMap = new Map(
    characters.map(character => [
      character.id,
      normalizeScopedEntityId('char', projectId, character.id)
    ])
  )

  scenes.forEach((scene) => {
    scene.id = normalizeScopedEntityId('scene', projectId, scene.id)
    scene.characters.forEach((sceneCharacter) => {
      const assetId = sceneCharacter.assetId?.trim()
      if (!assetId) return

      const rawCharacterId = assetId.startsWith('char:')
        ? assetId.slice('char:'.length)
        : assetId
      const scopedCharacterId = characterIdMap.get(rawCharacterId)
        || normalizeScopedEntityId('char', projectId, rawCharacterId)
      sceneCharacter.assetId = `char:${scopedCharacterId}`
    })
  })

  characters.forEach((character) => {
    character.id = characterIdMap.get(character.id)
      || normalizeScopedEntityId('char', projectId, character.id)
    if (character.parentCharacterId) {
      character.parentCharacterId = normalizeScopedEntityId('char', projectId, character.parentCharacterId)
    }
  })
}

export function buildSaveScenesPayload(scenes: SceneData[]) {
  return scenes.map(scene => ({
    id: scene.id,
    episodeId: scene.episodeId,
    episodeTitle: scene.episodeTitle,
    episodeIndex: scene.episodeIndex,
    title: scene.title,
    description: scene.description,
    descriptionHistory: Array.isArray(scene.descriptionHistory) ? scene.descriptionHistory : undefined,
    dramatic: scene.dramatic,
    setting: scene.setting
      ? {
          ...scene.setting,
          timeOfDay: normalizeTimeOfDayValue(scene.setting.timeOfDay)
        }
      : undefined,
    characters: scene.characters,
    props: scene.props || [],
    narration: scene.narration,
    duration: scene.duration,
    shotType: scene.shotType,
    cameraAngle: scene.cameraAngle,
    cameraMovement: scene.cameraMovement,
    speedEffect: scene.speedEffect,
    cameraNote: scene.cameraNote,
    environmentCaptureMode: scene.environmentCaptureMode,
    transitionIn: scene.transitionIn,
    transitionOut: scene.transitionOut,
    transitionDuration: scene.transitionDuration,
    firstFrame: scene.firstFrame,
    lastFrame: scene.lastFrame,
    videoUrl: scene.videoUrl,
    status: scene.videoStatus === 'done'
      ? 'video_ready'
      : (scene.referenceStatus === 'done' ? 'frames_ready' : 'pending')
  }))
}

export function buildSaveCharactersPayload(characters: CharacterData[]) {
  return characters.map(character => ({
    id: character.id,
    parentCharacterId: character.parentCharacterId,
    variantName: character.variantName,
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
    voiceAsset: character.voiceAsset,
    arkAsset: character.arkAsset,
    age: character.age,
    gender: character.gender,
    baseImage: character.baseImage,
    expressions: toOptionalStringRecord(character.expressions),
    views: toOptionalStringRecord(character.views)
  }))
}
