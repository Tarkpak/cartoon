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

/** 时代背景 */
export const SCENE_ERA_VALUES = [
  '古代',
  '民国',
  '现代',
  '近未来',
  '架空'
] as const
export type SceneEra = (typeof SCENE_ERA_VALUES)[number]

const SCENE_ERA_SET = new Set<string>(SCENE_ERA_VALUES)

const SCENE_ERA_ALIAS_MAP: Record<string, SceneEra> = {
  ancient: '古代',
  historical: '古代',
  republican: '民国',
  republic_of_china: '民国',
  modern: '现代',
  contemporary: '现代',
  present_day: '现代',
  near_future: '近未来',
  future: '近未来',
  scifi: '近未来',
  sci_fi: '近未来',
  cyberpunk: '近未来',
  fantasy: '架空',
  alternate: '架空'
}

const SCENE_ERA_SCORING_PATTERNS: Record<
  SceneEra,
  ReadonlyArray<{ pattern: RegExp, score: number }>
> = {
  古代: [
    { pattern: /古代|古装|王朝|朝堂|王爷|皇上|皇后|太子|公主|本宫|朕|寡人|丞相|将军府|衙门|县令|科举|诏书|宗门|修仙|江湖|武林|客栈|驿站|宫殿|王府/u, score: 4 },
    { pattern: /唐朝|宋朝|元朝|明朝|清朝|秦朝|汉朝|魏晋|三国|大唐|大宋/u, score: 5 },
    { pattern: /\b(xiayi?a?|wuxia|xianxia)\b/i, score: 4 }
  ],
  民国: [
    { pattern: /民国|军阀|少帅|旗袍|长衫|黄包车|巡捕房|租界|报馆|上海滩|留声机|姨太太|老洋房|会馆/u, score: 5 },
    { pattern: /19[01-4]\d年|20世纪[一二三四]?十年代/u, score: 4 },
    { pattern: /\brepublic\b/i, score: 4 }
  ],
  现代: [
    { pattern: /现代|当代|都市|写字楼|公司|办公室|医院|手术室|手机|微信|直播|地铁|高铁|电梯|商场|互联网|短视频|咖啡馆/u, score: 3 },
    { pattern: /20[0-2]\d年/u, score: 2 },
    { pattern: /\b(modern|contemporary|present day)\b/i, score: 3 }
  ],
  近未来: [
    { pattern: /近未来|未来|赛博|机甲|星舰|太空|外星|全息|义体|机器人|仿生|时空穿越|末日|废土/u, score: 5 },
    { pattern: /20[3-9]\d年|21\d{2}年/u, score: 4 },
    { pattern: /\b(sci[- ]?fi|cyberpunk|near future|futuristic)\b/i, score: 4 }
  ],
  架空: [
    { pattern: /架空|异世界|玄幻|魔法|魔法学院|精灵|兽人|龙族|神域|神殿/u, score: 4 },
    { pattern: /\b(fantasy|isekai|alternate world)\b/i, score: 4 }
  ]
}

export function normalizeOptionalSceneEraValue(raw: unknown): SceneEra | undefined {
  if (typeof raw !== 'string') return undefined

  const value = raw.trim()
  if (!value) return undefined
  if (SCENE_ERA_SET.has(value)) return value as SceneEra

  const normalized = value.toLowerCase()
  if (SCENE_ERA_ALIAS_MAP[normalized]) {
    return SCENE_ERA_ALIAS_MAP[normalized]
  }

  if (/none|null|unknown|n\/a|na|unspecified|未指定|未知|无/u.test(normalized)) return undefined
  if (/古代|古装|王朝|修仙|武侠|江湖/u.test(value)) return '古代'
  if (/民国|军阀|少帅|旗袍|租界/u.test(value)) return '民国'
  if (/现代|当代|都市|现实|写字楼|医院|公司/u.test(value)) return '现代'
  if (/近未来|未来|赛博|机甲|太空|科幻/u.test(value)) return '近未来'
  if (/架空|异世界|玄幻|魔法|奇幻/u.test(value)) return '架空'

  return undefined
}

export function normalizeSceneEraValue(
  raw: unknown,
  fallback: SceneEra = '现代'
): SceneEra {
  return normalizeOptionalSceneEraValue(raw) || fallback
}

export function inferSceneEraFromText(raw: unknown): SceneEra | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.trim()
  if (!text) return undefined

  const explicit = normalizeOptionalSceneEraValue(text)
  if (explicit) return explicit

  let bestEra: SceneEra | undefined
  let bestScore = 0

  for (const era of SCENE_ERA_VALUES) {
    const patterns = SCENE_ERA_SCORING_PATTERNS[era]
    let score = 0
    for (const item of patterns) {
      if (item.pattern.test(text)) {
        score += item.score
      }
    }

    if (score > bestScore) {
      bestEra = era
      bestScore = score
    }
  }

  return bestScore > 0 ? bestEra : undefined
}

// ==================== 场景相关 ====================

