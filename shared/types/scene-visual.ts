import { z } from 'zod'

// ==================== 场景画面类型 (基于飞书文档 2.5) ====================

/** 感官细节 Schema - 支持字符串或对象格式 */
const SensoryDetailsSchema = z.union([
  z.string(),
  z.object({
    visual: z.string().optional().describe('视觉细节'),
    auditory: z.string().optional().describe('听觉暗示'),
    tactile: z.string().optional().describe('触觉暗示'),
    olfactory: z.string().optional().describe('嗅觉暗示')
  })
]).nullable().optional()

/** 场景视觉元素 */
export const SceneVisualSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  time: z.string().optional().describe('时间描述 (如: 深冬傍晚、明末夜晚)'),
  location: z.string().optional().describe('地点描述'),
  visualElements: z.array(z.string()).or(z.array(z.object({
    element: z.string(),
    description: z.string().optional(),
    detail: z.string().optional(),
    importance: z.string().optional()
  }))).optional().describe('视觉元素列表'),
  atmosphere: z.string().optional().describe('氛围描述'),
  sensoryDetails: SensoryDetailsSchema.describe('感官细节 (增强代入感)'),
  imagePrompt: z.string().optional().describe('生成的文生图提示词')
})
export type SceneVisual = z.infer<typeof SceneVisualSchema>

/** 场景画面提取请求 */
export const ExtractSceneVisualRequestSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  sceneDescription: z.string().describe('场景描述'),
  setting: z.object({
    location: z.string(),
    timeOfDay: z.string(),
    mood: z.string().optional(),
    weather: z.string().optional()
  }).describe('场景设定'),
  style: z.string().describe('画风 (必填，由项目配置决定)')
})
export type ExtractSceneVisualRequest = z.infer<typeof ExtractSceneVisualRequestSchema>

/** 多场景画面提取结果 */
export const SceneVisualsSchema = z.object({
  scenes: z.array(SceneVisualSchema).describe('场景画面列表')
})
export type SceneVisuals = z.infer<typeof SceneVisualsSchema>
