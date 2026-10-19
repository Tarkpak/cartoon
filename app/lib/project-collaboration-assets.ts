import type { ProjectCollaborationClient } from './project-collaboration-client'
import { collaborationRecord as record } from './project-collaboration-editor'

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
export function assetGenerationInput(client: ProjectCollaborationClient, kind: AssetKind, id: string) {
  const type = kind === 'character' ? 'character' : 'settings'
  const resourceId = kind === 'character' ? id : 'settings'
  const draft = client.get(type, resourceId)
  const settings = client.get('settings', 'settings')
  if (client.hasPendingSave || client.structureScopes.length || !draft || draft.base.deleted || !settings || settings.base.deleted
    || draft.dirty || draft.conflict || settings.dirty || settings.conflict) throw new Error('请先保存公共资产与项目设置，并处理冲突')
  if (kind === 'prop') {
    const props = record(record(settings.body?.script).assetWorkflow).props
    if (!Array.isArray(props) || props.filter(prop => record(prop).id === id).length !== 1) throw new Error('道具不存在或标识重复')
  }
  return { type, id: resourceId, revision: draft.base.revision, settingsRevision: settings.base.revision } as const
}
export function adoptCollaborationAsset(client: ProjectCollaborationClient, result: CollaborationAssetResult) {
  const meta = result.collaboration
  const input = assetGenerationInput(client, meta.assetKind, meta.assetId)
  if (input.revision !== meta.revision || input.settingsRevision !== meta.settingsRevision) throw new Error('生成输入已变化，请保留结果后手动处理')
  let url: URL
  try { url = new URL(result.url) } catch { throw new Error('媒体尚未上传到共享存储') }
  if (!['https:', 'http:'].includes(url.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('媒体尚未上传到共享存储')
  const body = structuredClone(client.get(input.type, input.id)!.body!)
  const target = meta.assetKind === 'character' ? body : (record(record(body.script).assetWorkflow).props as Record<string, unknown>[]).find(prop => prop.id === meta.assetId)!
  if (result.kind === 'asset-voice') {
    const existing = record(target.voiceAsset)
    if (existing.locked === true) throw new Error('当前音色已锁定，候选结果已保留，请导出后手动处理')
    target.voiceAsset = { ...JSON.parse(JSON.stringify(result.voiceAsset)), locked: typeof existing.audioUrl !== 'string' || !existing.audioUrl }
    if (meta.assetKind === 'prop') target.mediaType = 'voice'
  } else target[meta.assetKind === 'character' ? 'baseImage' : 'referenceImage'] = result.url
  client.edit(input.type, input.id, body)
}
