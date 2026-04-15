/**
 * 更新业务流程模型配置
 */

import { z } from 'zod'
import {
  WorkflowStepSchema,
  WorkflowVideoGenerationModelOptionsSchema
} from '#shared/types/workflow-models'
import {
  setWorkflowModel,
  setWorkflowModels,
  getWorkflowModels,
  getWorkflowModelOptions,
  setWorkflowVideoGenerationModelOptions
} from './workflow.get'

// 单个更新
const SingleUpdateSchema = z.object({
  step: WorkflowStepSchema,
  modelId: z.string()
})

// 批量更新
const BatchUpdateSchema = z.object({
  models: z.record(WorkflowStepSchema, z.string())
})

// 视频流程扩展配置更新
const VideoOptionsUpdateSchema = z.object({
  step: z.literal('video_generation'),
  modelOptions: WorkflowVideoGenerationModelOptionsSchema
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
        currentSelections: await getWorkflowModels(),
        modelOptions: await getWorkflowModelOptions()
      }
    }
  }

  // 尝试视频流程扩展配置更新
  const videoOptionsParsed = VideoOptionsUpdateSchema.safeParse(body)
  if (videoOptionsParsed.success) {
    await setWorkflowVideoGenerationModelOptions(videoOptionsParsed.data.modelOptions)

    return {
      success: true,
      data: {
        step: 'video_generation',
        modelOptions: await getWorkflowModelOptions(),
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
        currentSelections: await getWorkflowModels(),
        modelOptions: await getWorkflowModelOptions()
      }
    }
  }

  throw createError({
    statusCode: 400,
    message: '参数错误: 需要 {step, modelId}、{models: {...}} 或 {step:"video_generation", modelOptions:{...}}'
  })
})
