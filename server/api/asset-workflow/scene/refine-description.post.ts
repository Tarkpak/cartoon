import { z } from 'zod'
import { generateJSONForWorkflow } from '../../../utils/workflow-model'

const AssetTypeSchema = z.enum(['character', 'environment', 'prop'])

const SceneSettingSchema = z.object({
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  mood: z.string().optional(),
  weather: z.string().optional()
}).optional()

const SceneCharacterSchema = z.object({
  name: z.string(),
  appearance: z.string().optional(),
  emotion: z.string().optional()
})

const SceneDialogueSchema = z.object({
  character: z.string(),
  text: z.string(),
  emotion: z.string().optional()
})

const SceneSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string(),
  duration: z.number().finite().positive().optional(),
  setting: SceneSettingSchema,
  narration: z.string().optional(),
  characters: z.array(SceneCharacterSchema).optional().default([]),
  dialogues: z.array(SceneDialogueSchema).optional().default([])
})

const HistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(1200)
})

const MentionedAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AssetTypeSchema,
  description: z.string().optional(),
  hasReferenceImage: z.boolean().optional()
})

const RequestSchema = z.object({
  scene: SceneSchema,
  userMessage: z.string().min(1).max(2000),
  history: z.array(HistoryMessageSchema).max(12).optional().default([]),
  mentionedAssets: z.array(MentionedAssetSchema).max(24).optional().default([]),
  style: z.string().optional().default('')
})

const RefinedDescriptionSchema = z.object({
  description: z.string().min(12).max(2600)
})

const TIMELINE_LINE_CAPTURE_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?s\s*[：:].+$/gmu
const LEGACY_AUDIO_CONSTRAINT_REGEX = /\n?\s*不添加字幕，不添加BGM[。.]?\s*$/u

function resolveAssetTypeLabel(type: z.infer<typeof AssetTypeSchema>): string {
  if (type === 'character') return '角色'
  if (type === 'environment') return '环境'
  if (type === 'prop') return '道具'
  return '资产'
}

