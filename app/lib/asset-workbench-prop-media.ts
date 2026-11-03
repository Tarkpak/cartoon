import type { PropAsset, PropAssetMediaType } from '~/composables/useAssetWorkflowMeta'

const OTHER_ASSET_VOICE_HINT_REGEX = /(旁白|画外音|voiceover|narration|音色|声线|配音|旁述)/iu

/** 道具恒为图片；「其他素材」按显式 mediaType → 已有媒体 → 名称提示推断。 */
export function resolvePropAssetMediaType(prop: PropAsset): PropAssetMediaType {
  if (prop.category !== 'other') return 'image'
  if (prop.mediaType) return prop.mediaType
  if (prop.voiceAsset?.audioUrl?.trim()) return 'voice'
  if (prop.videoAsset?.videoUrl?.trim()) return 'video'
  return OTHER_ASSET_VOICE_HINT_REGEX.test(`${prop.name || ''} ${prop.description || ''}`) ? 'voice' : 'image'
}

export function resolvePropAssetMediaUrl(prop: PropAsset): string {
  const mediaType = resolvePropAssetMediaType(prop)
  if (mediaType === 'voice') return prop.voiceAsset?.audioUrl?.trim() || ''
  if (mediaType === 'video') return prop.videoAsset?.videoUrl?.trim() || ''
  return prop.referenceImage?.trim() || ''
}

export function isPropAssetMediaReady(prop: PropAsset): boolean {
  return !!resolvePropAssetMediaUrl(prop)
}
