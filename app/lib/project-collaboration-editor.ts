import type { CollaborationBody, CollaborationResource } from '../../shared/types/project-collaboration'

export function collaborationRecord(value: unknown): CollaborationBody {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as CollaborationBody : {}
}

export function collaborationText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Patch only the edited fields, preserving original media, metadata and unknown fields. */
export function patchCollaborationEpisode(body: CollaborationBody, field: 'title' | 'summary' | 'draft', value: string): CollaborationBody {
  const next = structuredClone(body)
  const plan = collaborationRecord(next.plan)
  const writing = collaborationRecord(next.writing)
  if (field === 'title') {
    next.plan = { ...plan, title: value }
    if (next.writing != null) next.writing = { ...writing, title: value }
  } else {
    next.writing = {
      id: plan.id, index: plan.index, title: plan.title, summary: '', hook: '', beats: [], draft: '', review: '',
      ...writing, [field]: value
    }
  }
  return next
}

export function patchCollaborationSettings(body: CollaborationBody, field: 'name' | 'description' | 'aspectRatio', value: string): CollaborationBody {
  if (field === 'aspectRatio' && !['16:9', '9:16', '1:1'].includes(value)) throw new Error('画幅无效')
  const next = structuredClone(body)
  next.project = { ...collaborationRecord(next.project), [field]: value }
  return next
}

export function patchCollaborationScene(body: CollaborationBody, sceneId: string, field: 'title' | 'description' | 'narration', value: string): CollaborationBody {
  const next = structuredClone(body)
  if (!Array.isArray(next.scenes)) throw new Error('分镜数据无效')
  const scene = next.scenes.find(scene => collaborationRecord(scene).id === sceneId)
  if (!scene) throw new Error('分镜不存在')
  collaborationRecord(scene)[field] = value
  return next
}

/** Structural edits stay within one episode; IDs and existing media remain unchanged. */
export function addCollaborationScene(body: CollaborationBody, sceneId: string): CollaborationBody {
  const next = structuredClone(body)
  const plan = collaborationRecord(next.plan)
  if (typeof plan.id !== 'string' || !plan.id || !Array.isArray(next.scenes)) throw new Error('分镜数据无效')
  if (!sceneId.trim() || next.scenes.some(scene => collaborationRecord(scene).id === sceneId)) throw new Error('分镜 ID 无效或重复')
  next.scenes.push({
    id: sceneId, episodeId: plan.id, episodeIndex: plan.index, episodeTitle: plan.title,
    title: '新分镜', description: '', narration: '', characters: [], duration: 5, active: true,
    referenceStatus: 'pending', videoStatus: 'pending'
  })
  return next
}

export function removeCollaborationScene(body: CollaborationBody, sceneId: string): CollaborationBody {
  const next = structuredClone(body)
  if (!Array.isArray(next.scenes)) throw new Error('分镜数据无效')
  const index = next.scenes.findIndex(scene => collaborationRecord(scene).id === sceneId)
  if (index < 0) throw new Error('分镜不存在')
  next.scenes.splice(index, 1)
  return next
}

export function moveCollaborationScene(body: CollaborationBody, sceneId: string, direction: -1 | 1): CollaborationBody {
  const next = structuredClone(body)
  if (!Array.isArray(next.scenes)) throw new Error('分镜数据无效')
  const index = next.scenes.findIndex(scene => collaborationRecord(scene).id === sceneId)
  if (index < 0) throw new Error('分镜不存在')
  const target = index + direction
  if (target >= 0 && target < next.scenes.length) {
    const [scene] = next.scenes.splice(index, 1)
    next.scenes.splice(target, 0, scene)
  }
  return next
}

export function collaborationReviewText(resource: CollaborationResource): string {
  if (resource.deleted) return '此对象已被删除。请导出本地草稿后采用远端版本。'
  const body = collaborationRecord(resource.body)
  if (resource.type === 'directory') return `共 ${Array.isArray(body.episodeIds) ? body.episodeIds.length : 0} 集。受影响集数的远端内容如下。`
  if (resource.type === 'settings') {
    const project = collaborationRecord(body.project)
    return [project.name, project.description, project.aspectRatio].map(collaborationText).filter(Boolean).join('\n\n') || '暂无项目简介。'
  }
  if (resource.type === 'character') return ['name', 'role', 'appearance', 'personality'].map(field => collaborationText(body[field])).filter(Boolean).join('\n\n')
  const plan = collaborationRecord(body.plan)
  const writing = collaborationRecord(body.writing)
  const scenes = Array.isArray(body.scenes) ? body.scenes.map(collaborationRecord) : []
  return [plan.title, writing.summary, writing.draft, ...scenes.flatMap(scene => [scene.title, scene.description, scene.narration])]
    .map(collaborationText).filter(Boolean).join('\n\n') || '暂无正文或分镜。'
}
