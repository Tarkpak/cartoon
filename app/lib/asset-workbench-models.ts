import type { CharacterView } from '#shared/types/character'
import type { SceneCameraMovement, SceneShotType } from '#shared/types/script'

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
  title: string
  description: string
  characters: Array<{ name: string, appearance?: string, emotion?: string }>
  dialogues: Array<{ character: string, text: string, emotion?: string }>
  narration?: string
  duration: number
  setting?: { location: string, timeOfDay: string, mood?: string, weather?: string }
  active: boolean
  shotType?: SceneShotType
  cameraMovement?: SceneCameraMovement
  cameraNote?: string
  transitionIn?: AssetWorkbenchTransitionType
  transitionOut?: AssetWorkbenchTransitionType
  transitionDuration?: number
  firstFrame?: string
  lastFrame?: string
  videoUrl?: string
  frameError?: string
  videoError?: string
  frameStatus: 'pending' | 'generating' | 'done' | 'error'
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
}

export interface CharacterData {
  id: string
  name: string
  appearance: string
  role: string
  baseImage?: string
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
  age?: number
  gender?: string
}
