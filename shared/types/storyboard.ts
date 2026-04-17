import { z } from 'zod'

// ==================== 分镜脚本类型 ====================

/** 景别类型 */
export const ShotTypeSchema = z.enum([
  'extreme_wide', // 大远景
  'wide', // 全景
  'medium_wide', // 中全景
  'medium', // 中景
  'medium_close', // 中近景
  'close', // 近景
  'extreme_close', // 特写
  'detail' // 细节特写
])
export type ShotType = z.infer<typeof ShotTypeSchema>

/** 运镜方式 */
export const CameraMovementSchema = z.enum([
  'static', // 定镜
  'push', // 推镜头
  'pull', // 拉镜头
  'pan_left', // 左摇
  'pan_right', // 右摇
  'tilt_up', // 上摇
  'tilt_down', // 下摇
  'track', // 跟镜头
  'dolly', // 移镜头
  'zoom_in', // 变焦推进
  'zoom_out', // 变焦拉远
  'crane', // 升降镜头
  'handheld', // 手持晃动
  'arc' // 环绕镜头
])
export type CameraMovement = z.infer<typeof CameraMovementSchema>

/** 单个分镜 */
export const StoryboardShotSchema = z.object({
  shotNumber: z.number().describe('镜号'),
  shotType: ShotTypeSchema.describe('景别'),
  cameraMovement: CameraMovementSchema.describe('运镜方式'),
  visualContent: z.string().describe('画面内容描述'),
  dialogue: z.string().nullable().optional().describe('台词/旁白'),
  character: z.string().nullable().optional().describe('说话角色'),
  emotion: z.string().nullable().optional().describe('情绪'), // 使用 string 而不是 EmotionSchema，因为 AI 可能生成非标准情绪值
  duration: z.number().min(1).max(10).describe('时长(秒)'),
  notes: z.string().nullable().optional().describe('备注')
})
export type StoryboardShot = z.infer<typeof StoryboardShotSchema>

/** 分镜脚本 */
export const StoryboardSchema = z.object({
  sceneId: z.string().describe('关联场景ID'),
  sceneTitle: z.string().optional().describe('场景标题'),
  shots: z.array(StoryboardShotSchema).describe('分镜列表'),
  totalDuration: z.number().describe('总时长(秒)')
})
export type Storyboard = z.infer<typeof StoryboardSchema>

/** 分镜脚本生成请求 */
export const GenerateStoryboardRequestSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  sceneDescription: z.string().describe('场景描述'),
  dialogues: z.array(z.object({
    character: z.string(),
    text: z.string(),
    emotion: z.string().optional() // 使用 string 而不是 EmotionSchema，因为场景数据可能包含非标准情绪值
  })).optional().describe('对话列表'),
  narration: z.string().nullish().describe('场景旁白'),
  style: z.string().describe('画风 (必填，由项目配置决定)')
})
export type GenerateStoryboardRequest = z.infer<typeof GenerateStoryboardRequestSchema>
