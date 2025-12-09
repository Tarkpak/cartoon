import { GoogleGenAI } from '@google/genai'

let client: GoogleGenAI | null = null

/**
 * 获取 Gemini API 客户端实例 (单例模式)
 */
export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const config = useRuntimeConfig()
    const apiKey = config.geminiApiKey as string
    
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY 环境变量未设置')
    }
    
    client = new GoogleGenAI({ apiKey })
  }
  
  return client
}

/**
 * 文本生成模型配置
 */
export const TextModels = {
  /** 剧本解析 - 强推理能力 */
  SCRIPT_PARSER: 'gemini-3-pro-preview',
  /** 通用任务 */
  GENERAL: 'gemini-2.5-flash',
} as const

/**
 * 图片生成模型配置
 */
export const ImageModels = {
  /** Nano Banana Pro - 4K高质量 */
  HIGH_QUALITY: 'gemini-3-pro-image-preview',
  /** Nano Banana - 快速生成 */
  FAST: 'gemini-2.5-flash-image',
} as const

/**
 * 视频生成模型配置
 */
export const VideoModels = {
  /** Veo 3.1 - 支持首尾帧 */
  VEO_3_1: 'veo-3.1-generate-preview',
  /** Veo 3.1 快速版 */
  VEO_3_1_FAST: 'veo-3.1-fast-preview',
} as const

/**
 * 音频生成模型配置
 */
export const AudioModels = {
  /** Lyria - 背景音乐 */
  LYRIA: 'lyria-realtime-exp',
} as const
