/**
 * 统一模型提供商管理器
 * 支持在不同 AI 服务商之间切换
 */

import type {
  ModelProvider,
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig,
  SelectedModels
} from '../../shared/types/provider'

import * as gemini from './gemini'
import * as qwen from './qwen'

// 注意: GeminiError/GeminiErrorCode 请从 './gemini' 导入
// 注意: QwenError/QwenErrorCode 请从 './qwen' 导入

// ============================================================
// 可用模型配置
// ============================================================

/** 所有可用的文本模型 */
export const TEXT_MODELS: TextModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.TextModels.GENERAL,
    displayName: 'Gemini 3 Flash',
    description: '快速响应，适合通用任务',
    supportThinking: false
  },
  {
    provider: 'gemini',
    model: gemini.TextModels.SCRIPT_PARSER,
    displayName: 'Gemini 3 Flash (剧本解析)',
    description: '针对剧本解析优化',
    supportThinking: false
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN3_MAX,
    displayName: '通义千问3-Max',
    description: '适配复杂场景，达到领域SOTA水平',
    supportThinking: false
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_FLASH,
    displayName: '通义千问-Flash',
    description: '小尺寸，低延时，高性价比',
    supportThinking: false
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_PLUS_THINKING,
    displayName: '通义千问-Plus (深度思考)',
    description: '百万上下文，混合模式随心切',
    supportThinking: true
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_FLASH_THINKING,
    displayName: '通义千问-Flash (深度思考)',
    description: 'Flash最新快照，超高性价比',
    supportThinking: true
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.DEEPSEEK_V3_2,
    displayName: 'DeepSeek-V3.2',
    description: '全新混合推理架构模型',
    supportThinking: true
  }
]

/** 所有可用的图片模型 */
export const IMAGE_MODELS: ImageModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.ImageModels.HIGH_QUALITY,
    displayName: 'Gemini 3 Pro Image',
    description: '4K高质量图片生成',
    supportReferenceImage: true
  },
  {
    provider: 'gemini',
    model: gemini.ImageModels.FAST,
    displayName: 'Gemini 2.5 Flash Image',
    description: '快速生成',
    supportReferenceImage: true
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.QWEN_IMAGE_PLUS,
    displayName: '通义千问-Image-Plus',
    description: '文生图，文本卓越渲染出画',
    supportReferenceImage: false
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.WAN_2_6_T2I,
    displayName: '通义万相2.6-文生图',
    description: '精准指令遵循，真实质感显著提升',
    supportReferenceImage: false
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.Z_IMAGE_TURBO,
    displayName: 'Z-Image-Turbo',
    description: '高性价比，照片级品质',
    supportReferenceImage: false
  }
]

/** 所有可用的视频模型 */
export const VIDEO_MODELS: VideoModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1,
    displayName: 'Veo 3.1',
    description: '支持首尾帧插值',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true
  },
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1_FAST,
    displayName: 'Veo 3.1 Fast',
    description: '速度优化版本',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true
  },
  // 千问模型 (通义万相)
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_6_T2V,
    displayName: '通义万相2.6-文生视频',
    description: '全新参考生视频，智能多镜，15秒时长',
    maxDuration: 15,
    supportFirstLastFrame: false,
    supportImageToVideo: false,
    supportTextToVideo: true
  },
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_6_I2V,
    displayName: '通义万相2.6-图生视频',
    description: '智能分镜，最高15秒视频生成',
    maxDuration: 15,
    supportFirstLastFrame: false,
    supportImageToVideo: true,
    supportTextToVideo: false
  }
]

/** 所有可用的语音模型 */
export const VOICE_MODELS: VoiceModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.AudioModels.LYRIA,
    displayName: 'Lyria',
    description: '背景音乐生成',
    type: 'tts'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
    displayName: '通义千问3-TTS-Flash',
    description: '高表现力多语言拟人音色',
    type: 'tts',
    supportedLanguages: ['zh', 'en', 'ja', 'ko']
  },
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.QWEN3_ASR_FLASH,
    displayName: '通义千问3-ASR-Flash',
    description: '精准多语言转写与情绪识别',
    type: 'asr',
    supportedLanguages: ['zh', 'en', 'ja', 'ko']
  },
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.FUN_ASR_MTL,
    displayName: '百聆-FUN-ASR-Mtl',
    description: '高准确率方言及多语言语音识别',
    type: 'asr',
    supportedLanguages: ['zh', 'en', 'ja', 'ko', 'yue', 'wuu']
  }
]

// ============================================================
// 当前选择的模型 (内存存储，可改为数据库)
// ============================================================

let currentModels: SelectedModels = {
  text: qwen.QwenTextModels.QWEN_FLASH,  // 默认使用千问
  image: qwen.QwenImageModels.WAN_2_6_T2I,  // 默认使用千问
  video: qwen.QwenVideoModels.WAN_2_6_T2V,  // 默认使用千问
  tts: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
  asr: qwen.QwenVoiceModels.QWEN3_ASR_FLASH
}

export function getSelectedModels(): SelectedModels {
  return { ...currentModels }
}

export function setSelectedModel(type: keyof SelectedModels, modelId: string): void {
  currentModels[type] = modelId
}

// ============================================================
// 模型查找辅助函数
// ============================================================

export function findTextModel(modelId: string): TextModelConfig | undefined {
  return TEXT_MODELS.find(m => m.model === modelId)
}

