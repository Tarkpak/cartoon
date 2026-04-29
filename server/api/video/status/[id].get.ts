import { eq } from 'drizzle-orm'
import * as qwen from '../../../utils/qwen'
import * as kling from '../../../utils/kling'
import * as volcengine from '../../../utils/volcengine'
import { db, videoTasks } from '../../../db'
import {
  parseVideoTaskMetadata,
  type UpstreamVideoTaskTracking
} from '../../../utils/video-task-upstream'
import {
  persistGeneratedVideoFromRemoteUrl,
  syncSceneVideoResult
} from '../../../utils/video-task-storage'

type VideoTaskRow = typeof videoTasks.$inferSelect

function createCompletedTaskMetadata(upstreamTask: UpstreamVideoTaskTracking): string {
  return JSON.stringify(upstreamTask.resultMetadata)
}

async function finalizeTrackedVideoTask(
  task: VideoTaskRow,
  upstreamTask: UpstreamVideoTaskTracking,
  videoUrl: string
): Promise<VideoTaskRow> {
  const videoData = await persistGeneratedVideoFromRemoteUrl({
    taskId: task.id,
    videoUrl
  })

  const metadata = createCompletedTaskMetadata(upstreamTask)
  const updatedAt = new Date().toISOString()

  await db.update(videoTasks)
    .set({
      status: 'completed',
      progress: 100,
      videoData,
      metadata,
      error: null,
      updatedAt
    })
    .where(eq(videoTasks.id, task.id))

  await syncSceneVideoResult(task.sceneId || '', videoData)

  return {
    ...task,
    status: 'completed',
    progress: 100,
    videoData,
    metadata,
    error: null,
    updatedAt
  }
}

async function failTrackedVideoTask(
  task: VideoTaskRow,
  message: string
): Promise<VideoTaskRow> {
  const updatedAt = new Date().toISOString()
  await db.update(videoTasks)
    .set({
      status: 'failed',
      error: message,
      updatedAt
    })
    .where(eq(videoTasks.id, task.id))

  return {
    ...task,
    status: 'failed',
    error: message,
    updatedAt
  }
}

async function refreshTrackedVideoTask(task: VideoTaskRow): Promise<VideoTaskRow> {
  if (task.status !== 'processing') {
    return task
  }

  const upstreamTask = parseVideoTaskMetadata(task.metadata).upstreamTask
  if (!upstreamTask) {
    return task
  }

  try {
    if (upstreamTask.provider === 'qwen' && upstreamTask.taskId) {
      const statusResponse = await qwen.queryQwenVideoTask(upstreamTask.taskId)
      const status = statusResponse.output.task_status

      if (status === 'SUCCEEDED') {
        const videoUrl = statusResponse.output.video_url
        if (!videoUrl) {
          return await failTrackedVideoTask(task, '视频生成成功但未返回 URL')
        }
        return await finalizeTrackedVideoTask(task, upstreamTask, videoUrl)
      }

      if (status === 'FAILED' || status === 'UNKNOWN') {
        return await failTrackedVideoTask(task, statusResponse.output.message || '视频生成失败')
      }

      return task
    }

    if (upstreamTask.provider === 'kling' && upstreamTask.taskId && upstreamTask.endpoint) {
      const statusResponse = await kling.queryKlingVideoTask({
        endpoint: upstreamTask.endpoint,
        taskId: upstreamTask.taskId
      })
      const status = statusResponse.task_status

      if (status === 'succeed') {
        const videoUrl = statusResponse.task_result?.videos?.[0]?.url
        if (!videoUrl) {
          return await failTrackedVideoTask(task, '视频生成成功但未返回 URL')
        }
        return await finalizeTrackedVideoTask(task, upstreamTask, videoUrl)
      }

      if (status === 'failed') {
        return await failTrackedVideoTask(task, statusResponse.task_status_msg || '视频生成失败')
      }

      return task
    }

    if (upstreamTask.provider === 'volcengine' && upstreamTask.taskId) {
      const statusResponse = await volcengine.queryVolcengineVideoTask(upstreamTask.taskId)
      const status = statusResponse.status

      if (status === 'succeeded') {
        const videoUrl = statusResponse.content?.video_url
        if (!videoUrl) {
          return await failTrackedVideoTask(task, '视频生成成功但未返回 URL')
        }
        return await finalizeTrackedVideoTask(task, upstreamTask, videoUrl)
      }

      if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        return await failTrackedVideoTask(task, statusResponse.error?.message || '视频生成失败')
      }
    }
  } catch (error) {
    console.warn(`[VideoStatus] 刷新上游任务状态失败: ${task.id}`, error)
  }

  return task
}

/**
 * 视频生成状态查询 API
 * GET /api/video/status/:id
 *
 * 查询视频生成任务的状态
 */
export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'id')

  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '缺少任务ID',
    })
  }

  const tasks = await db.select()
    .from(videoTasks)
    .where(eq(videoTasks.id, taskId))
    .limit(1)

  let task = tasks[0]

  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `未找到任务: ${taskId}`
    })
  }

  task = await refreshTrackedVideoTask(task)

  const metadata = parseVideoTaskMetadata(task.metadata)

  return {
    success: true,
    task: {
      id: task.id,
      sceneId: task.sceneId,
      status: task.status,
      progress: task.progress,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      result: task.status === 'completed'
        ? {
            id: `generated_${task.id}`,
            sceneId: task.sceneId,
            videoData: task.videoData,
            metadata,
            createdAt: task.createdAt
          }
        : undefined
    }
  }
})
