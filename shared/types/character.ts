import { z } from 'zod'
import { EmotionSchema } from './script'

const nullToUndefined = (value: unknown) => (value === null ? undefined : value)

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

/** 说话风格 */
export const SpeakingStyleSchema = z.enum([
  'formal',      // 正式
  'casual',      // 随意
  'polite',      // 礼貌
  'rude',        // 粗鲁
  'childish',    // 孩子气
  'mature',      // 成熟
  'humorous',    // 幽默
  'serious',     // 严肃
  'mysterious',  // 神秘
  'energetic'    // 活泼
])
export type SpeakingStyle = z.infer<typeof SpeakingStyleSchema>

/** 角色定义 - 增强版 */
export const CharacterSchema = z.object({
  id: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  role: z.preprocess(nullToUndefined, CharacterRoleSchema.optional()).describe('角色类型'),
  // 外观相关
  appearance: z.string().describe('外观描述'),
  age: z.preprocess(nullToUndefined, z.number().optional()).describe('年龄'),
  gender: z.preprocess(nullToUndefined, z.enum(['male', 'female', 'other']).optional()).describe('性别'),
  // 性格相关 (新增)
  personality: z.preprocess(nullToUndefined, z.string().optional()).describe('性格描述'),
  traits: z.preprocess(nullToUndefined, z.array(z.string()).optional()).describe('性格特点标签'),
  // 背景相关 (新增)
  background: z.preprocess(nullToUndefined, z.string().optional()).describe('角色背景故事'),
  motivation: z.preprocess(nullToUndefined, z.string().optional()).describe('角色动机/目标'),
  // 说话风格 (新增)
  speakingStyle: z.preprocess(nullToUndefined, SpeakingStyleSchema.optional()).describe('说话风格'),
  catchphrase: z.preprocess(nullToUndefined, z.string().optional()).describe('口头禅'),
  voiceTone: z.preprocess(nullToUndefined, z.string().optional()).describe('声音特点描述')
})
export type Character = z.infer<typeof CharacterSchema>

/** 角色设定图类型 */
export const CharacterSheetTypeSchema = z.enum([
  'full',        // 完整设定图（三视图+表情）
  'turnaround',  // 仅三视图
  'expressions', // 仅表情集
  'legacy'       // 旧版单图
])
export type CharacterSheetType = z.infer<typeof CharacterSheetTypeSchema>

/** 角色资产 - 包含生成的图片 */
export const CharacterAssetSchema = z.object({
  characterId: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  // 角色设定图（一张图包含三视图+表情）
  baseImage: z.string().nullable().optional().describe('角色设定图 (base64 或 URL) - 包含三视图和表情'),
  sheetType: CharacterSheetTypeSchema.optional().default('full').describe('设定图类型'),
  // 以下字段保留用于兼容旧数据，新生成的角色不再使用
  expressions: z.record(EmotionSchema, z.string()).optional().describe('表情变体 (已废弃，表情包含在设定图中)'),
  poses: z.record(z.string(), z.string()).optional().describe('姿态变体 (已废弃)'),
  views: z.record(CharacterViewSchema, z.string()).optional().describe('视角变体 (已废弃，三视图包含在设定图中)'),
  outfits: z.array(CharacterOutfitSchema).optional().describe('服装变体列表'),
  createdAt: z.string().datetime().describe('创建时间'),
  updatedAt: z.string().datetime().describe('更新时间')
})
export type CharacterAsset = z.infer<typeof CharacterAssetSchema>

// ==================== API 请求/响应 ====================

/** 角色生成请求 */
export const GenerateCharacterRequestSchema = z.object({
  character: CharacterSchema.describe('角色信息'),
  style: z.string().describe('画风 (必填，由项目配置决定)'),
  generateExpressions: z.boolean().optional().default(true).describe('是否生成表情变体'),
  workflowType: z.enum(['classic', 'asset_consistency']).optional().default('classic').describe('工作流类型'),
  regeneration: z.preprocess(
    nullToUndefined,
    z.object({
      customPrompt: z.preprocess(nullToUndefined, z.string().optional()).describe('角色二次生成自定义提示词'),
      referenceImage: z.preprocess(nullToUndefined, z.string().optional()).describe('角色二次生成参考图（通常使用已生成角色图）')
    }).optional()
  ).describe('角色二次生成参数')
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
