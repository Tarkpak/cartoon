export type AssetTab = 'characters' | 'scenes' | 'props'

export type QueueStatus = 'pending' | 'running' | 'done' | 'error'
export type AutoStageKey = 'parse' | 'assets' | 'videos' | 'final'
export type AutoStageStatus = 'pending' | 'running' | 'done'
export type AssetUploadInputType = 'char' | 'env' | 'prop'

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

export interface DisplayAsset {
  id: string
  name: string
  type: 'character' | 'environment' | 'prop'
  description?: string
  referenceImage?: string
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
  type: 'character' | 'prop'
  image: string
  source: 'configured' | 'fallback'
}

export interface EnvironmentAssetCard {
  id: string
  name: string
  description?: string
  referenceImage?: string
  sceneIds: string[]
  sceneTitles: string[]
  representativeSceneId: string
  frameStatus: 'pending' | 'generating' | 'done' | 'error'
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
