/**
 * WebSocket 路由处理器
 * 用于流水线进度实时推送
 *
 * 路径: /_ws?taskId=xxx
 */

import { wsManager, getPipelineTaskWS } from '../utils/websocket'

export default defineWebSocketHandler({
  open(peer) {
    // 从 URL 获取 taskId
    const url = peer.request?.url
    const taskId = url ? new URL(url, 'http://localhost').searchParams.get('taskId') : null

    if (!taskId) {
      peer.send(JSON.stringify({
        type: 'error',
        error: '缺少 taskId 参数',
        timestamp: new Date().toISOString()
      }))
      peer.close(4000, '缺少 taskId 参数')
      return
    }

    // 注册客户端
    wsManager.addClient(peer, taskId)

    // 发送当前任务状态（如果存在）
    const task = getPipelineTaskWS(taskId)
    if (task) {
      peer.send(JSON.stringify({
        type: 'init',
        taskId,
        task,
        timestamp: new Date().toISOString()
      }))
    } else {
      peer.send(JSON.stringify({
        type: 'init',
        taskId,
        task: null,
        message: '任务不存在或尚未开始',
        timestamp: new Date().toISOString()
      }))
    }
  },

  message(peer, message) {
    // 处理客户端消息
    try {
      const data = JSON.parse(message.text())

      switch (data.type) {
        case 'ping':
          peer.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString()
          }))
          break

        case 'subscribe':
          // 订阅特定任务
          if (data.taskId) {
            wsManager.addClient(peer, data.taskId)
            const task = getPipelineTaskWS(data.taskId)
            if (task) {
              wsManager.send(peer, { type: 'init', taskId: data.taskId, task })
            }
          }
          break

        default:
          console.log('[WebSocket] 未知消息类型:', data.type)
      }
    } catch (e) {
      console.error('[WebSocket] 解析消息失败:', e)
    }
  },

  close(peer) {
    wsManager.removeClient(peer)
  },

  error(peer, error) {
    console.error('[WebSocket] 连接错误:', error)
    wsManager.removeClient(peer)
  }
})
