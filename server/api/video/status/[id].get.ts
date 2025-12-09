import { eq } from 'drizzle-orm'
import { db, videoTasks } from '../../../db'

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
      statusMessage: '缺少任务ID',
    })
  }

  // 从数据库查询任务
  const tasks = await db.select()
    .from(videoTasks)
    .where(eq(videoTasks.id, taskId))
    .limit(1)
  
  const task = tasks[0]
  
  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: '任务不存在',
      message: `未找到任务: ${taskId}`,
    })
  }

  // 解析 JSON 字段
  const metadata = task.metadata ? JSON.parse(task.metadata) : undefined

  // 返回任务状态
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
      // 只在完成时返回结果
      result: task.status === 'completed' ? {
        id: `generated_${task.id}`,
        sceneId: task.sceneId,
        videoData: task.videoData,
        metadata,
        createdAt: task.createdAt,
      } : undefined,
    },
  }
})
