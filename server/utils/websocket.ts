/**
 * WebSocket 管理工具
 * 用于流水线进度推送
 */

import type { Peer } from 'crossws'

// ============================================================
// 类型定义
// ============================================================

export interface WSMessage {
  type: 'init' | 'update' | 'complete' | 'error' | 'ping' | 'pong'
  taskId?: string
  task?: PipelineTaskInfo
  message?: string
  error?: string
  timestamp?: string
}

export interface PipelineTaskInfo {
  id: string
  projectId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  currentStep?: string
  steps: Array<{
    id: string
    name: string
    status: string
    progress: number
    message?: string
  }>
  outputPath?: string
  error?: string
  updatedAt: string
}

interface WSClient {
  peer: Peer
  taskId: string
  connectedAt: number
}

// ============================================================
// WebSocket 客户端管理
// ============================================================

class WebSocketManager {
  // taskId -> Set<WSClient>
  private clients = new Map<string, Set<WSClient>>()

  // 心跳间隔（毫秒）
  private heartbeatInterval = 30000
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startHeartbeat()
  }

  /**
   * 添加客户端
   */
  addClient(peer: Peer, taskId: string): void {
    let taskClients = this.clients.get(taskId)
    if (!taskClients) {
      taskClients = new Set()
      this.clients.set(taskId, taskClients)
    }

    const client: WSClient = {
      peer,
      taskId,
      connectedAt: Date.now()
    }
    taskClients.add(client)

    console.log(`[WebSocket] 客户端连接: taskId=${taskId}, 当前连接数=${taskClients.size}`)
  }

  /**
   * 移除客户端
   */
  removeClient(peer: Peer): void {
    for (const [taskId, clients] of this.clients.entries()) {
      for (const client of clients) {
        if (client.peer === peer) {
          clients.delete(client)
          console.log(`[WebSocket] 客户端断开: taskId=${taskId}, 剩余连接数=${clients.size}`)

          // 清理空集合
          if (clients.size === 0) {
            this.clients.delete(taskId)
          }
          return
        }
      }
    }
  }

  /**
   * 向指定任务的所有客户端发送消息
   */
  broadcast(taskId: string, message: WSMessage): void {
    const clients = this.clients.get(taskId)
    if (!clients || clients.size === 0) {
      return
    }

    const payload = JSON.stringify({
      ...message,
      timestamp: new Date().toISOString()
    })

    for (const client of clients) {
      try {
        client.peer.send(payload)
      } catch (error) {
        console.error(`[WebSocket] 发送消息失败:`, error)
        // 移除失败的客户端
        clients.delete(client)
      }
    }
  }

  /**
   * 向单个客户端发送消息
   */
  send(peer: Peer, message: WSMessage): void {
    try {
      peer.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString()
      }))
    } catch (error) {
      console.error(`[WebSocket] 发送消息失败:`, error)
    }
  }

  /**
   * 发送任务初始化消息
   */
  sendInit(taskId: string, task: PipelineTaskInfo): void {
    this.broadcast(taskId, { type: 'init', taskId, task })
  }

  /**
   * 发送任务更新消息
   */
  sendUpdate(taskId: string, task: PipelineTaskInfo): void {
    this.broadcast(taskId, { type: 'update', taskId, task })
  }

  /**
   * 发送任务完成消息
   */
  sendComplete(taskId: string, task: PipelineTaskInfo): void {
    this.broadcast(taskId, { type: 'complete', taskId, task })
  }

  /**
   * 发送错误消息
   */
  sendError(taskId: string, error: string, task?: PipelineTaskInfo): void {
    this.broadcast(taskId, { type: 'error', taskId, error, task })
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalClients = 0
    for (const clients of this.clients.values()) {
      totalClients += clients.size
    }
    return {
      totalTasks: this.clients.size,
      totalClients
    }
  }

  /**
   * 启动心跳检测
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = setInterval(() => {
      for (const [taskId, clients] of this.clients.entries()) {
        for (const client of clients) {
          try {
            client.peer.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }))
          } catch {
            clients.delete(client)
          }
        }
        if (clients.size === 0) {
          this.clients.delete(taskId)
        }
      }
    }, this.heartbeatInterval)
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 清理所有连接
   */
  cleanup(): void {
    this.stopHeartbeat()
    this.clients.clear()
  }
}

// 导出单例
export const wsManager = new WebSocketManager()

// ============================================================
// 流水线任务状态管理（与 WebSocket 集成）
// ============================================================

// 内存中存储流水线任务状态
const pipelineTasks = new Map<string, PipelineTaskInfo>()

/**
 * 创建流水线任务
 */
export function createPipelineTask(task: PipelineTaskInfo): void {
  pipelineTasks.set(task.id, task)
  wsManager.sendInit(task.id, task)
}

/**
 * 更新流水线任务
 */
export function updatePipelineTask(taskId: string, updates: Partial<PipelineTaskInfo>): void {
  const task = pipelineTasks.get(taskId)
  if (!task) return

  Object.assign(task, updates, { updatedAt: new Date().toISOString() })

  // 发送 WebSocket 更新
  if (task.status === 'completed') {
    wsManager.sendComplete(taskId, task)
  } else if (task.status === 'failed') {
    wsManager.sendError(taskId, task.error || '未知错误', task)
  } else {
    wsManager.sendUpdate(taskId, task)
  }
}

/**
 * 更新流水线步骤
 */
export function updatePipelineStep(
  taskId: string,
  stepId: string,
  stepUpdates: Partial<PipelineTaskInfo['steps'][0]>
): void {
  const task = pipelineTasks.get(taskId)
  if (!task) return

  const step = task.steps.find(s => s.id === stepId)
  if (step) {
    Object.assign(step, stepUpdates)
  }

  // 重新计算总进度
  const activeSteps = task.steps.filter(s => s.status !== 'skipped')
  const completedProgress = activeSteps.reduce((sum, s) => {
    if (s.status === 'completed') return sum + 100
    if (s.status === 'processing') return sum + s.progress
    return sum
  }, 0)
  task.progress = activeSteps.length > 0
    ? Math.round(completedProgress / activeSteps.length)
    : 0

  if (stepUpdates.status === 'processing') {
    task.currentStep = stepId
  }

  task.updatedAt = new Date().toISOString()
  wsManager.sendUpdate(taskId, task)
}

/**
 * 获取流水线任务
 */
export function getPipelineTaskWS(taskId: string): PipelineTaskInfo | undefined {
  return pipelineTasks.get(taskId)
}

/**
 * 删除流水线任务
 */
export function deletePipelineTask(taskId: string): void {
  pipelineTasks.delete(taskId)
}
