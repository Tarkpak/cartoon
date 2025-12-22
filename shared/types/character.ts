import { z } from 'zod'
import { EmotionSchema } from './script'

// ==================== 角色资产 ====================

/** 角色类型 */
export const CharacterRoleSchema = z.enum([
  'protagonist', // 主角
  'antagonist', // 反派
  'supporting', // 配角
  'extra' // 龙套
])
export type CharacterRole = z.infer<typeof CharacterRoleSchema>

/** 角色视角 (基于飞书文档 2.7.2 角色库) */
export const CharacterViewSchema = z.enum([
  'front',         // 正面
  'three_quarter', // 四分之三侧面
  'side',          // 侧面
  'back',          // 背面
  'top_down',      // 俯视
  'bottom_up'      // 仰视
])
export type CharacterView = z.infer<typeof CharacterViewSchema>

/** 角色服装变体 */
export const CharacterOutfitSchema = z.object({
  id: z.string().describe('服装ID'),
  name: z.string().describe('服装名称'),
  description: z.string().describe('服装描述'),
  imageData: z.string().optional().describe('服装图片 base64')
})
export type CharacterOutfit = z.infer<typeof CharacterOutfitSchema>

/** 角色定义 */
export const CharacterSchema = z.object({
  id: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  role: CharacterRoleSchema.optional().describe('角色类型'),
  appearance: z.string().describe('外观描述'),
  personality: z.string().optional().describe('性格描述'),
  age: z.number().optional().describe('年龄'),
  gender: z.enum(['male', 'female', 'other']).optional().describe('性别')
})
export type Character = z.infer<typeof CharacterSchema>

/** 角色资产 - 包含生成的图片 (基于飞书文档 2.7.2 角色库) */
export const CharacterAssetSchema = z.object({
  characterId: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  baseImage: z.string().describe('基础立绘 (base64)'),
  expressions: z.record(EmotionSchema, z.string()).describe('表情变体 (emotion -> base64)'),
  poses: z.record(z.string(), z.string()).optional().describe('姿态变体 (pose -> base64)'),
  views: z.record(CharacterViewSchema, z.string()).optional().describe('视角变体 (view -> base64)'),
  outfits: z.array(CharacterOutfitSchema).optional().describe('服装变体列表'),
  createdAt: z.string().datetime().describe('创建时间'),
  updatedAt: z.string().datetime().describe('更新时间')
})
export type CharacterAsset = z.infer<typeof CharacterAssetSchema>

// ==================== API 请求/响应 ====================

/** 角色生成请求 */
export const GenerateCharacterRequestSchema = z.object({
  character: CharacterSchema.describe('角色信息'),
  style: z.string().optional().default('日式动漫').describe('画风'),
  generateExpressions: z.boolean().optional().default(true).describe('是否生成表情变体')
})
export type GenerateCharacterRequest = z.infer<typeof GenerateCharacterRequestSchema>

/** 角色生成响应 */
export const GenerateCharacterResponseSchema = z.object({
  success: z.boolean(),
  asset: CharacterAssetSchema.optional(),
  error: z.string().optional()
})
export type GenerateCharacterResponse = z.infer<typeof GenerateCharacterResponseSchema>

// ==================== 前端状态类型 ====================

/** 前端角色状态 - 用于 Composable */
export interface CharacterState {
  id: string
  name: string
  description: string
  role?: 'protagonist' | 'antagonist' | 'supporting'
  avatar?: string
  expressions?: Array<{
    emotion: string
    imageData?: string
    mimeType?: string
  }>
  generating?: boolean
}
