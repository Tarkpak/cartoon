import type { CollaborationBody } from '#shared/types/project-collaboration'

const record = (value: unknown): CollaborationBody => value && typeof value === 'object' && !Array.isArray(value) ? value as CollaborationBody : {}

export type AssetKind = 'character' | 'prop'
export interface CollaborationAssetResult {
  id: string
  kind: 'asset-image' | 'asset-voice'
  voiceAsset?: Record<string, unknown>
  status: 'completed'
  createdAt: string
  url: string
  collaboration: { projectId: string, actorId: string, assetKind: AssetKind, assetId: string, resourceType: 'character' | 'settings', resourceId: string, revision: number, settingsRevision: number }
}
export function parseCollaborationAssetResult(value: unknown): CollaborationAssetResult {
  const item = record(value)
  const meta = record(item.collaboration)
  if (!['asset-image', 'asset-voice'].includes(String(item.kind)) || item.status !== 'completed' || typeof item.id !== 'string' || typeof item.url !== 'string' || typeof item.createdAt !== 'string'
    || !['projectId', 'actorId', 'assetId'].every(key => typeof meta[key] === 'string' && !!meta[key])
    || !['character', 'prop'].includes(String(meta.assetKind))
    || meta.resourceType !== (meta.assetKind === 'character' ? 'character' : 'settings')
    || meta.resourceId !== (meta.assetKind === 'character' ? meta.assetId : 'settings')
    || ![meta.revision, meta.settingsRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0)) throw new Error('公共资产结果格式无效')
  if (item.kind === 'asset-voice' && (record(item.voiceAsset).audioUrl !== item.url || typeof record(item.voiceAsset).transcript !== 'string')) throw new Error('公共语音结果格式无效')
  return item as unknown as CollaborationAssetResult
}
