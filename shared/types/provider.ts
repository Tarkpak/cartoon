import { z } from 'zod'

// ==================== 模型提供商 ====================

/** 模型提供商 */
export const ModelProviderSchema = z.enum([
  'gemini', // Google Gemini
  'qwen', // 阿里云千问
  'kling', // 可灵 AI
  'volcengine', // 火山引擎 (豆包)
  'openai', // OpenAI (预留)
  'deepseek' // DeepSeek (预留)
])
export type ModelProvider = z.infer<typeof ModelProviderSchema>

// ==================== 文本模型 ====================

/** 文本模型配置 */
export const TextModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  maxTokens: z.number().optional(),
  supportThinking: z.boolean().default(false).describe('是否支持深度思考模式'),
  docUrl: z.string().optional().describe('API文档链接')
})
export type TextModelConfig = z.infer<typeof TextModelConfigSchema>

// ==================== 图片模型 ====================

/** 图片模型配置 */
export const ImageModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  supportedSizes: z.array(z.string()).optional(),
  supportReferenceImage: z.boolean().default(false).describe('是否支持参考图'),
  requireReferenceImage: z.boolean().default(false).optional().describe('是否必须需要参考图'),
  docUrl: z.string().optional().describe('API文档链接')
})
export type ImageModelConfig = z.infer<typeof ImageModelConfigSchema>

// ==================== 视频模型 ====================

/** 视频模型配置 */
export const VideoModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  maxDuration: z.number().optional().describe('最大时长(秒)'),
  supportFirstLastFrame: z.boolean().default(false).describe('是否支持首尾帧'),
  supportImageToVideo: z.boolean().default(false).describe('是否支持图生视频'),
  supportReferenceImages: z.boolean().optional().describe('是否支持多参考图（referenceImages）'),
  supportTextToVideo: z.boolean().default(true).describe('是否支持文生视频'),
  docUrl: z.string().optional().describe('API文档链接')
})
export type VideoModelConfig = z.infer<typeof VideoModelConfigSchema>

// ==================== 语音模型 ====================

/** 语音模型类型 */
export const VoiceModelTypeSchema = z.enum(['tts', 'asr'])
export type VoiceModelType = z.infer<typeof VoiceModelTypeSchema>

/** 语音模型配置 */
export const VoiceModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  type: VoiceModelTypeSchema,
  supportedLanguages: z.array(z.string()).optional(),
  docUrl: z.string().optional().describe('API文档链接')
})
export type VoiceModelConfig = z.infer<typeof VoiceModelConfigSchema>

// ==================== 模型选择 ====================

/** 当前选择的模型配置 */
export const SelectedModelsSchema = z.object({
  text: z.string().describe('文本模型ID'),
  image: z.string().describe('图片模型ID'),
  video: z.string().describe('视频模型ID'),
  tts: z.string().optional().describe('TTS模型ID'),
  asr: z.string().optional().describe('ASR模型ID')
})
export type SelectedModels = z.infer<typeof SelectedModelsSchema>

// ==================== API 请求/响应 ====================

/** 获取可用模型列表响应 */
export const AvailableModelsResponseSchema = z.object({
  text: z.array(TextModelConfigSchema),
  image: z.array(ImageModelConfigSchema),
  video: z.array(VideoModelConfigSchema),
  voice: z.array(VoiceModelConfigSchema)
})
export type AvailableModelsResponse = z.infer<typeof AvailableModelsResponseSchema>

/** 切换模型请求 */
export const SwitchModelRequestSchema = z.object({
  type: z.enum(['text', 'image', 'video', 'tts', 'asr']),
  modelId: z.string()
})
export type SwitchModelRequest = z.infer<typeof SwitchModelRequestSchema>
