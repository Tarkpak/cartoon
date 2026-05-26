export type AssetTab = 'characters' | 'environments' | 'props' | 'others'

export type QueueStatus = 'pending' | 'running' | 'done' | 'error'
export type AutoStageKey = 'parse' | 'assets' | 'videos' | 'final'
export type AutoStageStatus = 'pending' | 'running' | 'done'
export type AssetUploadInputType = 'char' | 'char_voice' | 'env' | 'prop' | 'prop_voice'
export type AssetHistorySource = 'generated' | 'uploaded' | 'cropped' | 'legacy'

export interface EnvironmentCropSelection {
  x: number
  y: number
  width: number
  height: number
}

export type EnvironmentCropCaptureMode = 'single' | 'four_view'

export interface EnvironmentPanoramaState {
  panoramaImage?: string
  crop?: EnvironmentCropSelection
  captureMode?: EnvironmentCropCaptureMode
  singleViewImage?: string
  fourViewImage?: string
}

export interface AssetImageHistoryEntry {
  id: string
  image: string
  createdAt?: string
  viewMode?: EnvironmentCropCaptureMode
  source?: AssetHistorySource
  prompt?: string
}

export interface AssetVideoHistoryEntry {
  id: string
  videoUrl: string
  createdAt?: string
  source?: AssetHistorySource
  prompt?: string
}

export interface QueueItem {
  sceneId: string
  status: QueueStatus
  error?: string
}

export interface QueueSummary {
  total: number
  running: number
  done: number
  error: number
}

export interface FinalVideoAsset {
  videoUrl: string
  duration?: number
  size?: number
  updatedAt?: string
}

export type FinalMergeTransitionType = 'fade' | 'dissolve' | 'wipe' | 'none'

export interface FinalMergeOptions {
  sceneOrder?: string[]
  transitionType?: FinalMergeTransitionType
  transitionDuration?: number
  addSubtitles?: boolean
  bgmUrl?: string
  bgmVolume?: number
}

export interface FinalTimelineScene {
  id: string
  title: string
  duration: number
  startTime: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  thumbnail?: string
}

export interface DisplayAsset {
  id: string
  name: string
  type: 'character' | 'environment' | 'prop' | 'other'
  description?: string
  referenceImage?: string
  assetHistory?: AssetImageHistoryEntry[]
  panoramaImage?: string
}

export interface SceneDescriptionMentionItem {
  token: string
  asset?: DisplayAsset
}

export interface SceneDescriptionRenderSegment {
  type: 'text' | 'asset'
  text?: string
  asset?: DisplayAsset
}

export interface SceneVideoReferenceAsset {
  assetId: string
  name: string
  type: 'character' | 'prop' | 'other'
  image: string
  source: 'configured' | 'fallback'
}

export interface EnvironmentAssetCard {
  id: string
  name: string
  description?: string
  referenceImage?: string
  referenceError?: string
  assetHistory?: AssetImageHistoryEntry[]
  panoramaImage?: string
  crop?: EnvironmentCropSelection
  captureMode?: EnvironmentCropCaptureMode
  singleViewImage?: string
  fourViewImage?: string
  sceneIds: string[]
  sceneTitles: string[]
  representativeSceneId: string
  referenceStatus: 'pending' | 'generating' | 'done' | 'error'
}

export interface SceneChatMentionCandidate {
  asset: DisplayAsset
  token: string
  searchText: string
}

export interface SceneChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  assetIds: string[]
  createdAt: number
}

export interface SceneVideoBadge {
  variant: 'secondary' | 'destructive' | 'default' | 'outline'
  label: string
}

export interface SceneVoiceReferenceCharacter {
  id: string
  name: string
  locked: boolean
  source: 'manual' | 'auto'
}

export interface SceneVoiceReferenceSummary {
  hasDialogue: boolean
  mode: 'none' | 'explicit_audio' | 'prompt_only'
  characters: SceneVoiceReferenceCharacter[]
}

export interface CharacterRoleOption {
  value: string
  label: string
}

export function createPropAssetId() {
  return `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function hashForDomId(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

export function buildAssetUploadInputId(type: AssetUploadInputType, rawId: string): string {
  const normalized = rawId
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const suffix = hashForDomId(rawId)
  return `${type}_upload_${normalized || 'asset'}_${suffix}`
}

export function resolveCharacterRoleLabel(role?: string): string {
  if (role === 'protagonist') return '主角'
  if (role === 'antagonist') return '反派'
  if (role === 'supporting') return '配角'
  if (role === 'extra') return '群演'
  return role || '角色'
}
