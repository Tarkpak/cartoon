import type { CharacterView, CharacterVoiceAsset } from '#shared/types/character'
import type { SceneCameraMovement, SceneShotType } from '#shared/types/script'
import type {
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry
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
    | 'none'

export interface SceneData {
  id: string
  episodeId?: string
  episodeTitle?: string
  episodeIndex?: number
  title: string
  description: string
  characters: Array<{ name: string, appearance?: string, emotion?: string }>
  dialogues: Array<{ character: string, text: string, emotion?: string }>
  narration?: string
  duration: number
  setting?: { location: string, timeOfDay: string, era?: string, mood?: string, weather?: string }
  active: boolean
  shotType?: SceneShotType
  cameraMovement?: SceneCameraMovement
  cameraNote?: string
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
  voiceAsset?: CharacterVoiceAsset
  age?: number
  gender?: string
}
