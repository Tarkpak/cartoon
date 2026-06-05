import { z } from 'zod'

// ==================== 模型提供商 ====================

/** 模型提供商 */
export const ModelProviderSchema = z.enum([
  'gemini', // Google Gemini
  'qwen', // 阿里云千问
  'kling', // 可灵 AI
  'volcengine', // 火山引擎 (豆包)
  'custom_openai', // 自定义 OpenAI 兼容接口
  'openai', // OpenAI (预留)
  'deepseek' // DeepSeek
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
  sizeSelectionMode: z.enum(['fixed', 'preset', 'constraint']).optional(),
  sizeConstraints: z.object({
    maxEdge: z.number().int().positive().optional(),
    edgeMultiple: z.number().int().positive().optional(),
    maxAspectRatio: z.string().optional(),
    minPixels: z.number().int().positive().optional(),
    maxPixels: z.number().int().positive().optional()
  }).optional(),
  supportedAspectRatios: z.array(z.string()).optional(),
  supportedQualities: z.array(z.string()).optional(),
  supportTextToImage: z.boolean().default(true).describe('是否支持文生图'),
  supportImageToImage: z.boolean().default(false).describe('是否支持图生图'),
  supportReferenceImage: z.boolean().default(false).describe('是否支持参考图'),
  supportReferenceImages: z.boolean().optional().describe('是否支持多参考图（referenceImages）'),
  requireReferenceImage: z.boolean().default(false).optional().describe('是否必须需要参考图'),
  maxReferenceImages: z.number().int().positive().optional().describe('参考图最大数量'),
  docUrl: z.string().optional().describe('API文档链接')
})
export type ImageModelConfig = z.infer<typeof ImageModelConfigSchema>

// ==================== 3D模型 ====================

/** 3D模型配置 */
export const ThreeDModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  supportTextTo3D: z.boolean().default(false).describe('是否支持文生3D'),
  supportImageTo3D: z.boolean().default(false).describe('是否支持图生3D'),
  docUrl: z.string().optional().describe('API文档链接')
})
export type ThreeDModelConfig = z.infer<typeof ThreeDModelConfigSchema>

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
  maxReferenceImages: z.number().int().positive().optional().describe('多参考图最大数量（按模型能力）'),
  supportVideoReference: z.boolean().optional().describe('是否支持视频参考（referenceVideos / first_clip）'),
  maxReferenceVideos: z.number().int().positive().optional().describe('视频参考最大数量（按模型能力）'),
  supportTextToVideo: z.boolean().default(true).describe('是否支持文生视频'),
  supportAudioReference: z.boolean().optional().describe('是否支持显式音频参考（audioUrl / reference_audio）'),
  maxReferenceAudios: z.number().int().positive().optional().describe('音频参考最大数量（按模型能力）'),
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
  threeD: z.array(ThreeDModelConfigSchema).optional(),
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

// ==================== 自定义供应商 ====================

/** OpenAI 兼容格式自定义供应商配置 */
export const CustomOpenAIProviderConfigSchema = z.object({
  enabled: z.boolean().default(false),
  displayName: z.string().trim().min(1).max(60).default('自定义 OpenAI'),
  baseUrl: z.string().trim().min(1).default(''),
  apiKey: z.string().optional().default(''),
  textModels: z.array(z.string().trim().min(1)).default([]),
  availableTextModels: z.array(z.string().trim().min(1)).default([]),
  modelsSyncedAt: z.string().optional(),
  modelsSyncError: z.string().optional()
})
export type CustomOpenAIProviderConfig = z.infer<typeof CustomOpenAIProviderConfigSchema>

/** 返回给前端时不暴露密钥明文 */
export const CustomOpenAIProviderPublicConfigSchema = CustomOpenAIProviderConfigSchema.omit({
  apiKey: true
}).extend({
  hasApiKey: z.boolean().default(false)
})
export type CustomOpenAIProviderPublicConfig = z.infer<typeof CustomOpenAIProviderPublicConfigSchema>

// ==================== 供应商凭证（客户端可配） ====================

/** 单个 OpenAI 兼容供应商的脱敏凭证视图（apiKey 不回传，只返回是否已配置） */
export const ProviderApiKeyCredentialSchema = z.object({
  hasApiKey: z.boolean().default(false),
  baseUrl: z.string().default('')
})
export type ProviderApiKeyCredential = z.infer<typeof ProviderApiKeyCredentialSchema>

/** 可灵双密钥脱敏视图 */
export const KlingCredentialSchema = z.object({
  hasAccessKey: z.boolean().default(false),
  hasSecretKey: z.boolean().default(false),
  baseUrl: z.string().default('')
})
export type KlingCredential = z.infer<typeof KlingCredentialSchema>

/** GET /api/model-providers/credentials 返回结构 */
export const ProviderCredentialsPublicSchema = z.object({
  gemini: ProviderApiKeyCredentialSchema,
  qwen: ProviderApiKeyCredentialSchema,
  volcengine: ProviderApiKeyCredentialSchema,
  deepseek: ProviderApiKeyCredentialSchema,
  kling: KlingCredentialSchema
})
export type ProviderCredentialsPublic = z.infer<typeof ProviderCredentialsPublicSchema>

// ==================== TOS 云存储配置（客户端可配） ====================

/** GET /api/tos/config 返回结构（密钥脱敏） */
export const TosConfigPublicSchema = z.object({
  enabled: z.boolean().default(false),
  accessKeyId: z.string().default(''),
  hasSecretKey: z.boolean().default(false),
  hasSecurityToken: z.boolean().default(false),
  region: z.string().default(''),
  endpoint: z.string().default(''),
  bucket: z.string().default(''),
  keyPrefix: z.string().default(''),
  publicBaseUrl: z.string().default(''),
  isCustomDomain: z.boolean().default(false)
})
export type TosConfigPublic = z.infer<typeof TosConfigPublicSchema>
