/**
 * 分镜视频任务的跟踪工具：区分「任务确实失败」与「暂时查不到状态」，
 * 并提供刷新页面后恢复进行中任务所需的接口。
 */

/** 状态查询暂时不可用（网络抖动、轮询超时等），后端任务可能仍在进行，不应重新提交。 */
export class VideoTaskStatusUnavailableError extends Error {
  readonly taskId: string

  constructor(taskId: string, message = '视频任务状态暂时无法查询，任务可能仍在生成中，重试将继续等待原任务') {
    super(message)
    this.name = 'VideoTaskStatusUnavailableError'
    this.taskId = taskId
  }
}

export function isVideoTaskStatusUnavailableError(error: unknown): error is VideoTaskStatusUnavailableError {
  return error instanceof VideoTaskStatusUnavailableError
}

export function resolveFetchErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  for (const value of [candidate.statusCode, candidate.status, candidate.response?.status]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

/** 请求本身被拒绝（任务不存在、无权限等），继续轮询没有意义。 */
export function isFatalVideoTaskStatusError(error: unknown): boolean {
  const status = resolveFetchErrorStatus(error)
  return status === 400 || status === 401 || status === 403 || status === 404
}

export interface ActiveSceneVideoTask {
  taskId: string
  sceneId: string
  status: string
}

export async function fetchActiveSceneVideoTasks(projectId: string): Promise<ActiveSceneVideoTask[]> {
  const response = await $fetch<{
    success: boolean
    tasks?: Array<Partial<ActiveSceneVideoTask>>
  }>('/api/asset-workflow/video/active-tasks', {
    query: { projectId }
  })
  if (!response.success || !Array.isArray(response.tasks)) return []

  return response.tasks
    .map(task => ({
      taskId: task.taskId?.trim() || '',
      sceneId: task.sceneId?.trim() || '',
      status: task.status?.trim() || ''
    }))
    .filter(task => !!task.taskId && !!task.sceneId)
}
