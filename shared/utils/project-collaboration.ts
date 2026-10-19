import {
  collaborationId,
  collaborationObject,
  type CollaborationBody,
  type CollaborationResource
} from '../types/project-collaboration'

function objects(value: unknown, label: string): CollaborationBody[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value.map(item => collaborationObject(item, label))
}

function keyed(value: unknown, label: string) {
  const result = new Map<string, CollaborationBody>()
  for (const item of objects(value, label)) {
    const id = collaborationId(item.id, `${label} ID`)
    if (result.has(id)) throw new Error(`${label}存在重复 ID：${id}`)
    result.set(id, item)
  }
  return result
}

// Migration is pure: validation finishes before any database row is changed.
export function splitProjectSnapshot(value: unknown): CollaborationResource[] {
  const snapshot = structuredClone(collaborationObject(value, '项目快照'))
  const project = collaborationObject(snapshot.project, '项目设置')
  const script = snapshot.script == null ? {} : collaborationObject(snapshot.script, '剧本')
  const plans = keyed(script.episodePlan, '集数目录')
  const studio = script.writingStudio == null ? null : collaborationObject(script.writingStudio, '创作工作区')
  const writings = keyed(studio?.episodes, '每集正文')
  const scenes = keyed(snapshot.scenes, '分镜')
  const characters = keyed(snapshot.characters, '公共角色')
  const episodeIds = [...new Set([...plans.keys(), ...writings.keys()])]
  const indices = new Map<number, string>()
  for (const id of episodeIds) {
    const plan = plans.get(id)
    const writing = writings.get(id)
    if (plan && writing && plan.index !== writing.index) throw new Error(`集数 ${id} 的目录与正文序号不一致`)
    const index = (plan || writing)?.index
    if (!Number.isSafeInteger(index) || (index as number) < 1) throw new Error(`集数 ${id} 的序号无效`)
    if (indices.has(index as number)) throw new Error('不同集数的序号重复，请先核对目录与正文 ID')
    indices.set(index as number, id)
  }
  const grouped = new Map(episodeIds.map(id => [id, [] as CollaborationBody[]]))
  let defaultId = 'legacy-unassigned'
  while (grouped.has(defaultId)) defaultId += '-1'
  for (const scene of scenes.values()) {
    const unassigned = scene.episodeId == null || scene.episodeId === ''
    const id = unassigned ? defaultId : collaborationId(scene.episodeId, '分镜所属集 ID')
    if (!unassigned && !grouped.has(id)) throw new Error(`分镜 ${String(scene.id)} 引用了不存在的集数 ${id}`)
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id)!.push({ ...scene, episodeId: id })
  }
  if (grouped.has(defaultId) || episodeIds.length === 0) {
    episodeIds.push(defaultId)
    grouped.set(defaultId, grouped.get(defaultId) || [])
    plans.set(defaultId, { id: defaultId, index: Math.max(0, ...indices.keys()) + 1, title: '未分集内容' })
  }
  const settingsScript = { ...script }
  delete settingsScript.episodePlan
  if (studio) {
    settingsScript.writingStudio = { ...studio }
    delete (settingsScript.writingStudio as CollaborationBody).episodes
  }
  const extra = { ...snapshot }
  for (const key of ['project', 'script', 'scenes', 'characters', 'members', 'access']) delete extra[key]
  const resource = (type: CollaborationResource['type'], id: string, body: CollaborationBody): CollaborationResource => ({ type, id, revision: 1, body, deleted: false })
  return [
    resource('settings', 'settings', { project, script: settingsScript, extra }),
    resource('directory', 'directory', { episodeIds }),
    ...episodeIds.map(id => resource('episode', id, {
      plan: plans.get(id) || { id, index: writings.get(id)!.index, title: writings.get(id)!.title },
      writing: writings.get(id) || null,
      scenes: grouped.get(id) || []
    })),
    ...[...characters].map(([id, body]) => resource('character', id, body))
  ]
}

