import { getPipelineTask } from '../produce.post'

/**
 * 流水线状态查询 API
 * GET /api/pipeline/status/:id
 */
export default defineEventHandler(async (event) => {
  const taskId = getRouterParam(event, 'id')

  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少任务ID'
    })
  }

  const task = getPipelineTask(taskId)

  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: '任务不存在'
    })
  }

  return {
    success: true,
    task: {
      id: task.id,
      projectId: task.projectId,
      status: task.status,
      progress: task.progress,
      currentStep: task.currentStep,
      steps: task.steps,
      outputPath: task.outputPath,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
  }
})
