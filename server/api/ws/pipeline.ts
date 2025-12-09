/**
 * WebSocket 流水线进度推送
 *
 * 客户端连接: ws://localhost:3000/api/ws/pipeline?taskId=xxx
 * 服务端推送进度更新到所有订阅该任务的客户端
 */

import { getPipelineTask } from '../pipeline/produce.post'

// 存储活跃的 WebSocket 连接
const activeConnections = new Map<string, Set<WebSocket>>()

// 存储轮询定时器
const pollingTimers = new Map<string, ReturnType<typeof setInterval>>()

/**
 * WebSocket 处理器
 */
export default defineWebSocketHandler({
  open(peer) {
    const url = new URL(peer.request?.url || '', 'http://localhost')
    const taskId = url.searchParams.get('taskId')

    if (!taskId) {
      peer.send(JSON.stringify({ error: '缺少 taskId 参数' }))
      peer.close()
      return
    }

    // 验证任务是否存在
    const task = getPipelineTask(taskId)
    if (!task) {
      peer.send(JSON.stringify({ error: '任务不存在' }))
      peer.close()
      return
    }

    // 添加到连接池
    if (!activeConnections.has(taskId)) {
      activeConnections.set(taskId, new Set())
    }
    activeConnections.get(taskId)!.add(peer.websocket)

    // 发送初始状态
    peer.send(JSON.stringify({
      type: 'init',
      task: formatTask(task)
    }))

    // 启动轮询（如果还没有）
    if (!pollingTimers.has(taskId)) {
      startPolling(taskId)
    }

    console.log(`[WS] 客户端连接: taskId=${taskId}`)
  },

  close(peer) {
    // 从所有连接池中移除
    for (const [taskId, connections] of activeConnections.entries()) {
      if (connections.has(peer.websocket)) {
        connections.delete(peer.websocket)

        // 如果没有连接了，停止轮询
        if (connections.size === 0) {
          stopPolling(taskId)
          activeConnections.delete(taskId)
        }
        break
      }
    }
    console.log(`[WS] 客户端断开连接`)
  },

  message(peer, message) {
    // 处理客户端消息（如心跳）
    try {
      const data = JSON.parse(message.text())
      if (data.type === 'ping') {
        peer.send(JSON.stringify({ type: 'pong' }))
      }
    } catch {
      // 忽略无效消息
    }
  },

  error(peer, error) {
    console.error(`[WS] WebSocket 错误:`, error)
  }
})

/**
 * 格式化任务数据
 */
function formatTask(task: NonNullable<ReturnType<typeof getPipelineTask>>) {
  return {
    id: task.id,
    projectId: task.projectId,
    status: task.status,
    progress: task.progress,
    currentStep: task.currentStep,
    steps: task.steps.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      progress: s.progress,
      message: s.message
    })),
    outputPath: task.outputPath,
    error: task.error,
    updatedAt: task.updatedAt
  }
}

/**
 * 启动轮询推送
 */
function startPolling(taskId: string) {
  let lastUpdate = ''

  const timer = setInterval(() => {
    const task = getPipelineTask(taskId)
    if (!task) {
      stopPolling(taskId)
      broadcast(taskId, { type: 'error', message: '任务已被删除' })
      return
    }

    // 检查是否有更新
    if (task.updatedAt !== lastUpdate) {
      lastUpdate = task.updatedAt
      broadcast(taskId, {
        type: 'update',
        task: formatTask(task)
      })
    }

    // 任务完成或失败，停止轮询
    if (task.status === 'completed' || task.status === 'failed') {
      broadcast(taskId, {
        type: task.status === 'completed' ? 'complete' : 'error',
        task: formatTask(task)
      })
      stopPolling(taskId)
    }
  }, 1000) // 每秒检查一次

  pollingTimers.set(taskId, timer)
}

/**
 * 停止轮询
 */
function stopPolling(taskId: string) {
  const timer = pollingTimers.get(taskId)
  if (timer) {
    clearInterval(timer)
    pollingTimers.delete(taskId)
  }
}

/**
 * 广播消息给所有订阅者
 */
function broadcast(taskId: string, data: object) {
  const connections = activeConnections.get(taskId)
  if (!connections) return

  const message = JSON.stringify(data)
  for (const ws of connections) {
    try {
      ws.send(message)
    } catch {
      // 连接已关闭，移除
      connections.delete(ws)
    }
  }
}

/**
 * 主动推送进度更新（供其他模块调用）
 */
export function pushPipelineUpdate(taskId: string) {
  const task = getPipelineTask(taskId)
  if (task) {
    broadcast(taskId, {
      type: 'update',
      task: formatTask(task)
    })
  }
}
