import { z } from 'zod'

// ==================== 场景画面类型 (基于飞书文档 2.5) ====================

/** 场景视觉元素 */
export const SceneVisualSchema = z.object({
  sceneId: z.string().describe('场景ID'),
  time: z.string().describe('时间描述 (如: 深冬傍晚、明末夜晚)'),
  location: z.string().describe('地点描述'),
  visualElements: z.array(z.string()).or(z.array(z.object({ element: z.string(), detail: z.string().optional() }))).describe('视觉元素列表'),
  atmosphere: z.string().describe('氛围描述'),
  sensoryDetails: z.string().nullable().optional().describe('感官细节 (增强代入感)'),
  imagePrompt: z.string().describe('生成的文生图提示词')
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
  style: z.string().optional().default('日式动漫').describe('画风')
})
export type ExtractSceneVisualRequest = z.infer<typeof ExtractSceneVisualRequestSchema>

/** 多场景画面提取结果 */
export const SceneVisualsSchema = z.object({
  scenes: z.array(SceneVisualSchema).describe('场景画面列表')
})
export type SceneVisuals = z.infer<typeof SceneVisualsSchema>
