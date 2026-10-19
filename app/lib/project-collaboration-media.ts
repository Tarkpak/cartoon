import type { ProjectCollaborationClient } from './project-collaboration-client'
import { collaborationRecord as record } from './project-collaboration-editor'
import { generationInput } from './project-collaboration-generation'

export interface CollaborationMediaResult {
  id: string
  kind: 'image' | 'video'
  status: string
  progress: number
  createdAt: string
  voiceExtraction?: { status: string, error?: string | null } | null
  error?: string | null
  url?: string | null
  collaboration: { projectId: string, actorId: string, episodeId: string, sceneId: string, revision: number, settingsRevision: number }
}
export function parseCollaborationMediaResult(value: unknown): CollaborationMediaResult {
  const item = record(value)
  const input = record(item.collaboration)
  if (typeof item.id !== 'string' || !['image', 'video'].includes(String(item.kind)) || typeof item.status !== 'string'
    || typeof item.createdAt !== 'string' || typeof item.progress !== 'number'
    || !['projectId', 'actorId', 'episodeId', 'sceneId'].every(key => typeof input[key] === 'string' && !!input[key])
    || ![input.revision, input.settingsRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0)
    || (item.url != null && typeof item.url !== 'string') || (item.error != null && typeof item.error !== 'string')) throw new Error('媒体任务格式无效')
  return item as unknown as CollaborationMediaResult
}
export function mediaGenerationInput(client: ProjectCollaborationClient, episodeId: string, sceneId: string) {
  const input = generationInput(client, episodeId)
  const scenes = client.get('episode', episodeId)?.body?.scenes
  if (!Array.isArray(scenes) || !scenes.some(scene => record(scene).id === sceneId)) throw new Error('目标分镜已移动或删除')
  return input
}
export function adoptCollaborationMedia(client: ProjectCollaborationClient, result: CollaborationMediaResult) {
  const input = mediaGenerationInput(client, result.collaboration.episodeId, result.collaboration.sceneId)
  if (input.revision !== result.collaboration.revision || input.settingsRevision !== result.collaboration.settingsRevision) throw new Error('生成输入已变化，请保留结果后手动处理')
  if (result.status !== 'completed' || !result.url) throw new Error('任务尚未完成')
  let url: URL
  try { url = new URL(result.url) } catch { throw new Error('媒体尚未上传到共享存储，不能采用到协作项目') }
  if (!['https:', 'http:'].includes(url.protocol) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('媒体尚未上传到共享存储，不能采用到协作项目')
  const body = structuredClone(client.get('episode', input.episodeId)!.body!)
  const scenes = body.scenes as Record<string, unknown>[]
  const scene = scenes.find(item => item.id === result.collaboration.sceneId)!
  if (result.kind === 'image') {
    scene.firstFrame = result.url
    scene.referenceStatus = 'done'
  } else {
    const history = Array.isArray(scene.videoHistory) ? scene.videoHistory : []
    if (typeof scene.videoUrl === 'string' && scene.videoUrl && !history.some(item => record(item).videoUrl === scene.videoUrl)) {
      history.push({ id: crypto.randomUUID(), videoUrl: scene.videoUrl, source: 'generated', createdAt: result.createdAt })
    }
    scene.videoHistory = history
    scene.videoUrl = result.url
    scene.videoStatus = 'done'
    // The previous video's last frame no longer describes the adopted video.
    delete scene.lastFrame
  }
  client.edit('episode', input.episodeId, body)
}
