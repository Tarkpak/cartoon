import { z } from 'zod'

// ==================== 视频配置 ====================

/** 视频分辨率 */
export const ResolutionSchema = z.enum(['720p', '1080p'])
export type Resolution = z.infer<typeof ResolutionSchema>

/** 视频宽高比 */
export const AspectRatioSchema = z.enum(['16:9', '9:16', '1:1'])
export type AspectRatio = z.infer<typeof AspectRatioSchema>

/** 视频时长 (秒) */
export const DurationSchema = z.union([z.literal(4), z.literal(6), z.literal(8)])
export type Duration = z.infer<typeof DurationSchema>

/** 视频生成配置 */
export const VideoGenerationConfigSchema = z.object({
  firstFrame: z.string().describe('首帧图片 (base64)'),
  lastFrame: z.string().describe('尾帧图片 (base64)'),
  prompt: z.string().describe('视频描述提示词'),
  duration: DurationSchema.default(8).describe('视频时长'),
  resolution: ResolutionSchema.default('1080p').describe('分辨率'),
  aspectRatio: AspectRatioSchema.default('16:9').describe('宽高比'),
  withAudio: z.boolean().default(true).describe('是否生成音频'),
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
  fileSize: z.number().optional().describe('文件大小(字节)'),
})
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>

/** 生成的视频 */
export const GeneratedVideoSchema = z.object({
  id: z.string().describe('视频ID'),
  sceneId: z.string().optional().describe('关联场景ID'),
  videoData: z.string().describe('视频数据 (base64)'),
  audioData: z.string().optional().describe('音频数据 (base64)'),
  metadata: VideoMetadataSchema.describe('视频元数据'),
  createdAt: z.string().datetime().describe('创建时间'),
})
export type GeneratedVideo = z.infer<typeof GeneratedVideoSchema>

// ==================== 生成任务 ====================

/** 任务状态 */
export const TaskStatusSchema = z.enum([
  'pending',     // 等待中
  'processing',  // 处理中
  'completed',   // 已完成
  'failed',      // 失败
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
  updatedAt: z.string().datetime().describe('更新时间'),
})
export type VideoTask = z.infer<typeof VideoTaskSchema>

// ==================== API 请求/响应 ====================

/** 视频生成请求 */
export const GenerateVideoRequestSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  config: VideoGenerationConfigSchema.describe('生成配置'),
})
export type GenerateVideoRequest = z.infer<typeof GenerateVideoRequestSchema>

/** 视频生成响应 */
export const GenerateVideoResponseSchema = z.object({
  success: z.boolean(),
  taskId: z.string().optional().describe('任务ID'),
  error: z.string().optional(),
})
export type GenerateVideoResponse = z.infer<typeof GenerateVideoResponseSchema>
