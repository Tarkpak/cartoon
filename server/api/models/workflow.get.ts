/**
 * 获取业务流程模型配置
 * 从数据库读取配置，返回各业务流程的模型需求和当前选择
 */

import { eq } from 'drizzle-orm'
import { db, systemConfig } from '../../db'
import {
  TEXT_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  VOICE_MODELS
} from '../../utils/model-provider'
import {
  WORKFLOW_STEP_CONFIGS,
  type WorkflowStep,
  type ModelCapability
} from '#shared/types/workflow-models'
import type {
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig
} from '#shared/types/provider'

// 配置键名
const WORKFLOW_MODELS_KEY = 'workflow_models'

// 默认配置
const DEFAULT_WORKFLOW_MODELS: Record<WorkflowStep, string> = {
  // 文本生成类 - 默认使用千问
  outline_generation: 'qwen-flash',
  script_parsing: 'qwen-flash',
  character_extraction: 'qwen-flash',
  storyboard_generation: 'qwen-flash',
  scene_visual_extraction: 'qwen-flash',
  
  // 图片生成类 - 默认使用千问
  character_portrait: 'wanx2.1-t2i-turbo',
  character_views: 'wan2.6-image',
  frame_generation: 'wan2.6-image',
  
  // 视频生成类 - 默认使用千问
  video_generation: 'wan2.2-kf2v-flash',
  
  // 语音生成类 - 默认使用千问
  voice_synthesis: 'qwen3-tts-flash'
}

/**
 * 从数据库获取业务流程模型配置
 */
export async function getWorkflowModels(): Promise<Record<WorkflowStep, string>> {
  try {
    const result = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, WORKFLOW_MODELS_KEY))
      .limit(1)
    
    if (result.length > 0 && result[0].value) {
      const saved = JSON.parse(result[0].value) as Partial<Record<WorkflowStep, string>>
      // 合并默认配置和保存的配置
      return { ...DEFAULT_WORKFLOW_MODELS, ...saved }
    }
  } catch (error) {
    console.error('[WorkflowModels] 读取配置失败:', error)
  }
  
  return { ...DEFAULT_WORKFLOW_MODELS }
}

/**
 * 保存业务流程模型配置到数据库
 */
export async function setWorkflowModel(step: WorkflowStep, modelId: string): Promise<void> {
  const current = await getWorkflowModels()
  current[step] = modelId
  
  const now = new Date().toISOString()
  
  await db.insert(systemConfig)
    .values({
      key: WORKFLOW_MODELS_KEY,
      value: JSON.stringify(current),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(current),
        updatedAt: now
      }
    })
  
  console.log(`[WorkflowModels] 已保存配置: ${step} = ${modelId}`)
}

/**
 * 批量保存业务流程模型配置
 */
export async function setWorkflowModels(models: Partial<Record<WorkflowStep, string>>): Promise<void> {
  const current = await getWorkflowModels()
  const updated = { ...current, ...models }
  
  const now = new Date().toISOString()
  
  await db.insert(systemConfig)
    .values({
      key: WORKFLOW_MODELS_KEY,
      value: JSON.stringify(updated),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(updated),
        updatedAt: now
      }
    })
  
  console.log(`[WorkflowModels] 已批量保存配置:`, models)
}

/** 检查模型是否满足能力要求 */
function checkModelCapabilities(
  model: TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig,
  requiredCapabilities: ModelCapability[]
): boolean {
  for (const cap of requiredCapabilities) {
    switch (cap) {
      case 'text_generation':
        break
      case 'reference_image':
        if ('supportReferenceImage' in model && !model.supportReferenceImage) {
          return false
        }
        break
      case 'require_reference_image':
        if ('requireReferenceImage' in model && !model.requireReferenceImage) {
          return false
        }
        break
      case 'first_last_frame':
        if ('supportFirstLastFrame' in model && !model.supportFirstLastFrame) {
          return false
        }
        break
      case 'image_to_video':
        if ('supportImageToVideo' in model && !model.supportImageToVideo) {
          return false
        }
        break
      case 'text_to_video':
        if ('supportTextToVideo' in model && !model.supportTextToVideo) {
          return false
        }
        break
      case 'tts':
        if ('type' in model && model.type !== 'tts') {
          return false
        }
        break
      case 'asr':
        if ('type' in model && model.type !== 'asr') {
          return false
        }
        break
    }
  }
  return true
}

/** 获取满足能力要求的模型列表 */
function getCompatibleModels(
  category: 'text' | 'image' | 'video' | 'voice',
  requiredCapabilities: ModelCapability[]
) {
  let models: Array<TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig>
  
  switch (category) {
    case 'text':
      models = TEXT_MODELS
      break
    case 'image':
      models = IMAGE_MODELS
      break
    case 'video':
      models = VIDEO_MODELS
      break
    case 'voice':
      models = VOICE_MODELS.filter(m => m.type === 'tts')
      break
  }
  
  return models.filter(m => checkModelCapabilities(m, requiredCapabilities))
}

/** 获取模型的能力标签 */
function getModelCapabilityTags(
  model: TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig
): string[] {
  const tags: string[] = []
  
  if ('supportThinking' in model && model.supportThinking) {
    tags.push('深度思考')
  }
  if ('supportReferenceImage' in model && model.supportReferenceImage) {
    tags.push('参考图')
  }
  if ('requireReferenceImage' in model && model.requireReferenceImage) {
    tags.push('需参考图')
  }
  if ('supportFirstLastFrame' in model && model.supportFirstLastFrame) {
    tags.push('首尾帧')
  }
  if ('supportImageToVideo' in model && model.supportImageToVideo) {
    tags.push('图生视频')
  }
  if ('supportTextToVideo' in model && model.supportTextToVideo) {
    tags.push('文生视频')
  }
  if ('maxDuration' in model && model.maxDuration) {
    tags.push(`${model.maxDuration}s`)
  }
  
  return tags
}

export default defineEventHandler(async () => {
  // 从数据库读取当前配置
  const workflowModels = await getWorkflowModels()
  
  // 构建每个业务流程的可用模型列表
  const workflowConfigs = WORKFLOW_STEP_CONFIGS.map(config => {
    const compatibleModels = getCompatibleModels(config.category, config.requiredCapabilities)
    
    return {
      ...config,
      compatibleModels: compatibleModels.map(m => ({
        model: m.model,
        displayName: m.displayName,
        provider: m.provider,
        description: m.description,
        capabilities: getModelCapabilityTags(m)
      })),
      selectedModel: workflowModels[config.id] || null
    }
  })
  
  return {
    success: true,
    data: {
      workflows: workflowConfigs,
      currentSelections: workflowModels
    }
  }
})
