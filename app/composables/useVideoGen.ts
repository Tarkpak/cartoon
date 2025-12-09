/**
 * 视频生成 Composable
 * 提供视频生成和状态轮询功能
 */

import type { VideoGenerationConfig, VideoTask } from '../../shared/types/video'

export interface VideoGenOptions {
  pollInterval?: number
  maxPollTime?: number
  onProgress?: (progress: number, status: string) => void
}

export function useVideoGen() {
  const tasks = ref<Map<string, VideoTask>>(new Map())
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * 生成首尾帧
   */
  async function generateFrames(sceneId: string, scene: {
    description: string
    setting: { location: string, timeOfDay: string }
    characters: Array<{ name: string, emotion?: string }>
  }, style = '日式动漫') {
    loading.value = true
    error.value = null

    try {
      const data = await $fetch<{
        success: boolean
        sceneId: string
        firstFrame: { imageData: string, mimeType: string }
        lastFrame: { imageData: string, mimeType: string }
      }>('/api/frame/generate', {
        method: 'POST',
        body: { scene: { id: sceneId, ...scene }, style }
      })

      return {
        firstFrame: data.firstFrame.imageData,
        lastFrame: data.lastFrame.imageData,
        mimeType: data.firstFrame.mimeType
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '首尾帧生成失败'
      console.error('[useVideoGen] generateFrames error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 启动视频生成任务
   */
  async function startVideoGeneration(
    sceneId: string,
    config: VideoGenerationConfig,
    options: VideoGenOptions = {}
  ) {
    loading.value = true
    error.value = null

    try {
      const data = await $fetch<{
        success: boolean
        taskId: string
      }>('/api/video/generate', {
        method: 'POST',
        body: { sceneId, config }
      })

      if (!data.success || !data.taskId) {
        throw new Error('启动视频生成失败')
      }

      // 创建任务记录
      const task: VideoTask = {
        id: data.taskId,
        sceneId,
        status: 'pending',
        progress: 0,
        config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      tasks.value.set(data.taskId, task)

      // 开始轮询任务状态
      pollTaskStatus(data.taskId, options)

      return data.taskId
    } catch (e) {
      error.value = e instanceof Error ? e.message : '视频生成启动失败'
      console.error('[useVideoGen] startVideoGeneration error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 轮询任务状态
   */
  async function pollTaskStatus(taskId: string, options: VideoGenOptions = {}) {
    const pollInterval = options.pollInterval || 5000
    const maxPollTime = options.maxPollTime || 180000
    const startTime = Date.now()

    const poll = async () => {
      try {
        const data = await $fetch<{
          task: VideoTask
        }>(`/api/video/status/${taskId}`)

        const task = data.task
        tasks.value.set(taskId, task)

        // 回调进度
        options.onProgress?.(task.progress, task.status)

        // 检查是否完成
        if (task.status === 'completed' || task.status === 'failed') {
          return task
        }

        // 检查超时
        if (Date.now() - startTime > maxPollTime) {
          const timeoutTask = { ...task, status: 'failed' as const, error: '任务超时' }
          tasks.value.set(taskId, timeoutTask)
          return timeoutTask
        }

        // 继续轮询
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        return poll()
      } catch (e) {
        console.error('[useVideoGen] pollTaskStatus error:', e)
        const existingTask = tasks.value.get(taskId)
        if (existingTask) {
          existingTask.status = 'failed'
          existingTask.error = e instanceof Error ? e.message : '状态查询失败'
        }
        return existingTask
      }
    }

    return poll()
  }

  /**
   * 获取任务状态
   */
  function getTaskStatus(taskId: string) {
    return tasks.value.get(taskId)
  }

  /**
   * 场景串联
   */
  async function chainScenes(sceneFrames: Array<{
    sceneId: string
    firstFrame: string
    lastFrame: string
    mimeType?: string
  }>, transitionType = 'dissolve', transitionDuration = 4) {
    loading.value = true
    error.value = null

    try {
      const data = await $fetch<{
        success: boolean
        chain: {
          id: string
          sceneIds: string[]
          transitions: Array<{
            fromSceneId: string
            toSceneId: string
            taskId: string
            status: string
          }>
        }
      }>('/api/scene/chain', {
        method: 'POST',
        body: {
          sceneFrames,
          transitionType,
          transitionDuration
        }
      })

      return data.chain
    } catch (e) {
      error.value = e instanceof Error ? e.message : '场景串联失败'
      console.error('[useVideoGen] chainScenes error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 清除任务记录
   */
  function clearTasks() {
    tasks.value.clear()
  }

  return {
    // 状态
    tasks,
    loading,
    error,
    // 方法
    generateFrames,
    startVideoGeneration,
    pollTaskStatus,
    getTaskStatus,
    chainScenes,
    clearTasks
  }
}
