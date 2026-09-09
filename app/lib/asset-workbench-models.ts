import type { CharacterView, CharacterVoiceAsset } from '#shared/types/character'
import type {
  SceneCameraMovement,
  SceneCameraAngle,
  SceneDramatic,
  SceneEnvironmentCaptureMode,
  SceneSpeedEffect,
  SceneShotType
} from '#shared/types/script'
import type {
  ArkVirtualAssetBinding,
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry,
  SceneDescriptionVersion
} from '~/lib/asset-workbench-types'

export type AssetWorkbenchTransitionType
  = | 'cut'
    | 'fade'
    | 'dissolve'
    | 'wipe'
    | 'slide'
    | 'zoom'
    | 'blur'
    | 'flash'
    | 'fade_to_black'
    | 'match_cut'
    | 'none'

export interface SceneData {
  id: string
  episodeId?: string
  episodeTitle?: string
  episodeIndex?: number
  title: string
  description: string
  descriptionHistory?: SceneDescriptionVersion[]
  dramatic?: SceneDramatic
  characters: Array<{ name: string, assetId?: string, appearance?: string, emotion?: string }>
  props?: Array<{ name: string, description?: string }>
  narration?: string
  duration: number
  setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string }
  active: boolean
  shotType?: SceneShotType
  cameraAngle?: SceneCameraAngle
  cameraMovement?: SceneCameraMovement
  speedEffect?: SceneSpeedEffect
  cameraNote?: string
  environmentCaptureMode?: SceneEnvironmentCaptureMode
  transitionIn?: AssetWorkbenchTransitionType
  transitionOut?: AssetWorkbenchTransitionType
  transitionDuration?: number
  usePreviousLastFrameAsFirstFrame?: boolean
  continuityLinkReason?: string
  firstFrame?: string
  lastFrame?: string
  videoUrl?: string
  videoHistory?: AssetVideoHistoryEntry[]
  referenceError?: string
  videoError?: string
  referenceStatus: 'pending' | 'generating' | 'done' | 'error'
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
}

export interface CharacterData {
  id: string
  parentCharacterId?: string
  variantName?: string
  name: string
  appearance: string
  role: string
  baseImage?: string
  assetHistory?: AssetImageHistoryEntry[]
  expressions?: Record<string, string>
  views?: Partial<Record<CharacterView, string>>
  generating: boolean
  generatingViews: boolean
  personality?: string
  traits?: string[]
  background?: string
  motivation?: string
  speakingStyle?: string
  catchphrase?: string
  voiceTone?: string
  language?: CharacterLanguage
  languageNote?: string
  voiceAsset?: CharacterVoiceAsset
  arkAsset?: ArkVirtualAssetBinding
  age?: number
  gender?: string
}

export type CharacterLanguage = 'mandarin' | 'chongqing' | 'dongbei' | 'cantonese' | 'sichuan' | 'wu' | 'english' | 'japanese' | 'custom'

export const CHARACTER_LANGUAGE_LABELS: Record<CharacterLanguage, string> = {
  mandarin: '普通话', chongqing: '重庆方言', dongbei: '东北话', cantonese: '粤语',
  sichuan: '四川话', wu: '吴语', english: '英语', japanese: '日语', custom: '自定义'
}
