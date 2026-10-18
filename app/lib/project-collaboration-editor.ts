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

export function patchCollaborationScene(body: CollaborationBody, sceneId: string, field: 'title' | 'description' | 'narration', value: string): CollaborationBody {
  const next = structuredClone(body)
  if (!Array.isArray(next.scenes)) throw new Error('分镜数据无效')
  const scene = next.scenes.find(scene => collaborationRecord(scene).id === sceneId)
  if (!scene) throw new Error('分镜不存在')
  collaborationRecord(scene)[field] = value
  return next
}

export function collaborationReviewText(resource: CollaborationResource): string {
  if (resource.deleted) return '此对象已被删除。请导出本地草稿后采用远端版本。'
  const body = collaborationRecord(resource.body)
  if (resource.type === 'character') return ['name', 'role', 'appearance', 'personality'].map(field => collaborationText(body[field])).filter(Boolean).join('\n\n')
  const plan = collaborationRecord(body.plan)
  const writing = collaborationRecord(body.writing)
  const scenes = Array.isArray(body.scenes) ? body.scenes.map(collaborationRecord) : []
  return [plan.title, writing.summary, writing.draft, ...scenes.flatMap(scene => [scene.title, scene.description, scene.narration])]
    .map(collaborationText).filter(Boolean).join('\n\n') || '暂无正文或分镜。'
}
