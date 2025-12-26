/**
 * 更新业务流程模型配置
 */

import { z } from 'zod'
import { WorkflowStepSchema } from '#shared/types/workflow-models'
import { setWorkflowModel, setWorkflowModels, getWorkflowModels } from './workflow.get'

// 单个更新
const SingleUpdateSchema = z.object({
  step: WorkflowStepSchema,
  modelId: z.string()
})

// 批量更新
const BatchUpdateSchema = z.object({
  models: z.record(WorkflowStepSchema, z.string())
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  
  // 尝试批量更新
  const batchParsed = BatchUpdateSchema.safeParse(body)
  if (batchParsed.success) {
    await setWorkflowModels(batchParsed.data.models)
    
    return {
      success: true,
      data: {
        updated: batchParsed.data.models,
        currentSelections: await getWorkflowModels()
      }
    }
  }
  
  // 尝试单个更新
  const singleParsed = SingleUpdateSchema.safeParse(body)
  if (singleParsed.success) {
    const { step, modelId } = singleParsed.data
    await setWorkflowModel(step, modelId)
    
    return {
      success: true,
      data: {
        step,
        modelId,
        currentSelections: await getWorkflowModels()
      }
    }
  }
  
  throw createError({
    statusCode: 400,
    message: '参数错误: 需要 {step, modelId} 或 {models: {...}}'
  })
})
