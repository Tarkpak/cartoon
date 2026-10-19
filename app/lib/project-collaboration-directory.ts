import type { CollaborationResource } from '../../shared/types/project-collaboration'
import { collaborationRecord as record } from './project-collaboration-editor'

type Change = Pick<CollaborationResource, 'type' | 'id' | 'body'>
export type DirectoryAction = { kind: 'add', id: string } | { kind: 'remove', id: string } | { kind: 'move', id: string, direction: -1 | 1 }

/** Preserve stable IDs; a reorder updates only the two episodes whose indices change. */
export function buildDirectoryChange(resources: CollaborationResource[], action: DirectoryAction): Change[] {
  const directory = resources.find(item => item.type === 'directory' && !item.deleted)
  const ids = directory?.body?.episodeIds
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('集数目录无效')
  const nextIds = [...ids] as string[]
  const episodes = resources.filter(item => item.type === 'episode' && !item.deleted)
  const changes: Change[] = []
  const index = nextIds.indexOf(action.id)
  if (action.kind === 'add') {
    if (!action.id || resources.some(item => item.type === 'episode' && item.id === action.id)) throw new Error('集数 ID 无效或重复')
    const episodeIndex = Math.max(0, ...episodes.map(item => Number(record(item.body?.plan).index))) + 1
    if (!Number.isSafeInteger(episodeIndex)) throw new Error('集数序号无效')
    nextIds.push(action.id)
    changes.push({ type: 'episode', id: action.id, body: { plan: { id: action.id, index: episodeIndex, title: `第${episodeIndex}集` }, writing: null, scenes: [] } })
  } else {
    if (index < 0) throw new Error('集数不存在')
    if (action.kind === 'remove') {
      if (ids.length <= 1) throw new Error('至少保留一个集数')
      nextIds.splice(index, 1)
      changes.push({ type: 'episode', id: action.id, body: null })
    } else {
      const target = index + action.direction
      if (target < 0 || target >= ids.length) throw new Error('无法继续移动')
      const first = episodes.find(item => item.id === action.id)
      const second = episodes.find(item => item.id === nextIds[target])
      if (!first?.body || !second?.body) throw new Error('集数不存在')
      const reindex = (episode: CollaborationResource, newIndex: unknown): Change => {
        const body = structuredClone(episode.body!)
        body.plan = { ...record(body.plan), index: newIndex }
        if (body.writing != null) body.writing = { ...record(body.writing), index: newIndex }
        body.scenes = (Array.isArray(body.scenes) ? body.scenes : []).map(scene => ({ ...record(scene), episodeIndex: newIndex }))
        return { type: 'episode', id: episode.id, body }
      }
      changes.push(reindex(first, record(second.body.plan).index), reindex(second, record(first.body.plan).index))
      ;[nextIds[index], nextIds[target]] = [nextIds[target]!, nextIds[index]!]
    }
  }
  return [{ type: 'directory', id: 'directory', body: { ...directory!.body, episodeIds: nextIds } }, ...changes]
}

/** Move the original scene, including media/history, in the same commit as both episodes. */
export function buildSceneTransfer(resources: CollaborationResource[], sourceId: string, targetId: string, sceneId: string): Change[] {
  if (sourceId === targetId) throw new Error('请选择其他目标集数')
  const directory = resources.find(item => item.type === 'directory' && !item.deleted)
  const ids = directory?.body?.episodeIds
  if (!Array.isArray(ids) || !ids.includes(sourceId) || !ids.includes(targetId)) throw new Error('来源集或目标集不存在')
  const source = resources.find(item => item.type === 'episode' && item.id === sourceId && !item.deleted)
  const target = resources.find(item => item.type === 'episode' && item.id === targetId && !item.deleted)
  if (!source?.body || !target?.body || !Array.isArray(source.body.scenes) || !Array.isArray(target.body.scenes)) throw new Error('集数分镜数据无效')
  const sourceBody = structuredClone(source.body)
  const targetBody = structuredClone(target.body)
  const sourceScenes = sourceBody.scenes as Record<string, unknown>[]
  const targetScenes = targetBody.scenes as Record<string, unknown>[]
  const index = sourceScenes.findIndex(scene => scene.id === sceneId)
  if (index < 0) throw new Error('来源分镜不存在')
  if (targetScenes.some(scene => scene.id === sceneId)) throw new Error('目标集已有相同分镜')
  const [scene] = sourceScenes.splice(index, 1)
  const plan = record(targetBody.plan)
  targetScenes.push({ ...scene, episodeId: targetId, episodeIndex: plan.index, episodeTitle: plan.title })
  return [
    { type: 'directory', id: 'directory', body: structuredClone(directory!.body) },
    { type: 'episode', id: sourceId, body: sourceBody },
    { type: 'episode', id: targetId, body: targetBody }
  ]
}
