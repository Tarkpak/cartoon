/**
 * 更新业务流程模型配置
 */

import { z } from 'zod'
import { WorkflowStepSchema } from '#shared/types/workflow-models'
import { setWorkflowModel, getWorkflowModels } from './workflow.get'

const RequestSchema = z.object({
  step: WorkflowStepSchema,
  modelId: z.string()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: '参数错误: ' + parsed.error.message
    })
  }
  
  const { step, modelId } = parsed.data
  
  setWorkflowModel(step, modelId)
  
  return {
    success: true,
    data: {
      step,
      modelId,
      currentSelections: getWorkflowModels()
    }
  }
})