// Rebuild the compatibility read/export view; this view is never a write protocol.
export function composeProjectSnapshot(resources: CollaborationResource[]): CollaborationBody {
  const active = resources.filter(item => !item.deleted)
  const settings = active.find(item => item.type === 'settings')?.body
  const directory = active.find(item => item.type === 'directory')?.body
  if (!settings || !directory || !Array.isArray(directory.episodeIds)) throw new Error('协作项目缺少设置或集数目录')
  const episodes = new Map(active.filter(item => item.type === 'episode').map(item => [item.id, item.body!]))
  const ordered = (directory.episodeIds as string[]).map(id => {
    const episode = episodes.get(id)
    if (!episode) throw new Error(`目录引用了不存在的集数 ${id}`)
    return episode
  })
  const script = { ...collaborationObject(settings.script, '剧本设置') }
  const allScenes = ordered.flatMap(item => item.scenes as CollaborationBody[])
  const workflow = { ...(script.assetWorkflow as CollaborationBody || {}) }
  for (const field of ['sceneConfigs', 'sceneVideoHistories']) {
    if (!ordered.some(item => item.workbench && field in (item.workbench as CollaborationBody))) continue
    const entries = { ...(workflow[field] as CollaborationBody || {}) }
    for (const episode of ordered) {
      const metadata = episode.workbench as CollaborationBody | undefined
      if (!metadata || !(field in metadata)) continue
      for (const scene of episode.scenes as CollaborationBody[]) delete entries[String(scene.id)]
      Object.assign(entries, metadata[field])
    }
    const ids = new Set(allScenes.map(scene => scene.id))
    workflow[field] = Object.fromEntries(Object.entries(entries).filter(([id]) => ids.has(id)))
  }
  const characterBodies = active.filter(item => item.type === 'character').map(item => item.body!)
  if (characterBodies.some(item => item.workbench && 'assetHistory' in (item.workbench as CollaborationBody))) {
    const histories = { ...(workflow.characterHistories as CollaborationBody || {}) }
    for (const character of characterBodies) {
      const metadata = character.workbench as CollaborationBody | undefined
      if (metadata && 'assetHistory' in metadata) histories[String(character.id)] = metadata.assetHistory
    }
    workflow.characterHistories = histories
  }
  if (Object.keys(workflow).length || script.assetWorkflow) script.assetWorkflow = workflow
  const writings = ordered.map(item => item.writing).filter(item => item != null)
  return {
    ...collaborationObject(settings.extra, '项目附加信息'),
    project: settings.project,
    script: {
      ...script,
      episodePlan: ordered.map(item => item.plan),
      writingStudio: script.writingStudio || writings.length
        ? { ...(script.writingStudio as CollaborationBody || {}), episodes: writings }
        : null
    },
    scenes: allScenes,
    characters: active.filter(item => item.type === 'character').map(item => item.body)
  }
}

export function validateCollaborationResources(resources: CollaborationResource[]) {
  const snapshot = composeProjectSnapshot(resources)
  const directory = resources.find(item => item.type === 'directory' && !item.deleted)!
  const ids = directory.body!.episodeIds as unknown[]
  if (new Set(ids).size !== ids.length) throw new Error('集数目录存在重复 ID')
  const active = resources.filter(item => !item.deleted)
  if (active.filter(item => item.type === 'episode').length !== ids.length) throw new Error('集数与目录不一致，新增或删除集数必须同时更新目录')
  for (const item of active) {
    if (!item.body) throw new Error('对象内容缺失')
    if ((item.type === 'settings' || item.type === 'directory') && item.id !== item.type) throw new Error('设置或目录 ID 无效')
    if (item.type === 'character' && item.body.id !== item.id) throw new Error('角色 ID 不匹配')
    if (item.type === 'episode') {
      const plan = collaborationObject(item.body.plan, '集数目录项')
      if (plan.id !== item.id) throw new Error('集数 ID 不匹配')
      if (item.body.writing != null && collaborationObject(item.body.writing, '每集正文').id !== item.id) throw new Error('正文集数 ID 不匹配')
      for (const scene of objects(item.body.scenes, '每集分镜')) {
        if (scene.episodeId !== item.id) throw new Error('不能将其他集数的分镜写入当前集')
      }
    }
  }
  // Check duplicate IDs, dangling scene references and plan/writing alignment.
  splitProjectSnapshot(snapshot)
}
