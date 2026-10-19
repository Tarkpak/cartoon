import type { ProjectCollaborationClient } from './project-collaboration-client'
import { collaborationRecord as record, patchCollaborationEpisode } from './project-collaboration-editor'

export interface CollaborationDraftResult {
  id: string
  createdAt: string
  collaboration: { projectId: string, actorId: string, episodeId: string, revision: number, settingsRevision: number }
  data: { episodeId: string, draft: string, continuityNotes?: string }
}

export function parseCollaborationDraftResult(value: unknown): CollaborationDraftResult {
  const result = record(value)
  const input = record(result.collaboration)
  const data = record(result.data)
  if (typeof result.id !== 'string' || typeof result.createdAt !== 'string'
    || !['projectId', 'actorId', 'episodeId'].every(key => typeof input[key] === 'string' && !!input[key])
    || ![input.revision, input.settingsRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0)
    || data.episodeId !== input.episodeId || typeof data.draft !== 'string' || !data.draft.trim()
    || (data.continuityNotes !== undefined && typeof data.continuityNotes !== 'string')) throw new Error('生成结果格式无效')
  return result as unknown as CollaborationDraftResult
}

export function generationInput(client: ProjectCollaborationClient, episodeId: string) {
  const episode = client.get('episode', episodeId)
  const settings = client.get('settings', 'settings')
  if (client.hasPendingSave || client.structureScopes.length || !episode || episode.base.deleted || !settings
    || episode.dirty || episode.conflict || settings.dirty || settings.conflict) throw new Error('请先保存正文和项目设置，并处理冲突后再生成')
  return { episodeId, revision: episode.base.revision, settingsRevision: settings.base.revision }
}

/** Adopt only the generated writing fields; media, outline and other episodes remain intact. */
export function adoptCollaborationDraft(client: ProjectCollaborationClient, result: CollaborationDraftResult) {
  const input = generationInput(client, result.collaboration.episodeId)
  if (input.revision !== result.collaboration.revision || input.settingsRevision !== result.collaboration.settingsRevision) throw new Error('生成输入已变化，请导出结果后手动合并')
  const body = client.get('episode', input.episodeId)!.body!
  const next = patchCollaborationEpisode(body, 'draft', result.data.draft)
  if (result.data.continuityNotes !== undefined) record(next.writing).continuityNotes = result.data.continuityNotes
  client.edit('episode', input.episodeId, next)
}
