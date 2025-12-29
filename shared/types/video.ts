import { z } from 'zod'

// ==================== 视频配置 ====================

/** 视频分辨率 */
export const ResolutionSchema = z.enum(['720p', '1080p'])
export type Resolution = z.infer<typeof ResolutionSchema>

/** 视频宽高比 */
export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1'])
export type AspectRatio = z.infer<typeof AspectRatioSchema>

/** 视频时长 (秒) - 支持 2-15 秒 */
export const DurationSchema = z.number().min(2).max(15)
export type Duration = number

/** 视频模型类型 */
export const VideoModelSchema = z.enum(['standard', 'fast'])
export type VideoModel = z.infer<typeof VideoModelSchema>

/** 视频提供商 */
export const VideoProviderSchema = z.enum(['gemini', 'qwen', 'volcengine'])
export type VideoProvider = z.infer<typeof VideoProviderSchema>

/** 视频生成配置 */
export const VideoGenerationConfigSchema = z.object({
  firstFrame: z.string().optional().describe('首帧图片 (base64) - Gemini 使用'),
  lastFrame: z.string().optional().describe('尾帧图片 (base64) - Gemini 使用'),
  imageUrl: z.string().optional().describe('输入图片 URL - Qwen 图生视频使用'),
  audioUrl: z.string().optional().describe('自定义音频 URL - Qwen 使用'),
  prompt: z.string().describe('视频描述提示词'),
  negativePrompt: z.string().optional().describe('负面提示词 - Qwen 使用'),
  duration: DurationSchema.default(8).describe('视频时长'),
  resolution: ResolutionSchema.default('720p').describe('分辨率'),
  aspectRatio: AspectRatioSchema.default('16:9').describe('宽高比'),
  size: z.string().optional().describe('视频尺寸 - Qwen 使用，如 1280*720'),
  withAudio: z.boolean().default(true).describe('是否生成音频'),
  promptExtend: z.boolean().optional().describe('是否启用提示词扩展 - Qwen 使用'),
  watermark: z.boolean().optional().describe('是否添加水印 - Qwen 使用'),
  seed: z.number().optional().describe('随机种子'),
  model: VideoModelSchema.default('standard').describe('模型类型: standard(高质量) / fast(快速)'),
  provider: VideoProviderSchema.optional().describe('模型提供商'),
  modelId: z.string().optional().describe('具体模型ID')
})
export type VideoGenerationConfig = z.infer<typeof VideoGenerationConfigSchema>

// ==================== 生成结果 ====================

/** 视频元数据 */
export const VideoMetadataSchema = z.object({
  duration: z.number().describe('实际时长(秒)'),
  resolution: ResolutionSchema.describe('分辨率'),
  aspectRatio: AspectRatioSchema.describe('宽高比'),
  fps: z.number().default(24).describe('帧率'),
  hasAudio: z.boolean().describe('是否有音频'),
  fileSize: z.number().optional().describe('文件大小(字节)')
})
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>

/** 生成的视频 */
export const GeneratedVideoSchema = z.object({
  id: z.string().describe('视频ID'),
  sceneId: z.string().optional().describe('关联场景ID'),
  videoData: z.string().describe('视频数据 (base64)'),
  audioData: z.string().optional().describe('音频数据 (base64)'),
  metadata: VideoMetadataSchema.describe('视频元数据'),
  createdAt: z.string().datetime().describe('创建时间')
})
export type GeneratedVideo = z.infer<typeof GeneratedVideoSchema>

// ==================== 生成任务 ====================

/** 任务状态 */
export const TaskStatusSchema = z.enum([
  'pending', // 等待中
  'processing', // 处理中
  'completed', // 已完成
  'failed' // 失败
])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

/** 视频生成任务 */
export const VideoTaskSchema = z.object({
  id: z.string().describe('任务ID'),
  sceneId: z.string().describe('场景ID'),
  status: TaskStatusSchema.describe('任务状态'),
  progress: z.number().min(0).max(100).default(0).describe('进度百分比'),
  config: VideoGenerationConfigSchema.describe('生成配置'),
  result: GeneratedVideoSchema.optional().describe('生成结果'),
  error: z.string().optional().describe('错误信息'),
  createdAt: z.string().datetime().describe('创建时间'),
  updatedAt: z.string().datetime().describe('更新时间')
})
export type VideoTask = z.infer<typeof VideoTaskSchema>

// ==================== API 请求/响应 ====================

/** 视频生成请求 */
export const GenerateVideoRequestSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  config: VideoGenerationConfigSchema.describe('生成配置')
})
export type GenerateVideoRequest = z.infer<typeof GenerateVideoRequestSchema>

/** 视频生成响应 */
export const GenerateVideoResponseSchema = z.object({
  success: z.boolean(),
  taskId: z.string().optional().describe('任务ID'),
  error: z.string().optional()
})
export type GenerateVideoResponse = z.infer<typeof GenerateVideoResponseSchema>

// ==================== 场景串联 ====================

/** 转场类型 */
export const TransitionTypeSchema = z.enum([
  'fade', // 淡入淡出
  'dissolve', // 溶解
  'cut', // 直切
  'wipe' // 擦除
])
export type TransitionType = z.infer<typeof TransitionTypeSchema>

/** 场景转场配置 */
export const SceneTransitionSchema = z.object({
  fromSceneId: z.string().describe('起始场景ID'),
  toSceneId: z.string().describe('目标场景ID'),
  type: TransitionTypeSchema.default('dissolve').describe('转场类型'),
  duration: DurationSchema.default(4).describe('转场视频时长')
})
export type SceneTransition = z.infer<typeof SceneTransitionSchema>

/** 场景帧数据 */
export const SceneFrameDataSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  firstFrame: z.string().describe('首帧 base64'),
  lastFrame: z.string().describe('尾帧 base64'),
  mimeType: z.string().default('image/png')
})
export type SceneFrameData = z.infer<typeof SceneFrameDataSchema>

/** 串联的场景链 */
export const SceneChainSchema = z.object({
  id: z.string().describe('场景链ID'),
  sceneIds: z.array(z.string()).describe('场景ID列表(按顺序)'),
  transitions: z.array(z.object({
    fromSceneId: z.string(),
    toSceneId: z.string(),
    taskId: z.string().describe('转场视频任务ID'),
    status: TaskStatusSchema
  })).describe('转场任务列表'),
  createdAt: z.string().datetime()
})
export type SceneChain = z.infer<typeof SceneChainSchema>

/** 场景串联请求 */
export const ChainScenesRequestSchema = z.object({
  sceneFrames: z.array(SceneFrameDataSchema).min(2).describe('场景帧数据列表(按顺序)'),
  transitionType: TransitionTypeSchema.optional().default('dissolve'),
  transitionDuration: DurationSchema.optional().default(4),
  style: z.string().describe('画风 (必填，由项目配置决定)')
})
export type ChainScenesRequest = z.infer<typeof ChainScenesRequestSchema>
