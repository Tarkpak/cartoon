/**
 * 流水线管理 Composable
 * 提供流水线任务管理和 WebSocket 实时进度
 */

export interface PipelineStep {
  id: string
  name: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
  progress: number
  message?: string
}

export interface PipelineTask {
  id: string
  projectId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  currentStep?: string
  steps: PipelineStep[]
  outputPath?: string
  error?: string
  updatedAt: string
}

export interface PipelineOptions {
  generateFrames?: boolean
  generateVideos?: boolean
  generateTransitions?: boolean
  generateAudio?: boolean
  mergeOutput?: boolean
}

export function usePipeline() {
  const currentTask = ref<PipelineTask | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const ws = ref<WebSocket | null>(null)
  const connected = ref(false)

  /**
   * 启动流水线任务
   */
  async function startPipeline(projectId: string, options: PipelineOptions = {}) {
    loading.value = true
    error.value = null

    try {
      const data = await $fetch<{
        success: boolean
        taskId: string
        steps: Array<{ id: string, name: string, status: string }>
      }>('/api/pipeline/produce', {
        method: 'POST',
        body: { projectId, options }
      })

      if (!data.success || !data.taskId) {
        throw new Error('启动流水线失败')
      }

      // 初始化任务状态
      currentTask.value = {
        id: data.taskId,
        projectId,
        status: 'pending',
        progress: 0,
        steps: data.steps.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status as PipelineStep['status'],
          progress: 0
        })),
        updatedAt: new Date().toISOString()
      }

      // 连接 WebSocket
      connectWebSocket(data.taskId)

      return data.taskId
    } catch (e) {
      error.value = e instanceof Error ? e.message : '启动流水线失败'
      console.error('[usePipeline] startPipeline error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取任务状态
   */
  async function fetchTaskStatus(taskId: string) {
    try {
      const data = await $fetch<{ success: boolean, task: PipelineTask }>(
        `/api/pipeline/status/${taskId}`
      )
      if (data.success && data.task) {
        currentTask.value = data.task
        return data.task
      }
      return null
    } catch (e) {
      console.error('[usePipeline] fetchTaskStatus error:', e)
      return null
    }
  }

  /**
   * 连接 WebSocket 获取实时进度
   */
  function connectWebSocket(taskId: string) {
    // 关闭现有连接
    disconnectWebSocket()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/_ws?taskId=${taskId}`

    try {
      ws.value = new WebSocket(wsUrl)

      ws.value.onopen = () => {
        connected.value = true
        console.log('[usePipeline] WebSocket connected')
      }

      ws.value.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleWebSocketMessage(data)
        } catch (e) {
          console.error('[usePipeline] Failed to parse WS message:', e)
        }
      }

      ws.value.onclose = () => {
        connected.value = false
        console.log('[usePipeline] WebSocket disconnected')
      }

      ws.value.onerror = (e) => {
        console.error('[usePipeline] WebSocket error:', e)
        error.value = 'WebSocket 连接失败'
      }
    } catch (e) {
      console.error('[usePipeline] Failed to create WebSocket:', e)
      // 降级到轮询模式
      startPolling(taskId)
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  function handleWebSocketMessage(data: {
    type: string
    task?: PipelineTask
    error?: string
    message?: string
  }) {
    switch (data.type) {
      case 'init':
      case 'update':
        if (data.task) {
          currentTask.value = data.task
        }
        break

      case 'complete':
        if (data.task) {
          currentTask.value = data.task
        }
        disconnectWebSocket()
        break

      case 'error':
        error.value = data.message || data.error || '未知错误'
        if (data.task) {
          currentTask.value = data.task
        }
        disconnectWebSocket()
        break
    }
  }

  /**
   * 断开 WebSocket 连接
   */
  function disconnectWebSocket() {
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    connected.value = false
  }

  /**
   * 轮询模式（WebSocket 不可用时的降级方案）
   */
  let pollingTimer: ReturnType<typeof setInterval> | null = null

  function startPolling(taskId: string) {
    stopPolling()

    pollingTimer = setInterval(async () => {
      const task = await fetchTaskStatus(taskId)
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        stopPolling()
      }
    }, 2000)
  }

  function stopPolling() {
    if (pollingTimer) {
      clearInterval(pollingTimer)
      pollingTimer = null
    }
  }

  /**
   * 计算属性
   */
  const isRunning = computed(() =>
    currentTask.value?.status === 'pending' || currentTask.value?.status === 'processing'
  )

  const isCompleted = computed(() => currentTask.value?.status === 'completed')
  const isFailed = computed(() => currentTask.value?.status === 'failed')

  const currentStepInfo = computed(() => {
    if (!currentTask.value?.currentStep) return null
    return currentTask.value.steps.find(s => s.id === currentTask.value?.currentStep)
  })

  /**
   * 清理
   */
  function cleanup() {
    disconnectWebSocket()
    stopPolling()
    currentTask.value = null
    error.value = null
  }

  // 组件卸载时清理
  onUnmounted(cleanup)

  return {
    // 状态
    currentTask,
    loading,
    error,
    connected,
    isRunning,
    isCompleted,
    isFailed,
    currentStepInfo,
    // 方法
    startPipeline,
    fetchTaskStatus,
    connectWebSocket,
    disconnectWebSocket,
    cleanup
  }
}