/** 场景设定 */
export const SceneSettingSchema = z.object({
  location: z.string().describe('场景地点'),
  timeOfDay: TimeOfDaySchema.describe('时间段'),
  era: z.preprocess(
    value => normalizeOptionalSceneEraValue(value) ?? value,
    z.enum(SCENE_ERA_VALUES).optional()
  ).describe('时代背景'),
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

/** 分集定义 */
export const ScriptEpisodeSchema = z.object({
  id: z.string().describe('分集ID'),
  title: z.string().describe('分集标题'),
  index: z.number().int().min(1).describe('分集序号（从1开始）')
})
export type ScriptEpisode = z.infer<typeof ScriptEpisodeSchema>

/** 短剧戏剧目标，用于保留冲突、爽点和钩子，避免分镜退化成平铺直叙 */
export const SceneDramaticSchema = z.object({
  function: z.enum(['hook', 'escalation', 'confrontation', 'reversal', 'payoff', 'cliffhanger', 'aftermath']).optional()
    .describe('场景戏剧功能'),
  conflict: z.string().optional().describe('本场核心冲突：谁压迫谁、争夺什么'),
  emotionalCurve: z.string().optional().describe('情绪曲线，例如：羞辱->震惊->冷感反击'),
  audienceHook: z.string().optional().describe('观众为什么想继续看'),
  painPoint: z.string().optional().describe('观众共情或愤怒的痛点'),
  payoff: z.string().optional().describe('本场爽点/回报点'),
  powerShift: z.string().optional().describe('权力关系如何变化'),
  antagonistPressure: z.string().optional().describe('反派如何施压'),
  protagonistCounter: z.string().optional().describe('主角如何反击或埋下反击'),
  cliffhanger: z.string().optional().describe('结尾钩子或下一场期待')
}).optional()
export type SceneDramatic = z.infer<typeof SceneDramaticSchema>

/** 场景定义 */
export const SceneSchema = z.object({
  id: z.string().describe('场景ID'),
  episodeId: z.string().optional().describe('所属分集ID'),
  episodeTitle: z.string().optional().describe('所属分集标题'),
  episodeIndex: z.number().int().min(1).optional().describe('所属分集序号（从1开始）'),
  title: z.string().optional().describe('场景标题'),
  shotType: SceneShotTypeSchema.optional(),
  cameraMovement: SceneCameraMovementSchema.optional(),
  description: z.string().describe('场景描述'),
  dramatic: SceneDramaticSchema,
  setting: SceneSettingSchema.describe('场景设定'),
  characters: z.array(SceneCharacterSchema).describe('登场角色'),
  dialogues: z.array(DialogueSchema).optional().describe('对话列表'),
  usePreviousLastFrameAsFirstFrame: z.boolean().optional().describe('是否建议使用上一镜头末帧作为本镜头首帧参考'),
  continuityLinkReason: z.string().optional().describe('承接上一镜头末帧的原因说明'),
  duration: SceneDurationSchema,
  narration: z.string().nullable().optional().describe('旁白')
})
export type Scene = z.infer<typeof SceneSchema>

// ==================== 剧本相关 ====================

/** 剧本解析结果 */
export const ParsedScriptSchema = z.object({
  title: z.string().optional().describe('剧本标题'),
  episodes: z.array(ScriptEpisodeSchema).optional().describe('分集列表'),
  scenes: z.array(SceneSchema).describe('场景列表'),
  characters: z.array(z.object({
    name: z.string(),
    description: z.string(),
    role: z.enum(['protagonist', 'antagonist', 'supporting']).optional(),
    gender: z.enum(['male', 'female', 'other']).optional()
  })).describe('角色列表'),
  totalDuration: z.number().describe('总时长(秒)')
})
export type ParsedScript = z.infer<typeof ParsedScriptSchema>

export const ScriptEpisodePlanItemSchema = z.object({
  id: z.string().optional().describe('分集ID（可选）'),
  title: z.string().optional().describe('分集标题（可选）'),
  index: z.number().int().min(1).optional().describe('分集序号（可选）'),
  startOffset: z.number().int().min(0).describe('起始字符偏移（含）'),
  endOffset: z.number().int().min(1).describe('结束字符偏移（不含）'),
  episodeHook: z.string().optional().describe('本集开场钩子'),
  humiliationOrThreat: z.string().optional().describe('本集羞辱/威胁/压迫点'),
  reversalPoint: z.string().optional().describe('本集反击或反转点'),
  emotionalCurve: z.string().optional().describe('本集情绪曲线'),
  cliffhanger: z.string().optional().describe('本集结尾钩子'),
  payoffType: z.enum(['打脸', '反杀', '揭露', '甜宠撑腰', '身世反转', '危机升级', '搞钱逆袭', '权力升级']).optional()
    .describe('本集主要爽点类型')
})
export type ScriptEpisodePlanItem = z.infer<typeof ScriptEpisodePlanItemSchema>

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
  episodePlan: z.array(ScriptEpisodePlanItemSchema).min(1).describe('分集规划（必填，按该规划进行分集解析）'),
  scriptParseMode: z.enum(SCRIPT_PARSE_MODES).optional().default(DEFAULT_SCRIPT_PARSE_MODE).describe('解析模式'),
  style: z.string().optional().describe('画风描述（可选）'),
  workflowType: z.literal('asset_consistency').optional().default('asset_consistency').describe('工作流类型')
})
export type ParseScriptRequest = z.infer<typeof ParseScriptRequestSchema>
