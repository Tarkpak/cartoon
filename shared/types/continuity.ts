import { z } from 'zod'

/**
 * 场景连续性类型定义
 * 用于保持场景间的视觉和叙事连贯性
 */

// ==================== 场景上下文 ====================

/** 场景摘要 - 用于传递给相邻场景 */
export const SceneSummarySchema = z.object({
  sceneId: z.string().describe('场景ID'),
  title: z.string().optional().describe('场景标题'),
  description: z.string().describe('场景描述'),
  setting: z.object({
    location: z.string(),
    timeOfDay: z.string(),
    mood: z.string().optional(),
    weather: z.string().optional()
  }).optional().describe('场景设定'),
  // 角色状态
  characters: z.array(z.object({
    name: z.string(),
    appearance: z.string().optional(),
    emotion: z.string().optional(),
    action: z.string().optional(),
    position: z.string().optional().describe('角色在画面中的位置')
  })).describe('场景中的角色及其状态'),
  // 视觉锚点
  visualAnchors: z.object({
    dominantColors: z.array(z.string()).optional().describe('主色调'),
    lightingDirection: z.string().optional().describe('光源方向'),
    cameraAngle: z.string().optional().describe('镜头角度'),
    keyObjects: z.array(z.string()).optional().describe('关键物体')
  }).optional().describe('视觉锚点信息'),
  // 叙事状态
  narrativeState: z.object({
    emotionalTone: z.string().optional().describe('情感基调'),
    tension: z.enum(['low', 'medium', 'high']).optional().describe('紧张程度'),
    plotPoint: z.string().optional().describe('剧情要点')
  }).optional().describe('叙事状态')
})
export type SceneSummary = z.infer<typeof SceneSummarySchema>

/** 场景连续性上下文 - 传递给首帧生成 */
export const SceneContinuityContextSchema = z.object({
  // 上一场景信息
  previousScene: SceneSummarySchema.optional().describe('上一场景摘要'),
  previousSceneLastFrame: z.string().optional().describe('上一场景尾帧 base64'),
  // 下一场景信息 (可选，用于预判)
  nextScene: SceneSummarySchema.optional().describe('下一场景摘要'),
  // 全局角色信息
  globalCharacterDescriptions: z.record(z.string(), z.object({
    appearance: z.string().describe('角色外观描述'),
    baseImageHash: z.string().optional().describe('角色立绘哈希，用于一致性校验')
  })).optional().describe('全局角色描述映射'),
  // 场景在故事中的位置
  sceneIndex: z.number().describe('当前场景索引'),
  totalScenes: z.number().describe('总场景数'),
  // 故事全局信息
  storyContext: z.object({
    title: z.string().optional(),
    genre: z.string().optional(),
    overallMood: z.string().optional(),
    style: z.string().describe('画风')
  }).optional().describe('故事全局上下文')
})
export type SceneContinuityContext = z.infer<typeof SceneContinuityContextSchema>

// ==================== 角色一致性 ====================

/** 角色视觉锚点 - 用于强制角色一致性 */
export const CharacterVisualAnchorSchema = z.object({
  name: z.string().describe('角色名'),
  // 核心视觉特征 (必须保持一致)
  coreFeatures: z.object({
    hairStyle: z.string().optional().describe('发型'),
    hairColor: z.string().optional().describe('发色'),
    eyeColor: z.string().optional().describe('眼睛颜色'),
    skinTone: z.string().optional().describe('肤色'),
    facialFeatures: z.string().optional().describe('面部特征'),
    bodyType: z.string().optional().describe('体型'),
    height: z.string().optional().describe('身高描述')
  }).describe('核心视觉特征'),
  // 服装信息
  outfit: z.object({
    description: z.string().describe('服装描述'),
    colors: z.array(z.string()).optional().describe('服装颜色'),
    accessories: z.array(z.string()).optional().describe('配饰')
  }).optional().describe('当前服装'),
  // 参考图
  referenceImage: z.string().optional().describe('角色立绘 base64'),
  // 一致性权重
  consistencyWeight: z.number().min(0).max(1).default(0.9).describe('一致性权重，越高越严格')
})
export type CharacterVisualAnchor = z.infer<typeof CharacterVisualAnchorSchema>

// ==================== 增强的首帧生成请求 ====================

/** 增强的首帧生成请求 - 包含连续性上下文 */
export const EnhancedFrameGenerationRequestSchema = z.object({
  // 基础场景信息
  scene: z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string(),
    setting: z.object({
      location: z.string(),
      timeOfDay: z.string(),
      mood: z.string().optional(),
      weather: z.string().optional()
    }).optional(),
    characters: z.array(z.object({
      name: z.string(),
      appearance: z.string().optional(),
      action: z.string().optional(),
      emotion: z.string().optional()
    })),
    dialogues: z.array(z.object({
      character: z.string(),
      text: z.string(),
      emotion: z.string().optional()
    })).optional(),
    duration: z.number().optional()
  }).describe('场景信息'),

  // 画风
  style: z.string().describe('画风'),

  // 角色资产
  characterAssets: z.record(z.string(), z.string()).optional().describe('角色立绘 (name -> base64)'),

  // 角色视觉锚点 (新增 - 用于强制一致性)
  characterAnchors: z.array(CharacterVisualAnchorSchema).optional().describe('角色视觉锚点'),

  // 连续性上下文 (新增)
  continuityContext: SceneContinuityContextSchema.optional().describe('场景连续性上下文'),

  // 融合模式
  fusionMode: z.enum(['character_scene', 'reference', 'text_only', 'continuity']).optional().default('continuity').describe('融合模式'),

  // 强制连续性选项
  enforceCharacterConsistency: z.boolean().default(true).describe('是否强制角色一致性'),
  enforcePreviousFrameConnection: z.boolean().default(true).describe('是否强制与上一场景尾帧连接')
})
export type EnhancedFrameGenerationRequest = z.infer<typeof EnhancedFrameGenerationRequestSchema>

// ==================== 辅助函数类型 ====================

/** 从场景数据生成摘要 */
export interface SceneToSummaryInput {
  id: string
  title?: string
  description: string
  setting?: {
    location: string
    timeOfDay: string
    mood?: string
    weather?: string
  }
  characters: Array<{
    name: string
    appearance?: string
    emotion?: string
    action?: string
  }>
  dialogues?: Array<{
    character: string
    text: string
    emotion?: string
  }>
  lastFrame?: string
}

/** 连续性检查结果 */
export interface ContinuityCheckResult {
  isConsistent: boolean
  issues: Array<{
    type: 'character_appearance' | 'lighting' | 'setting' | 'timeline'
    severity: 'warning' | 'error'
    message: string
    suggestion?: string
  }>
}
