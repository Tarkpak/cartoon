import { z } from 'zod'

// ==================== 基础类型 ====================

/** 常用情绪类型（用于 UI 提示，实际接受任意字符串） */
export const CommonEmotions = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'confused',
  'excited',
  'scared',
  'worried',
  'concerned',
  'determined',
  'thoughtful',
  'nervous',
  'relieved',
  'hopeful',
  'disappointed',
  'anxious',
  'fearful',
  'terrified',
  'calm',
  'shocked',
  'suspicious'
] as const

/** 情绪类型 - 接受任意字符串以兼容 AI 生成的多样化情绪 */
export const EmotionSchema = z.string().describe('情绪')
export type Emotion = string

/** 时间段 */
export const TimeOfDaySchema = z.enum([
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'evening',
  'night'
])
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>

// ==================== 场景相关 ====================

/** 场景设定 */
export const SceneSettingSchema = z.object({
  location: z.string().describe('场景地点'),
  timeOfDay: TimeOfDaySchema.describe('时间段'),
  mood: z.string().optional().describe('氛围描述'),
  weather: z.string().optional().describe('天气')
})
export type SceneSetting = z.infer<typeof SceneSettingSchema>

/** 对话内容 */
export const DialogueSchema = z.object({
  character: z.string().describe('说话角色名'),
  text: z.string().describe('对话内容'),
  emotion: EmotionSchema.optional().describe('情绪'),
  isInnerThought: z.boolean().optional().describe('是否为内心独白')
})
export type Dialogue = z.infer<typeof DialogueSchema>

/** 场景中的角色 */
export const SceneCharacterSchema = z.object({
  name: z.string().describe('角色名'),
  appearance: z.string().optional().describe('外观描述'),
  action: z.string().optional().describe('动作描述'),
  emotion: EmotionSchema.optional().describe('情绪')
})
export type SceneCharacter = z.infer<typeof SceneCharacterSchema>

/** 场景定义 */
export const SceneSchema = z.object({
  id: z.string().describe('场景ID'),
  title: z.string().optional().describe('场景标题'),
  description: z.string().describe('场景描述'),
  setting: SceneSettingSchema.describe('场景设定'),
  characters: z.array(SceneCharacterSchema).describe('登场角色'),
  dialogues: z.array(DialogueSchema).optional().describe('对话列表'),
  duration: z.number().min(4).max(8).default(8).describe('视频时长(秒)'),
  narration: z.string().nullable().optional().describe('旁白')
})
export type Scene = z.infer<typeof SceneSchema>

// ==================== 剧本相关 ====================

/** 剧本解析结果 */
export const ParsedScriptSchema = z.object({
  title: z.string().optional().describe('剧本标题'),
  scenes: z.array(SceneSchema).describe('场景列表'),
  characters: z.array(z.object({
    name: z.string(),
    description: z.string(),
    role: z.enum(['protagonist', 'antagonist', 'supporting']).optional()
  })).describe('角色列表'),
  totalDuration: z.number().describe('总时长(秒)')
})
export type ParsedScript = z.infer<typeof ParsedScriptSchema>

/** 剧本解析请求 */
export const ParseScriptRequestSchema = z.object({
  text: z.string().min(10).describe('原始小说文本'),
  maxScenes: z.number().min(1).max(50).optional().default(10).describe('最大场景数')
})
export type ParseScriptRequest = z.infer<typeof ParseScriptRequestSchema>
