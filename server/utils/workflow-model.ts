/**
 * 业务流程模型配置工具
 * 每次调用都从数据库读取最新配置
 */

import type { WorkflowStep } from '#shared/types/workflow-models'
import { findTextModel, findImageModel, findVideoModel, findVoiceModel } from './model-provider'
import * as gemini from './gemini'
import * as qwen from './qwen'
import * as kling from './kling'
import * as volcengine from './volcengine'
import { getWorkflowModels, getWorkflowModelOptions } from '../api/models/workflow.get'

/**
 * 从数据库获取指定业务流程的模型配置
 */
export async function getWorkflowModel(step: WorkflowStep): Promise<string> {
  const models = await getWorkflowModels()
  const modelId = models[step]
  if (!modelId) {
    throw new Error(`[WorkflowModel] 未找到流程模型配置: ${step}`)
  }
  return modelId
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
    imageSize?: gemini.GeminiImageSize | string
    aspectRatio?: string
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

  if (provider === 'kling') {
    const klingReferenceImages = options.referenceImages && options.referenceImages.length > 0
      ? options.referenceImages
      : options.referenceImage?.data
        ? [options.referenceImage.data]
        : undefined

    const result = await kling._klingGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: klingReferenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  // Gemini
  const workflowModelOptions = await getWorkflowModelOptions()
  const geminiImageSize = options.imageSize || workflowModelOptions.image_generation.geminiImageSize
  const result = await gemini._geminiGenerateImage({
    model: modelId,
    prompt: options.prompt,
    imageSize: geminiImageSize,
    aspectRatio: options.aspectRatio,
    size: options.size,
    referenceImage: options.referenceImage,
    referenceImages: options.referenceImages,
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

  if (provider === 'kling') {
    const isKlingV3Omni = modelId === kling.KlingVideoModels.KLING_V3_OMNI
    let klingMode: 'std' | 'pro' = 'pro'
    let klingWithAudio = options.audio

    if (isKlingV3Omni) {
      const workflowOptions = await getWorkflowModelOptions()
      klingMode = workflowOptions.video_generation.klingV3Omni.mode
      klingWithAudio = workflowOptions.video_generation.klingV3Omni.sound === 'on'
    }

    return kling._klingGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      duration: options.duration,
      withAudio: klingWithAudio,
      mode: klingMode,
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
