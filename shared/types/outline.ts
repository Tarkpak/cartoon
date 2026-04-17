import { z } from 'zod'

// ==================== 故事大纲类型 ====================

/** 故事类型/风格 */
export const StoryGenreSchema = z.enum([
  'romance', // 言情
  'fantasy', // 奇幻
  'action', // 动作
  'comedy', // 喜剧
  'drama', // 剧情
  'horror', // 恐怖
  'mystery', // 悬疑
  'scifi', // 科幻
  'slice_of_life' // 日常
])
export type StoryGenre = z.infer<typeof StoryGenreSchema>

/** 故事节奏 */
export const StoryPaceSchema = z.enum([
  'slow', // 慢节奏，注重氛围
  'medium', // 中等节奏
  'fast' // 快节奏，紧张刺激
])
export type StoryPace = z.infer<typeof StoryPaceSchema>

/** 三幕结构 - 幕 */
export const ActSchema = z.object({
  id: z.string().describe('幕ID'),
  name: z.string().describe('幕名称'),
  type: z.enum(['setup', 'confrontation', 'resolution']).describe('幕类型：铺垫/对抗/解决'),
  summary: z.string().describe('本幕概要'),
  keyEvents: z.array(z.string()).describe('关键事件列表'),
  emotionalArc: z.string().optional().describe('情感走向'),
  estimatedDuration: z.number().optional().describe('预估时长(秒)')
})
export type Act = z.infer<typeof ActSchema>

/** 故事大纲 */
export const StoryOutlineSchema = z.object({
  id: z.string().describe('大纲ID'),
  title: z.string().describe('故事标题'),
  logline: z.string().describe('一句话概括（Logline）'),
  synopsis: z.string().describe('故事梗概（200-500字）'),
  genre: StoryGenreSchema.describe('故事类型'),
  pace: StoryPaceSchema.default('medium').describe('故事节奏'),
  theme: z.string().optional().describe('主题/核心思想'),
  setting: z.object({
    world: z.string().describe('世界观设定'),
    era: z.string().optional().describe('时代背景'),
    mainLocations: z.array(z.string()).describe('主要场景地点')
  }).describe('背景设定'),
  acts: z.array(ActSchema).describe('三幕结构'),
  targetAudience: z.string().optional().describe('目标受众'),
  estimatedEpisodes: z.number().optional().describe('预估集数'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
})
export type StoryOutline = z.infer<typeof StoryOutlineSchema>

/** 大纲生成请求 */
export const GenerateOutlineRequestSchema = z.object({
  rawText: z.string().min(50).describe('原始故事文本或创意'),
  genre: StoryGenreSchema.optional().describe('指定类型'),
  targetLength: z.enum(['short', 'medium', 'long']).optional().default('medium').describe('目标长度')
})
export type GenerateOutlineRequest = z.infer<typeof GenerateOutlineRequestSchema>

/** 大纲生成响应 */
export const GenerateOutlineResponseSchema = z.object({
  success: z.boolean(),
  outline: StoryOutlineSchema.optional(),
  error: z.string().optional()
})
export type GenerateOutlineResponse = z.infer<typeof GenerateOutlineResponseSchema>

// ==================== 角色关系类型 ====================

/** 角色关系类型 */
export const RelationshipTypeSchema = z.enum([
  'lover', // 恋人
  'friend', // 朋友
  'enemy', // 敌人
  'family', // 家人
  'mentor', // 师徒
  'rival', // 对手
  'colleague', // 同事
  'stranger' // 陌生人
])
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>

/** 角色关系 */
export const CharacterRelationshipSchema = z.object({
  fromCharacterId: z.string().describe('角色A的ID'),
  toCharacterId: z.string().describe('角色B的ID'),
  type: RelationshipTypeSchema.describe('关系类型'),
  description: z.string().optional().describe('关系描述'),
  intensity: z.number().min(1).max(5).default(3).describe('关系强度 1-5')
})
export type CharacterRelationship = z.infer<typeof CharacterRelationshipSchema>
