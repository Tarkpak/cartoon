/**
 * 获取业务流程模型配置
 * 返回各业务流程的模型需求和当前选择
 */

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

// 内存存储业务流程模型选择
let workflowModels: Record<WorkflowStep, string> = {
  // 文本生成类 - 默认使用千问
  outline_generation: 'qwen-flash',
  script_parsing: 'qwen-flash',
  character_extraction: 'qwen-flash',
  storyboard_generation: 'qwen-flash',
  scene_visual_extraction: 'qwen-flash',
  
  // 图片生成类
  character_portrait: 'wanx2.1-t2i-turbo',
  character_views: 'gemini-3-pro-image-preview',  // 需要参考图
  frame_generation: 'gemini-3-pro-image-preview', // 需要参考图
  
  // 视频生成类
  video_generation: 'veo-3.1-generate-preview',   // 需要首尾帧
  
  // 语音生成类
  voice_synthesis: 'qwen3-tts-flash'
}

export function getWorkflowModels() {
  return { ...workflowModels }
}

export function setWorkflowModel(step: WorkflowStep, modelId: string) {
  workflowModels[step] = modelId
}

/** 检查模型是否满足能力要求 */
function checkModelCapabilities(
  model: TextModelConfig | ImageModelConfig | VideoModelConfig | VoiceModelConfig,
  requiredCapabilities: ModelCapability[]
): boolean {
  for (const cap of requiredCapabilities) {
    switch (cap) {
      case 'text_generation':
        // 所有文本模型都支持
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

export default defineEventHandler(async () => {
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
        // 添加能力标签
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
