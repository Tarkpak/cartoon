import { z } from 'zod'
import { generateJSONForWorkflow } from '../../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../../shared/types/prompt-template'
import {
  resolveTimeOfDayText,
  normalizeOptionalSceneEraValue,
  inferSceneEraFromText
} from '../../../../shared/types/script'

const AssetTypeSchema = z.enum(['character', 'environment', 'prop', 'other'])

const SceneSettingSchema = z.object({
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  era: z.string().optional(),
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
  description: z.string().min(12).max(5000)
})

const TIMELINE_LINE_CAPTURE_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:].+$/gmu
const LEGACY_AUDIO_CONSTRAINT_REGEX = /\n?\s*不添加字幕，不添加BGM[。.]?\s*$/u

function resolveAssetTypeLabel(type: z.infer<typeof AssetTypeSchema>): string {
  if (type === 'character') return '角色'
  if (type === 'environment') return '环境'
  if (type === 'prop') return '道具'
  if (type === 'other') return '其他'
  return '资产'
}

function buildSettingText(scene: z.infer<typeof SceneSchema>): string {
  if (!scene.setting) return '无'
  const era = normalizeOptionalSceneEraValue(scene.setting.era)
    || inferSceneEraFromText([
      scene.title || '',
      scene.description || '',
      scene.setting.location || ''
    ].filter(Boolean).join('\n'))

  return [
    scene.setting.location ? `- 地点：${scene.setting.location}` : '',
    scene.setting.timeOfDay ? `- 时间：${resolveTimeOfDayText(scene.setting.timeOfDay)}` : '',
    era ? `- 时代：${era}` : '',
    scene.setting.mood ? `- 氛围：${scene.setting.mood}` : '',
    scene.setting.weather ? `- 天气：${scene.setting.weather}` : ''
  ]
    .filter(Boolean)
    .join('\n') || '无'
}

function buildCharacterText(scene: z.infer<typeof SceneSchema>): string {
  return (scene.characters || [])
    .map((character) => {
      const parts = [
        character.name?.trim() || '',
        character.appearance?.trim() ? `外观：${character.appearance.trim()}` : '',
        character.emotion?.trim() ? `情绪：${character.emotion.trim()}` : ''
      ].filter(Boolean)
      return parts.length > 0 ? `- ${parts.join('，')}` : ''
    })
    .filter(Boolean)
    .join('\n') || '无'
}

function buildDialogueText(scene: z.infer<typeof SceneSchema>): string {
  return (scene.dialogues || [])
    .map((dialogue) => {
      const speaker = dialogue.character?.trim() || '角色'
      const text = dialogue.text?.trim() || ''
      if (!text) return ''
      return `- ${speaker}：${text}`
    })
    .filter(Boolean)
    .join('\n') || '无'
}

function buildHistoryText(history: z.infer<typeof HistoryMessageSchema>[]): string {
  return history
    .map(item => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`)
    .join('\n') || '无'
}

function buildMentionedAssetsText(mentionedAssets: z.infer<typeof MentionedAssetSchema>[]): string {
  return mentionedAssets
    .map((asset) => {
      const parts = [
        `${resolveAssetTypeLabel(asset.type)}：${asset.name}`,
        asset.description?.trim() ? `描述：${asset.description.trim()}` : '',
        asset.hasReferenceImage ? '有参考图' : ''
      ].filter(Boolean)
      return `- ${parts.join('，')}`
    })
    .join('\n') || '无'
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

function normalizeRefinedDescription(options: {
  refined: string
  fallback: string
  durationHint: number
}): string {
  const refinedCore = stripConstraintLine(options.refined || '')
  const fallbackCore = stripConstraintLine(options.fallback || '')
  const refinedTimelineLines = extractTimelineLines(refinedCore)

  if (refinedTimelineLines.length > 0) {
    return refinedCore
  }

  const fallbackTimelineLines = extractTimelineLines(fallbackCore)
  if (fallbackTimelineLines.length > 0) {
    if (!refinedCore) {
      return fallbackCore
    }

    if (/镜头设计\s*[：:]/u.test(refinedCore)) {
      return `${refinedCore}\n${fallbackTimelineLines.join('\n')}`.trim()
    }

    return `${refinedCore}\n\n镜头设计：\n${fallbackTimelineLines.join('\n')}`.trim()
  }

  const safeDuration = Math.max(2, Number.isFinite(options.durationHint) ? Math.round(options.durationHint) : 8)
  const lineBody = (refinedCore || fallbackCore || '保持原场景动作与情绪推进。')
    .replace(/\s+/g, ' ')
    .trim()
  const fallbackTimeline = `0-${safeDuration}秒：中景，固定镜头。${lineBody}`

  if (!refinedCore) {
    return fallbackTimeline
  }

  if (/镜头设计\s*[：:]/u.test(refinedCore)) {
    return `${refinedCore}\n${fallbackTimeline}`.trim()
  }

  return `${refinedCore}\n\n镜头设计：\n${fallbackTimeline}`.trim()
}

async function buildRefineSceneDescriptionPrompt(
  input: z.infer<typeof RequestSchema>
): Promise<string> {
  const durationHint = input.scene.duration !== undefined && Number.isFinite(input.scene.duration)
    ? Math.max(2, Math.round(input.scene.duration))
    : 8

  const prompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.SCENE_DESCRIPTION_REFINEMENT,
    {
      style: input.style || '未指定',
      sceneTitle: input.scene.title || input.scene.id,
      sceneDescription: input.scene.description,
      setting: buildSettingText(input.scene),
      characters: buildCharacterText(input.scene),
      narration: input.scene.narration?.trim() || '无',
      dialogues: buildDialogueText(input.scene),
      history: buildHistoryText(input.history),
      userMessage: input.userMessage,
      mentionedAssets: buildMentionedAssetsText(input.mentionedAssets),
      durationHint: String(durationHint)
    },
    undefined,
    'asset_consistency'
  )

  if (!prompt) {
    throw new Error('无法获取场景描述改写模板，请检查提示词配置')
  }

  return prompt
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = RequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(issue => issue.message).join(', ')
    })
  }

  const input = parseResult.data
  const prompt = await buildRefineSceneDescriptionPrompt(input)

  try {
    const result = await generateJSONForWorkflow<z.infer<typeof RefinedDescriptionSchema>>('scene_description_refinement', {
      prompt,
      temperature: 0.35,
      maxRetries: 2
    })

    const validated = RefinedDescriptionSchema.safeParse(result)
    if (!validated.success) {
      throw new Error(validated.error.issues.map(issue => issue.message).join(', '))
    }

    const normalizedDescription = normalizeRefinedDescription({
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
    console.error('[AssetWorkflow][SceneDescriptionRefinement] 场景描述改写失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '模型调用失败'
    })
  }
})
