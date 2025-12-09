import { z } from 'zod'
import { EmotionSchema } from './script'

// ==================== 角色资产 ====================

/** 角色类型 */
export const CharacterRoleSchema = z.enum([
  'protagonist',  // 主角
  'antagonist',   // 反派
  'supporting',   // 配角
  'extra',        // 龙套
])
export type CharacterRole = z.infer<typeof CharacterRoleSchema>

/** 角色定义 */
export const CharacterSchema = z.object({
  id: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  role: CharacterRoleSchema.optional().describe('角色类型'),
  appearance: z.string().describe('外观描述'),
  personality: z.string().optional().describe('性格描述'),
  age: z.number().optional().describe('年龄'),
  gender: z.enum(['male', 'female', 'other']).optional().describe('性别'),
})
export type Character = z.infer<typeof CharacterSchema>

/** 角色资产 - 包含生成的图片 */
export const CharacterAssetSchema = z.object({
  characterId: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  baseImage: z.string().describe('基础立绘 (base64)'),
  expressions: z.record(EmotionSchema, z.string()).describe('表情变体 (emotion -> base64)'),
  poses: z.record(z.string(), z.string()).optional().describe('姿态变体 (pose -> base64)'),
  createdAt: z.string().datetime().describe('创建时间'),
  updatedAt: z.string().datetime().describe('更新时间'),
})
export type CharacterAsset = z.infer<typeof CharacterAssetSchema>

// ==================== API 请求/响应 ====================

/** 角色生成请求 */
export const GenerateCharacterRequestSchema = z.object({
  character: CharacterSchema.describe('角色信息'),
  style: z.string().optional().default('日式动漫').describe('画风'),
  generateExpressions: z.boolean().optional().default(true).describe('是否生成表情变体'),
})
export type GenerateCharacterRequest = z.infer<typeof GenerateCharacterRequestSchema>

/** 角色生成响应 */
export const GenerateCharacterResponseSchema = z.object({
  success: z.boolean(),
  asset: CharacterAssetSchema.optional(),
  error: z.string().optional(),
})
export type GenerateCharacterResponse = z.infer<typeof GenerateCharacterResponseSchema>
