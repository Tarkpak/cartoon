interface ModelTestVideoTaskResponse {
  success: boolean
  task?: {
    status: string
    error?: string
    result?: {
      videoData?: string
      lastFrame?: string
      metadata?: Record<string, unknown>
    }
  }
}

interface PollModelTestVideoTaskOptions {
  maxAttempts?: number
  pollIntervalMs?: number
  fetchStatus?: (taskId: string) => Promise<ModelTestVideoTaskResponse>
  wait?: (duration: number) => Promise<unknown>
}

export interface ModelTestVideoResult {
  videoUrl: string
  lastFrame?: string
  metadata?: Record<string, unknown>
}

const defaultWait = (duration: number) => new Promise(resolve => setTimeout(resolve, duration))

async function defaultFetchStatus(taskId: string) {
  return await $fetch<ModelTestVideoTaskResponse>(`/api/video/status/${taskId}`)
}

export async function pollModelTestVideoTask(
  taskId: string,
  options: PollModelTestVideoTaskOptions = {}
): Promise<ModelTestVideoResult> {
  const maxAttempts = options.maxAttempts ?? 450
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const fetchStatus = options.fetchStatus ?? defaultFetchStatus
  const wait = options.wait ?? defaultWait

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchStatus(taskId)
    const task = response.task
    if (!response.success || !task) {
      throw new Error('无法获取视频测试任务状态')
    }

    if (task.status === 'completed') {
      const videoUrl = task.result?.videoData?.trim()
      if (!videoUrl) {
        throw new Error('视频测试已完成，但未返回可预览的视频地址')
      }

      return {
        videoUrl,
        lastFrame: task.result?.lastFrame?.trim() || undefined,
        metadata: task.result?.metadata
      }
    }

    if (task.status === 'failed') {
      throw new Error(task.error?.trim() || '视频模型测试失败')
    }

    if (attempt < maxAttempts - 1) {
      await wait(pollIntervalMs)
    }
  }

  throw new Error('视频模型测试超时，请稍后查看模型日志')
}
