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
export const TIME_OF_DAY_VALUES = [
  '黎明',
  '早晨',
  '白天',
  '中午',
  '下午',
  '傍晚',
  '夜晚'
] as const
export type TimeOfDay = (typeof TIME_OF_DAY_VALUES)[number]

export const DEFAULT_TIME_OF_DAY: TimeOfDay = '白天'

export const TIME_OF_DAY_OPTIONS = TIME_OF_DAY_VALUES.map(value => ({
  value,
  label: value
})) satisfies ReadonlyArray<{ value: TimeOfDay, label: string }>

const TIME_OF_DAY_SET = new Set<string>(TIME_OF_DAY_VALUES)

const TIME_OF_DAY_ALIAS_MAP: Record<string, TimeOfDay> = {
  dawn: '黎明',
  sunrise: '黎明',
  morning: '早晨',
  am: '早晨',
  forenoon: '早晨',
  day: '白天',
  daytime: '白天',
  noon: '中午',
  midday: '中午',
  afternoon: '下午',
  pm: '下午',
  evening: '傍晚',
  sunset: '傍晚',
  dusk: '傍晚',
  night: '夜晚',
  midnight: '夜晚'
}

export function normalizeOptionalTimeOfDayValue(raw: unknown): TimeOfDay | undefined {
  if (typeof raw !== 'string') return undefined

  const value = raw.trim()
  if (!value) return undefined
  if (TIME_OF_DAY_SET.has(value)) return value as TimeOfDay

  const normalized = value.toLowerCase()
  if (TIME_OF_DAY_ALIAS_MAP[normalized]) {
    return TIME_OF_DAY_ALIAS_MAP[normalized]
  }

  if (/none|null|unknown|n\/a|na|unspecified|未指定|未知|无/u.test(normalized)) return undefined
  if (/拂晓|黎明|凌晨/u.test(value)) return '黎明'
  if (/清晨|早晨|早上|上午/u.test(value)) return '早晨'
  if (/白天|日间/u.test(value)) return '白天'
  if (/中午|正午/u.test(value)) return '中午'
  if (/下午|午后/u.test(value)) return '下午'
  if (/傍晚|黄昏|日落/u.test(value)) return '傍晚'
  if (/夜晚|夜里|晚上|深夜|午夜/u.test(value)) return '夜晚'

  return undefined
}

export function normalizeTimeOfDayValue(
  raw: unknown,
  fallback: TimeOfDay = DEFAULT_TIME_OF_DAY
): TimeOfDay {
  return normalizeOptionalTimeOfDayValue(raw) || fallback
}

export function resolveTimeOfDayText(raw: unknown, fallback = ''): string {
  const normalized = normalizeOptionalTimeOfDayValue(raw)
  if (normalized) return normalized
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return fallback
}

export const TimeOfDaySchema = z.preprocess(
  value => normalizeOptionalTimeOfDayValue(value) ?? value,
  z.enum(TIME_OF_DAY_VALUES)
)

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

/** 场景景别 */
export const SceneShotTypeSchema = z.enum([
  'extreme_wide',
  'wide',
  'medium_wide',
  'medium',
  'medium_close',
  'close',
  'extreme_close',
  'detail'
]).describe('景别')
export type SceneShotType = z.infer<typeof SceneShotTypeSchema>

/** 场景运镜 */
export const SceneCameraMovementSchema = z.enum([
  'static',
  'push',
  'pull',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'track',
  'dolly',
  'zoom_in',
  'zoom_out',
  'crane',
  'handheld',
  'arc'
]).describe('运镜方式')
export type SceneCameraMovement = z.infer<typeof SceneCameraMovementSchema>

/** 场景时长（秒） */
export const SceneDurationSchema = z.coerce.number().min(2).max(15).default(8).describe('视频时长(秒，2-15)')
export type SceneDuration = z.infer<typeof SceneDurationSchema>

/** 场景定义 */
export const SceneSchema = z.object({
  id: z.string().describe('场景ID'),
  title: z.string().optional().describe('场景标题'),
  shotType: SceneShotTypeSchema.optional(),
  cameraMovement: SceneCameraMovementSchema.optional(),
  description: z.string().describe('场景描述'),
  setting: SceneSettingSchema.describe('场景设定'),
  characters: z.array(SceneCharacterSchema).describe('登场角色'),
  dialogues: z.array(DialogueSchema).optional().describe('对话列表'),
  duration: SceneDurationSchema,
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

export const SCRIPT_PARSE_MODES = ['short_drama', 'premium_drama'] as const
export type ScriptParseMode = (typeof SCRIPT_PARSE_MODES)[number]

export const DEFAULT_SCRIPT_PARSE_MODE: ScriptParseMode = 'short_drama'

export const SCRIPT_PARSE_MODE_LABELS: Record<ScriptParseMode, string> = {
  premium_drama: '精品剧',
  short_drama: '短剧'
}

export const SCRIPT_PARSE_MODE_LABELS_EN: Record<ScriptParseMode, string> = {
  premium_drama: 'Premium Drama',
  short_drama: 'Short Drama'
}

export function normalizeScriptParseMode(raw: unknown): ScriptParseMode {
  if (raw === 'short_drama' || raw === 'premium_drama') {
    return raw
  }
  return DEFAULT_SCRIPT_PARSE_MODE
}

export function resolveScriptParseModeLabel(
  mode: ScriptParseMode,
  lang: 'zh' | 'en' = 'zh'
): string {
  if (lang === 'en') return SCRIPT_PARSE_MODE_LABELS_EN[mode]
  return SCRIPT_PARSE_MODE_LABELS[mode]
}

/** 剧本解析请求 */
export const ParseScriptRequestSchema = z.object({
  text: z.string().min(10).describe('原始小说文本'),
  maxScenes: z.number().int().min(1).optional().describe('场景数量提示（可选，不做硬上限限制）'),
  scriptParseMode: z.enum(SCRIPT_PARSE_MODES).optional().default(DEFAULT_SCRIPT_PARSE_MODE).describe('解析模式'),
  style: z.string().optional().describe('画风描述（可选）'),
  workflowType: z.literal('asset_consistency').optional().default('asset_consistency').describe('工作流类型')
})
export type ParseScriptRequest = z.infer<typeof ParseScriptRequestSchema>
