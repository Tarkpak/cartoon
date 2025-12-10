import { getPipelineTaskWS } from '../../../utils/websocket'

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

  const task = getPipelineTaskWS(taskId)

  if (!task) {
    throw createError({
      statusCode: 404,
      statusMessage: '任务不存在'
    })
  }

  return {
    success: true,
    task
  }
})
