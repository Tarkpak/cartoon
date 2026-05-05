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

const CHARACTER_ROLE_ALIAS_MAP: Record<string, CharacterRole> = {
  protagonist: 'protagonist',
  lead: 'protagonist',
  hero: 'protagonist',
  main: 'protagonist',
  maincharacter: 'protagonist',
  malelead: 'protagonist',
  femalelead: 'protagonist',
  主角: 'protagonist',
  男主: 'protagonist',
  女主: 'protagonist',
  男一: 'protagonist',
  女一: 'protagonist',
  一番: 'protagonist',
  antagonist: 'antagonist',
  villain: 'antagonist',
  反派: 'antagonist',
  反角: 'antagonist',
  男反: 'antagonist',
  女反: 'antagonist',
  supporting: 'supporting',
  support: 'supporting',
  supportingrole: 'supporting',
  supportingcharacter: 'supporting',
  配角: 'supporting',
  次要角色: 'supporting',
  extra: 'extra',
  crowd: 'extra',
  background: 'extra',
  群演: 'extra',
  龙套: 'extra',
  路人: 'extra'
}

function normalizeCharacterRoleAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function normalizeCharacterRole(value: unknown): CharacterRole | undefined {
  if (typeof value !== 'string') return undefined
  const key = normalizeCharacterRoleAliasKey(value)
  if (!key) return undefined
  return CHARACTER_ROLE_ALIAS_MAP[key]
}

export type CharacterGender = 'male' | 'female' | 'other'

const CHARACTER_GENDER_ALIAS_MAP: Record<string, CharacterGender> = {
  male: 'male',
  man: 'male',
  boy: 'male',
  masculine: 'male',
  男: 'male',
  男性: 'male',
  男生: 'male',
  男人: 'male',
  少年: 'male',
  男孩: 'male',
  男主: 'male',
  女: 'female',
  female: 'female',
  woman: 'female',
  girl: 'female',
  feminine: 'female',
  女性: 'female',
  女生: 'female',
  女人: 'female',
  少女: 'female',
  女孩: 'female',
  女主: 'female',
  other: 'other',
  nonbinary: 'other',
  nonbinaryperson: 'other',
  unspecified: 'other',
  其他: 'other',
  非二元: 'other',
  未指定: 'other'
}

export function normalizeCharacterGender(value: unknown): CharacterGender | undefined {
  if (typeof value !== 'string') return undefined
  const rawValue = value.trim()
  const key = normalizeCharacterRoleAliasKey(value)
  if (!key) return undefined
  const mapped = CHARACTER_GENDER_ALIAS_MAP[key]
  if (mapped) return mapped
  if (/非二元|中性|其他/u.test(rawValue) || /nonbinary|nonbinaryperson|neutral/u.test(key)) return 'other'
  if (/女性|女人|女生|女孩|少女|女主|女/u.test(rawValue) || /female|woman|girl|feminine/u.test(key)) return 'female'
  if (/男性|男人|男生|男孩|少年|男主|男/u.test(rawValue) || /male|man|boy|masculine/u.test(key)) return 'male'
  return undefined
}

/** 角色视角 (基于飞书文档 2.7.2 角色库) */
export const CharacterViewSchema = z.enum([
  'front', // 正面
  'three_quarter', // 四分之三侧面
  'side', // 侧面
  'back', // 背面
  'top_down', // 俯视
  'bottom_up' // 仰视
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
  'formal', // 正式
  'casual', // 随意
  'polite', // 礼貌
  'rude', // 粗鲁
  'childish', // 孩子气
  'mature', // 成熟
  'humorous', // 幽默
  'serious', // 严肃
  'mysterious', // 神秘
  'energetic' // 活泼
])
export type SpeakingStyle = z.infer<typeof SpeakingStyleSchema>

/** 角色声音资产 */
export const CharacterVoiceAssetSchema = z.object({
  audioUrl: z.string().describe('角色声音样本音频 URL'),
  locked: z.preprocess(nullToUndefined, z.boolean().optional()).describe('是否锁定该音频为参考样本'),
  transcript: z.preprocess(nullToUndefined, z.string().optional()).describe('声音样本文本'),
  sourceSceneId: z.preprocess(nullToUndefined, z.string().optional()).describe('来源场景 ID'),
  sourceTaskId: z.preprocess(nullToUndefined, z.string().optional()).describe('来源视频任务 ID'),
  startTimeMs: z.preprocess(nullToUndefined, z.number().optional()).describe('片段起始时间（毫秒）'),
  endTimeMs: z.preprocess(nullToUndefined, z.number().optional()).describe('片段结束时间（毫秒）'),
  durationMs: z.preprocess(nullToUndefined, z.number().optional()).describe('片段时长（毫秒）'),
  matchScore: z.preprocess(nullToUndefined, z.number().optional()).describe('台词匹配分数'),
  updatedAt: z.string().datetime().describe('声音资产更新时间')
})
export type CharacterVoiceAsset = z.infer<typeof CharacterVoiceAssetSchema>

/** 角色定义 - 增强版 */
export const CharacterSchema = z.object({
  id: z.string().describe('角色ID'),
  name: z.string().describe('角色名'),
  role: z.preprocess(
    value => normalizeCharacterRole(value),
    CharacterRoleSchema.optional()
  ).describe('角色类型'),
  // 外观相关
  appearance: z.string().describe('外观描述'),
  age: z.preprocess(nullToUndefined, z.number().optional()).describe('年龄'),
  gender: z.preprocess(
    value => normalizeCharacterGender(value) ?? nullToUndefined(value),
    z.enum(['male', 'female', 'other']).optional()
  ).describe('性别'),
  // 性格相关 (新增)
  personality: z.preprocess(nullToUndefined, z.string().optional()).describe('性格描述'),
  traits: z.preprocess(nullToUndefined, z.array(z.string()).optional()).describe('性格特点标签'),
  // 背景相关 (新增)
  background: z.preprocess(nullToUndefined, z.string().optional()).describe('角色背景故事'),
  motivation: z.preprocess(nullToUndefined, z.string().optional()).describe('角色动机/目标'),
  // 说话风格 (新增)
  speakingStyle: z.preprocess(nullToUndefined, SpeakingStyleSchema.optional()).describe('说话风格'),
  catchphrase: z.preprocess(nullToUndefined, z.string().optional()).describe('口头禅'),
  voiceTone: z.preprocess(nullToUndefined, z.string().optional()).describe('声音特点描述'),
  voiceAsset: z.preprocess(nullToUndefined, CharacterVoiceAssetSchema.optional()).describe('角色声音资产')
})
export type Character = z.infer<typeof CharacterSchema>

/** 角色设定图类型 */
export const CharacterSheetTypeSchema = z.enum([
  'full', // 完整设定图（三视图+表情）
  'turnaround', // 仅三视图
  'expressions', // 仅表情集
  'legacy' // 旧版单图
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
  workflowType: z.literal('asset_consistency').optional().default('asset_consistency').describe('工作流类型'),
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