export function findImageModel(modelId: string): ImageModelConfig | undefined {
  return IMAGE_MODELS.find(m => m.model === modelId)
}

export function findVideoModel(modelId: string): VideoModelConfig | undefined {
  return VIDEO_MODELS.find(m => m.model === modelId)
}

export function findVoiceModel(modelId: string): VoiceModelConfig | undefined {
  return VOICE_MODELS.find(m => m.model === modelId)
}

function getProviderFromModel(modelId: string): ModelProvider {
  const allModels = [...TEXT_MODELS, ...IMAGE_MODELS, ...VIDEO_MODELS, ...VOICE_MODELS]
  const model = allModels.find(m => m.model === modelId)
  return model?.provider || 'gemini'
}


// ============================================================
// 统一 API 封装 - 文本生成
// ============================================================

export async function generateText(options: {
  modelId?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
  enableThinking?: boolean
}): Promise<string> {
  const modelId = options.modelId || currentModels.text
  const provider = getProviderFromModel(modelId)

  console.log(`[ModelProvider] generateText - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      enableThinking: options.enableThinking
    })
  }

  // 默认使用 Gemini
  return gemini._geminiGenerateText({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

export async function generateJSON<T>(options: {
  modelId?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const modelId = options.modelId || currentModels.text
  const provider = getProviderFromModel(modelId)

  console.log(`[ModelProvider] generateJSON - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  return gemini._geminiGenerateJSON<T>({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

// ============================================================
// 统一 API 封装 - 图片生成
// ============================================================

export interface GenerateImageResult {
  imageData?: string      // base64 (Gemini)
  imageUrl?: string       // URL (Qwen)
  mimeType?: string
  text?: string
}

export async function generateImage(options: {
  modelId?: string
  prompt: string
  referenceImage?: { data: string, mimeType: string }
  negativePrompt?: string
  size?: string
  maxRetries?: number
}): Promise<GenerateImageResult> {
  const modelId = options.modelId || currentModels.image
  const provider = getProviderFromModel(modelId)

  console.log(`[ModelProvider] generateImage - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
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
    mimeType: result.mimeType,
    text: result.text
  }
}

// ============================================================
// 统一 API 封装 - 视频生成
// ============================================================

export interface GenerateVideoResult {
  videoData?: string      // base64 或 ref (Gemini)
  videoUrl?: string       // URL (Qwen)
  taskId: string
}

export async function generateVideo(options: {
  modelId?: string
  prompt: string
  firstFrame?: string     // base64 (Gemini)
  lastFrame?: string      // base64 (Gemini)
  imageUrl?: string       // 图生视频输入 (Qwen)
  audioUrl?: string       // 自定义音频 (Qwen)
  duration?: number
  aspectRatio?: string
  size?: string           // Qwen 使用 size 如 '1280*720'
  resolution?: string
  negativePrompt?: string
  promptExtend?: boolean
  audio?: boolean
  watermark?: boolean
  seed?: number
  maxRetries?: number
}): Promise<GenerateVideoResult> {
  const modelId = options.modelId || currentModels.video
  const provider = getProviderFromModel(modelId)

  console.log(`[ModelProvider] generateVideo - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      audioUrl: options.audioUrl,
      duration: options.duration,
      size: options.size,
      negativePrompt: options.negativePrompt,
      promptExtend: options.promptExtend,
      audio: options.audio,
      watermark: options.watermark,
      seed: options.seed,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  // Gemini - 需要通过原有的 video API 处理
  // 这里返回一个占位，实际视频生成仍通过 /api/video/generate
  throw new Error('Gemini 视频生成请使用 /api/video/generate API')
}

// ============================================================
// 统一 API 封装 - 语音合成
// ============================================================

export async function textToSpeech(options: {
  modelId?: string
  text: string
  voice?: string
  speed?: number
  maxRetries?: number
}): Promise<{ audioData: string, audioUrl?: string }> {
  const modelId = options.modelId || currentModels.tts || qwen.QwenVoiceModels.QWEN3_TTS_FLASH
  const provider = getProviderFromModel(modelId)

  console.log(`[ModelProvider] textToSpeech - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenTextToSpeech({
      model: modelId,
      text: options.text,
      voice: options.voice,
      speed: options.speed,
      maxRetries: options.maxRetries
    })
  }

  // Gemini 暂不支持 TTS，使用千问
  return qwen._qwenTextToSpeech({
    model: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
    text: options.text,
    voice: options.voice,
    speed: options.speed,
    maxRetries: options.maxRetries
  })
}

// ============================================================
// 统一 API 封装 - 语音识别
// ============================================================

export async function speechToText(options: {
  modelId?: string
  audioUrl?: string
  audioData?: string
  language?: string
  maxRetries?: number
}): Promise<{ text: string }> {
  const modelId = options.modelId || currentModels.asr || qwen.QwenVoiceModels.QWEN3_ASR_FLASH
  const provider = getProviderFromModel(modelId)

  console.log(`[ModelProvider] speechToText - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenSpeechToText({
      model: modelId,
      audioUrl: options.audioUrl,
      audioData: options.audioData,
      language: options.language,
      maxRetries: options.maxRetries
    })
  }

  // Gemini 暂不支持 ASR，使用千问
  return qwen._qwenSpeechToText({
    model: qwen.QwenVoiceModels.QWEN3_ASR_FLASH,
    audioUrl: options.audioUrl,
    audioData: options.audioData,
    language: options.language,
    maxRetries: options.maxRetries
  })
}
