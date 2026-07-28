import { z } from 'zod'
import { EmotionSchema } from './script'

const nullToUndefined = (value: unknown) => (value === null ? undefined : value)

// ==================== 角色资产 ====================

/** 角色资产分类 */
export const CHARACTER_ROLE_CATEGORIES = [
  '主角',
  '反派',
  '配角',
  '龙套'
] as const
export type CharacterRoleCategory = (typeof CHARACTER_ROLE_CATEGORIES)[number]

/** 模型或用户填写的角色定位，允许自然语言描述。 */
export const CharacterRoleSchema = z.string().trim().min(1)
export type CharacterRole = z.infer<typeof CharacterRoleSchema>

const CHARACTER_ROLE_ALIAS_MAP: Record<string, CharacterRoleCategory> = {
  protagonist: '主角',
  lead: '主角',
  hero: '主角',
  main: '主角',
  maincharacter: '主角',
  malelead: '主角',
  femalelead: '主角',
  主角: '主角',
  男主: '主角',
  女主: '主角',
  男一: '主角',
  女一: '主角',
  一番: '主角',
  antagonist: '反派',
  villain: '反派',
  反派: '反派',
  反角: '反派',
  男反: '反派',
  女反: '反派',
  supporting: '配角',
  support: '配角',
  supportingrole: '配角',
  supportingcharacter: '配角',
  配角: '配角',
  次要角色: '配角',
  extra: '龙套',
  crowd: '龙套',
  background: '龙套',
  群演: '龙套',
  龙套: '龙套',
  路人: '龙套'
}

function normalizeCharacterRoleAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

export function normalizeCharacterRole(value: unknown): CharacterRoleCategory | undefined {
  if (typeof value !== 'string') return undefined
  const key = normalizeCharacterRoleAliasKey(value)
  if (!key) return undefined
  return CHARACTER_ROLE_ALIAS_MAP[key]
}

export function normalizeCharacterRoleText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  return normalizeCharacterRole(text) || text
}

export type CharacterGenderCategory = '男' | '女' | '其他'
export type CharacterGender = string

const CHARACTER_GENDER_ALIAS_MAP: Record<string, CharacterGenderCategory> = {
  male: '男',
  man: '男',
  boy: '男',
  masculine: '男',
  男: '男',
  男性: '男',
  男生: '男',
  男人: '男',
  少年: '男',
  男孩: '男',
  男主: '男',
  女: '女',
  female: '女',
  woman: '女',
  girl: '女',
  feminine: '女',
  女性: '女',
  女生: '女',
  女人: '女',
  少女: '女',
  女孩: '女',
  女主: '女',
  other: '其他',
  nonbinary: '其他',
  nonbinaryperson: '其他',
  unspecified: '其他',
  其他: '其他',
  非二元: '其他',
  未指定: '其他'
}

export function normalizeCharacterGender(value: unknown): CharacterGenderCategory | undefined {
  if (typeof value !== 'string') return undefined
  const rawValue = value.trim()
  const key = normalizeCharacterRoleAliasKey(value)
  if (!key) return undefined
  const mapped = CHARACTER_GENDER_ALIAS_MAP[key]
  if (mapped) return mapped
  if (/非二元|中性|其他/u.test(rawValue) || /nonbinary|nonbinaryperson|neutral/u.test(key)) return '其他'
  if (/女性|女人|女生|女孩|少女|女主|女/u.test(rawValue) || /female|woman|girl|feminine/u.test(key)) return '女'
  if (/男性|男人|男生|男孩|少年|男主|男/u.test(rawValue) || /male|man|boy|masculine/u.test(key)) return '男'
  return undefined
}

export function normalizeCharacterGenderText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text) return undefined
  return CHARACTER_GENDER_ALIAS_MAP[normalizeCharacterRoleAliasKey(text)] || text
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

/** 说话风格，允许自然语言描述。 */
export const SpeakingStyleSchema = z.string().trim().min(1)
export type SpeakingStyle = z.infer<typeof SpeakingStyleSchema>

/** 角色声音资产 */
export const CharacterVoiceAssetSchema = z.object({
  audioUrl: z.string().describe('角色声音样本音频 URL'),
  libraryAssetId: z.preprocess(nullToUndefined, z.string().optional()).describe('资源库素材 ID'),
  libraryAssetVersion: z.preprocess(nullToUndefined, z.number().int().positive().optional()).describe('使用的资源版本'),
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
    value => normalizeCharacterRoleText(value),
    CharacterRoleSchema.optional()
  ).describe('角色类型'),
  // 外观相关
  appearance: z.string().describe('外观描述'),
  age: z.preprocess(nullToUndefined, z.number().optional()).describe('年龄'),
  gender: z.preprocess(
    value => normalizeCharacterGenderText(value) ?? nullToUndefined(value),
    z.string().trim().min(1).optional()
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
  role?: string
  avatar?: string
  expressions?: Array<{
    emotion: string
    imageData?: string
    mimeType?: string
  }>
  generating?: boolean
}
