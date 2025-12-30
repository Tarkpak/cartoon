/**
 * 业务流程模型配置工具
 * 每次调用都从数据库读取最新配置
 */

import { eq } from 'drizzle-orm'
import { db, systemConfig } from '../db'
import type { WorkflowStep } from '#shared/types/workflow-models'
import { findTextModel, findImageModel, findVideoModel, findVoiceModel } from './model-provider'
import * as gemini from './gemini'
import * as qwen from './qwen'
import * as volcengine from './volcengine'

// 配置键名
const WORKFLOW_MODELS_KEY = 'workflow_models'

// 默认配置
const DEFAULT_WORKFLOW_MODELS: Record<WorkflowStep, string> = {
  outline_generation: 'qwen-flash',
  script_parsing: 'qwen-flash',
  character_extraction: 'qwen-flash',
  storyboard_generation: 'qwen-flash',
  scene_visual_extraction: 'qwen-flash',
  text_translation: 'qwen-flash',
  character_portrait: 'wanx2.1-t2i-turbo',
  character_views: 'wan2.6-image',
  frame_generation: 'wan2.6-image',
  video_generation: 'wan2.2-kf2v-flash',
  voice_synthesis: 'qwen3-tts-flash'
}

/**
 * 从数据库获取指定业务流程的模型配置
 */
export async function getWorkflowModel(step: WorkflowStep): Promise<string> {
  try {
    const result = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, WORKFLOW_MODELS_KEY))
      .limit(1)
    
    if (result.length > 0 && result[0].value) {
      const saved = JSON.parse(result[0].value) as Partial<Record<WorkflowStep, string>>
      if (saved[step]) {
        return saved[step]!
      }
    }
  } catch (error) {
    console.error(`[WorkflowModel] 读取配置失败 (${step}):`, error)
  }
  
  return DEFAULT_WORKFLOW_MODELS[step]
}

/**
 * 根据业务流程生成纯文本 (文本生成类)
 */
export async function generateTextForWorkflow(
  step: WorkflowStep,
  options: {
    prompt: string
    systemInstruction?: string
    temperature?: number
    maxRetries?: number
  }
): Promise<string> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findTextModel(modelId)
  const provider = modelConfig?.provider || 'qwen'
  
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)
  
  if (provider === 'qwen') {
    return qwen._qwenGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }
  
  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }
  
  // Gemini
  return gemini._geminiGenerateText({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

/**
 * 根据业务流程生成 JSON (文本生成类)
 */
export async function generateJSONForWorkflow<T>(
  step: WorkflowStep,
  options: {
    prompt: string
    systemInstruction?: string
    temperature?: number
    maxRetries?: number
  }
): Promise<T> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findTextModel(modelId)
  const provider = modelConfig?.provider || 'qwen'
  
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)
  
  if (provider === 'qwen') {
    return qwen._qwenGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }
  
  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }
  
  // Gemini
  return gemini._geminiGenerateJSON<T>({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

/**
 * 根据业务流程生成图片 (图片生成类)
 */
export async function generateImageForWorkflow(
  step: WorkflowStep,
  options: {
    prompt: string
    negativePrompt?: string
    size?: string
    referenceImages?: string[]
    referenceImage?: { data: string, mimeType: string }
    maxRetries?: number
  }
): Promise<{ imageData?: string, imageUrl?: string, mimeType?: string }> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findImageModel(modelId)
  const provider = modelConfig?.provider || 'qwen'
  
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)
  
  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: options.referenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }
  
  if (provider === 'volcengine') {
    const result = await volcengine._volcengineGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: options.referenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }
  
  // Gemini
  const result = await gemini._geminiGenerateImage({
    model: modelId,
    prompt: options.prompt,
    referenceImage: options.referenceImage,
    maxRetries: options.maxRetries
  })
  return {
    imageData: result.imageData,
    mimeType: result.mimeType
  }
}

/**
 * 根据业务流程生成视频 (视频生成类)
 */
export async function generateVideoForWorkflow(
  step: WorkflowStep,
  options: {
    prompt: string
    firstFrameUrl?: string
    lastFrameUrl?: string
    imageUrl?: string
    audioUrl?: string
    duration?: number
    size?: string
    resolution?: string
    negativePrompt?: string
    promptExtend?: boolean
    audio?: boolean
    watermark?: boolean
    seed?: number
    maxRetries?: number
  }
): Promise<{ videoUrl?: string, taskId: string }> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findVideoModel(modelId)
  const provider = modelConfig?.provider || 'qwen'
  
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)
  
  if (provider === 'qwen') {
    return qwen._qwenGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      imageUrl: options.imageUrl,
      audioUrl: options.audioUrl,
      duration: options.duration,
      size: options.size,
      resolution: options.resolution,
      negativePrompt: options.negativePrompt,
      promptExtend: options.promptExtend,
      audio: options.audio,
      watermark: options.watermark,
      seed: options.seed,
      maxRetries: options.maxRetries
    })
  }
  
  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      imageUrl: options.imageUrl,
      duration: options.duration,
      size: options.size,
      resolution: options.resolution,
      negativePrompt: options.negativePrompt,
      maxRetries: options.maxRetries
    })
  }
  
  // Gemini 视频生成需要通过专门的 API
  throw new Error('Gemini 视频生成请使用 /api/video/generate API')
}

/**
 * 根据业务流程生成语音 (语音生成类)
 */
export async function generateVoiceForWorkflow(
  step: WorkflowStep,
  options: {
    text: string
    voice?: string
    speed?: number
    maxRetries?: number
  }
): Promise<{ audioData: string, audioUrl?: string }> {
  const modelId = await getWorkflowModel(step)
  const modelConfig = findVoiceModel(modelId)
  const provider = modelConfig?.provider || 'qwen'
  
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [${step}] 使用模型: ${modelId} (${provider})`)
  
  // 目前只有千问支持 TTS
  return qwen._qwenTextToSpeech({
    model: modelId,
    text: options.text,
    voice: options.voice,
    speed: options.speed,
    maxRetries: options.maxRetries
  })
}