function buildRefineSceneDescriptionPrompt(input: z.infer<typeof RequestSchema>): string {
  const scene = input.scene
  const sceneDuration = typeof scene.duration === 'number' ? scene.duration : undefined
  const durationHint = sceneDuration !== undefined && Number.isFinite(sceneDuration)
    ? Math.max(2, Math.round(sceneDuration))
    : 8
  const historyText = input.history.length > 0
    ? input.history
        .map(item => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`)
        .join('\n')
    : '无'

  const mentionedAssetsText = input.mentionedAssets.length > 0
    ? input.mentionedAssets
        .map((asset) => {
          const brief = [
            `${resolveAssetTypeLabel(asset.type)}：${asset.name}`,
            asset.description?.trim() ? `描述：${asset.description.trim()}` : '',
            asset.hasReferenceImage ? '有参考图' : ''
          ]
            .filter(Boolean)
            .join('，')
          return `- ${brief}`
        })
        .join('\n')
    : '无'

  const settingLines = scene.setting
    ? [
        scene.setting.location ? `- 地点：${scene.setting.location}` : '',
        scene.setting.timeOfDay ? `- 时间：${scene.setting.timeOfDay}` : '',
        scene.setting.mood ? `- 氛围：${scene.setting.mood}` : '',
        scene.setting.weather ? `- 天气：${scene.setting.weather}` : ''
      ].filter(Boolean).join('\n')
    : ''

  const characterLines = (scene.characters || [])
    .map((character) => {
      const parts = [
        character.name?.trim() || '',
        character.appearance?.trim() ? `外观：${character.appearance.trim()}` : '',
        character.emotion?.trim() ? `情绪：${character.emotion.trim()}` : ''
      ].filter(Boolean)
      return parts.length > 0 ? `- ${parts.join('，')}` : ''
    })
    .filter(Boolean)
    .join('\n')

  const dialogueLines = (scene.dialogues || [])
    .map((dialogue) => {
      const speaker = dialogue.character?.trim() || '角色'
      const text = dialogue.text?.trim() || ''
      if (!text) return ''
      return `- ${speaker}：${text}`
    })
    .filter(Boolean)
    .join('\n')

  return [
    '你是一名资深影视场景编辑，负责根据对话指令改写“场景描述”。',
    '',
    '请严格输出 JSON：',
    '{"description":"改写后的场景描述"}',
    '',
    '输出要求：',
    '1. 仅输出 JSON，不要任何解释。',
    '2. description 必须保持“时间轴分行”格式，不得改成普通段落。',
    `3. 至少输出 1 行时间轴，时间单位用 s，总时长参考约 ${durationHint}s。`,
    '4. 每行格式：`起始-结束s：【景别】画面描述`，例如：`0-3s：【中景】...`。',
    '5. 融合用户本次修改意图与上下文，保持剧情连续、角色身份一致。',
    '6. 若提到资产（角色/环境/道具），应体现在描述里，但不要输出 @mention 或 [引用资产] 区块。',
    '7. 保留 [图片N] 标签风格；若原描述已有 [图片N]，尽量沿用。',
    '8. 不要输出“添加字幕/BGM”之类制作指令。',
    '',
    '示例（仅示意格式）：',
    '0-3s：【中景】护士站[图片1]人来人往，医护人员忙碌穿梭。',
    '3-8s：【近景】陆哲[图片2]嘴角上扬，眼神得意。',
    '',
    `【画风】\n${input.style || '未指定'}`,
    '',
    `【场景标题】\n${scene.title || scene.id}`,
    '',
    `【当前场景描述】\n${scene.description}`,
    '',
    settingLines ? `【场景设定】\n${settingLines}` : '',
    characterLines ? `【角色信息】\n${characterLines}` : '',
    scene.narration?.trim() ? `【旁白】\n${scene.narration.trim()}` : '',
    dialogueLines ? `【对白】\n${dialogueLines}` : '',
    '',
    `【历史对话】\n${historyText}`,
    '',
    `【本次用户指令】\n${input.userMessage}`,
    '',
    `【本次提及资产】\n${mentionedAssetsText}`
  ]
    .filter(Boolean)
    .join('\n')
}

function stripConstraintLine(text: string): string {
  return text
    .replace(LEGACY_AUDIO_CONSTRAINT_REGEX, '')
    .trim()
}

function extractTimelineLines(text: string): string[] {
  if (!text) return []
  const matches = text.match(TIMELINE_LINE_CAPTURE_REGEX) || []
  return matches
    .map(line => line.trim())
    .filter(Boolean)
}

function normalizeRefinedTimelineDescription(options: {
  refined: string
  fallback: string
  durationHint: number
}): string {
  const refinedCore = stripConstraintLine(options.refined || '')
  const fallbackCore = stripConstraintLine(options.fallback || '')
  const refinedTimelineLines = extractTimelineLines(refinedCore)

  if (refinedTimelineLines.length > 0) {
    return refinedTimelineLines.join('\n')
  }

  const fallbackTimelineLines = extractTimelineLines(fallbackCore)
  if (fallbackTimelineLines.length > 0) {
    return fallbackTimelineLines.join('\n')
  }

  const safeDuration = Math.max(2, Number.isFinite(options.durationHint) ? Math.round(options.durationHint) : 8)
  const lineBody = (refinedCore || fallbackCore || '保持原场景动作与情绪推进。')
    .replace(/\s+/g, ' ')
    .trim()
  return `0-${safeDuration}s：【中景】${lineBody}`
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = RequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const input = parseResult.data
  const prompt = buildRefineSceneDescriptionPrompt(input)

  try {
    const result = await generateJSONForWorkflow<z.infer<typeof RefinedDescriptionSchema>>('scene_visual_extraction', {
      prompt,
      temperature: 0.35,
      maxRetries: 2
    })

    const validated = RefinedDescriptionSchema.safeParse(result)
    if (!validated.success) {
      throw new Error(validated.error.issues.map(issue => issue.message).join(', '))
    }

    const normalizedDescription = normalizeRefinedTimelineDescription({
      refined: validated.data.description,
      fallback: input.scene.description,
      durationHint: Number.isFinite(input.scene.duration) ? Number(input.scene.duration) : 8
    })

    return {
      success: true,
      data: {
        description: normalizedDescription
      }
    }
  } catch (error) {
    console.error('[AssetWorkflow][SceneRefine] 场景描述改写失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '场景描述改写失败',
      message: error instanceof Error ? error.message : '模型调用失败'
    })
  }
})
