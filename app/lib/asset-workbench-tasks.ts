import type { AutoStageKey, QueueItem } from '~/lib/asset-workbench-types'

export type WorkbenchTaskStatus = 'running' | 'error'

export interface WorkbenchTask {
  id: string
  status: WorkbenchTaskStatus
  title: string
  detail: string
  stage: AutoStageKey
  sceneId?: string
  /** Failed scene videos can be retried straight from the task list. */
  retryable?: boolean
}

export interface WorkbenchTaskSource {
  parsing: boolean
  parseMessage?: string
  scenes: Array<{
    id: string
    title: string
    referenceStatus: 'pending' | 'generating' | 'done' | 'error'
    videoStatus: 'pending' | 'generating' | 'done' | 'error'
    referenceError?: string
    videoError?: string
  }>
  queueItems: QueueItem[]
  characters: Array<{ id: string, name: string, generating: boolean, generatingViews?: boolean }>
  environments: Array<{ id: string, name: string, referenceStatus: 'pending' | 'generating' | 'done' | 'error', referenceError?: string, sceneIds?: string[] }>
}

/**
 * Collects what is generating right now and what failed, across all stages,
 * so the header can show one list instead of state scattered over cards.
 */
export function buildWorkbenchTasks(source: WorkbenchTaskSource): WorkbenchTask[] {
  const tasks: WorkbenchTask[] = []

  if (source.parsing) {
    tasks.push({
      id: 'parse',
      status: 'running',
      title: '剧本解析',
      detail: source.parseMessage?.trim() || '解析进行中',
      stage: 'parse'
    })
  }

  for (const character of source.characters) {
    if (character.generating || character.generatingViews) {
      tasks.push({
        id: `character:${character.id}`,
        status: 'running',
        title: `角色 ${character.name}`,
        detail: character.generatingViews ? '正在生成多视角图' : '正在生成角色图',
        stage: 'assets'
      })
    }
  }

  const environmentRunningSceneIds = new Set<string>()
  const environmentErrorSceneIds = new Set<string>()
  for (const environment of source.environments) {
    if (environment.referenceStatus === 'generating') {
      for (const id of environment.sceneIds || []) environmentRunningSceneIds.add(id)
      tasks.push({ id: `environment:${environment.id}`, status: 'running', title: `环境 ${environment.name}`, detail: '正在生成环境图', stage: 'assets' })
    } else if (environment.referenceStatus === 'error') {
      for (const id of environment.sceneIds || []) environmentErrorSceneIds.add(id)
      tasks.push({ id: `environment:${environment.id}`, status: 'error', title: `环境 ${environment.name}`, detail: environment.referenceError || '环境图生成失败', stage: 'assets' })
    }
  }

  const runningQueueSceneIds = new Set(source.queueItems.filter(item => item.status === 'running').map(item => item.sceneId))
  const queueErrors = new Map(source.queueItems.filter(item => item.status === 'error').map(item => [item.sceneId, item.error] as const))

  source.scenes.forEach((scene, index) => {
    const title = `场景 ${index + 1} · ${scene.title}`
    const base = { id: `scene:${scene.id}`, title, stage: 'videos' as const, sceneId: scene.id }

    if (scene.videoStatus === 'generating') {
      tasks.push({ ...base, status: 'running', detail: '正在生成分镜视频' })
    } else if (scene.referenceStatus === 'generating' && !environmentRunningSceneIds.has(scene.id)) {
      tasks.push({ ...base, status: 'running', detail: '正在生成环境图' })
    } else if (runningQueueSceneIds.has(scene.id)) {
      tasks.push({ ...base, status: 'running', detail: '准备中' })
    } else if (scene.videoStatus === 'error') {
      tasks.push({ ...base, status: 'error', detail: scene.videoError || queueErrors.get(scene.id) || '分镜视频生成失败', retryable: true })
    } else if (scene.referenceStatus === 'error' && scene.videoStatus !== 'done' && !environmentErrorSceneIds.has(scene.id)) {
      tasks.push({ ...base, status: 'error', detail: scene.referenceError || '环境图生成失败' })
    }
  })

  // Running first, then failures; source order within each group.
  return [...tasks.filter(task => task.status === 'running'), ...tasks.filter(task => task.status === 'error')]
}
