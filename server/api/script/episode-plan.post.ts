import { z } from 'zod'
import { generateJSONForWorkflow } from '../../utils/workflow-model'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  SCRIPT_PARSE_MODES,
  normalizeScriptParseMode,
  type ScriptEpisodePlanItem,
  type ScriptParseMode
} from '../../../shared/types/script'

const EpisodePlanRequestSchema = z.object({
  text: z.string().min(10).describe('原始小说文本'),
  scriptParseMode: z.enum(SCRIPT_PARSE_MODES).optional().default(DEFAULT_SCRIPT_PARSE_MODE).describe('解析模式')
})

const EpisodePlanModelEpisodeSchema = z.object({
  index: z.coerce.number().int().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  startAnchor: z.string().trim().min(8).optional()
})

const EpisodePlanModelOutputSchema = z.object({
  episodes: z.array(EpisodePlanModelEpisodeSchema).min(1)
})

const MIN_EPISODE_CHAR_GAP = 1

function normalizeScriptInputText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim()
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toEpisodeId(index: number): string {
  return `episode_${String(index + 1).padStart(3, '0')}`
}

function toEpisodeTitle(index: number): string {
  return `第${index + 1}集`
}

function normalizeEpisodeTitle(rawTitle: string | undefined, index: number): string {
  const value = rawTitle?.trim() || ''
  return value || toEpisodeTitle(index)
}

function buildEpisodePlanPrompt(text: string, scriptParseMode: ScriptParseMode): string {
  const modeRule = scriptParseMode === 'short_drama'
    ? '短剧模式额外约束：请由剧情节奏决定分集数量，并确保每集对应的场景合成总时长目标不超过 300 秒（5 分钟）。'
    : '精品剧模式：由剧情结构自行决定分集数量。'

  return `你是专业编剧统筹，请把一部长文本剧本按“剧情结构”拆分成分集目录。

要求：
1) 必须按剧情节点分集，不允许按字数平均切分。
2) ${modeRule}
3) 每集给出 title（可简短），并给出 startAnchor：
   - startAnchor 必须是原文中的连续原句片段，逐字摘录，不得改写。
   - 第1集 startAnchor 必须取原文开头连续片段。
   - 第2集及以后 startAnchor 必须对应该集开头附近，建议 20~80 字，尽量唯一。
4) 仅输出 JSON，不要 markdown，不要解释文本，不要输出空集。

JSON 结构（严格遵守）：
{
  "episodes": [
    {
      "index": 1,
      "title": "第1集：...",
      "startAnchor": "原文片段"
    }
  ]
}

原文如下：
${text}`
}

function findAnchorOffset(text: string, anchor: string, fromOffset: number): number {
  const normalizedAnchor = anchor.trim()
  if (normalizedAnchor.length < 8) return -1

  const exactIndex = text.indexOf(normalizedAnchor, fromOffset)
  if (exactIndex >= 0) return exactIndex

  const compactAnchor = normalizedAnchor.replace(/\s+/g, ' ').trim()
  if (!compactAnchor) return -1

  const tolerantPattern = escapeRegExp(compactAnchor).replace(/\s+/g, '\\s+')
  const tolerantRegex = new RegExp(tolerantPattern, 'u')
  const slice = text.slice(fromOffset)
  const tolerantMatch = tolerantRegex.exec(slice)
  if (tolerantMatch && typeof tolerantMatch.index === 'number') {
    return fromOffset + tolerantMatch.index
  }

  return -1
}

function buildEpisodePlanFromModelOutput(
  text: string,
  modelOutput: z.infer<typeof EpisodePlanModelOutputSchema>
): ScriptEpisodePlanItem[] {
  const rawEpisodes = modelOutput.episodes
    .map((item, order) => ({
      order,
      index: item.index ?? (order + 1),
      title: item.title,
      startAnchor: item.startAnchor
    }))
    .sort((a, b) => a.index - b.index || a.order - b.order)

  if (rawEpisodes.length === 0) return []

  const resolvedStarts: Array<{ title: string, startOffset: number }> = [{
    title: normalizeEpisodeTitle(rawEpisodes[0]?.title, 0),
    startOffset: 0
  }]

  let lastStartOffset = 0
  for (let i = 1; i < rawEpisodes.length; i++) {
    const episode = rawEpisodes[i]
    if (!episode) continue

    const anchor = episode.startAnchor?.trim() || ''
    if (!anchor) continue

    const fromOffset = Math.min(text.length, lastStartOffset + MIN_EPISODE_CHAR_GAP)
    const startOffset = findAnchorOffset(text, anchor, fromOffset)
    if (startOffset <= lastStartOffset || startOffset >= text.length) continue

    resolvedStarts.push({
      title: normalizeEpisodeTitle(episode.title, resolvedStarts.length),
      startOffset
    })
    lastStartOffset = startOffset
  }

  if (resolvedStarts.length === 1) {
    return [{
      id: toEpisodeId(0),
      title: normalizeEpisodeTitle(rawEpisodes[0]?.title, 0),
      index: 1,
      startOffset: 0,
      endOffset: text.length
    }]
  }

  const plannedEpisodes: ScriptEpisodePlanItem[] = []
  for (let i = 0; i < resolvedStarts.length; i++) {
    const current = resolvedStarts[i]
    if (!current) continue

    const next = resolvedStarts[i + 1]
    const startOffset = current.startOffset
    const endOffset = next ? next.startOffset : text.length

    if (endOffset - startOffset < MIN_EPISODE_CHAR_GAP) continue

    plannedEpisodes.push({
      id: toEpisodeId(plannedEpisodes.length),
      title: normalizeEpisodeTitle(current.title, plannedEpisodes.length),
      index: plannedEpisodes.length + 1,
      startOffset,
      endOffset
    })
  }

  if (plannedEpisodes.length === 0) return []
  if (plannedEpisodes[0] && plannedEpisodes[0].startOffset !== 0) {
    plannedEpisodes[0] = {
      ...plannedEpisodes[0],
      startOffset: 0
    }
  }
  if (plannedEpisodes[plannedEpisodes.length - 1]) {
    plannedEpisodes[plannedEpisodes.length - 1] = {
      ...plannedEpisodes[plannedEpisodes.length - 1]!,
      endOffset: text.length
    }
  }

  return plannedEpisodes
}

async function buildModelDrivenEpisodePlan(text: string, scriptParseMode: ScriptParseMode): Promise<ScriptEpisodePlanItem[]> {
  const prompt = buildEpisodePlanPrompt(text, scriptParseMode)
  const modelResult = await generateJSONForWorkflow<unknown>('script_parsing', {
    prompt,
    temperature: 0.2,
    maxRetries: 2
  })

  const parsedModelResult = EpisodePlanModelOutputSchema.safeParse(modelResult)
  if (!parsedModelResult.success) {
    throw new Error('分集目录模型输出格式无效')
  }

  return buildEpisodePlanFromModelOutput(text, parsedModelResult.data)
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = EpisodePlanRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const normalizedText = normalizeScriptInputText(parseResult.data.text)
  if (!normalizedText) {
    return {
      success: true,
      data: {
        episodes: []
      }
    }
  }

  let episodes: ScriptEpisodePlanItem[] = []
  try {
    const normalizedScriptParseMode = normalizeScriptParseMode(parseResult.data.scriptParseMode)
    episodes = await buildModelDrivenEpisodePlan(normalizedText, normalizedScriptParseMode)
    if (episodes.length === 0) {
      throw new Error('分集目录模型结果为空')
    }
  } catch (error) {
    console.error('[EpisodePlan] 模型分集失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '分集目录生成失败',
      message: '大模型分集失败，请重试或检查模型配置'
    })
  }

  const episodesWithCharCount = episodes.map((item) => {
    const charCount = Math.max(0, item.endOffset - item.startOffset)
    return {
      ...item,
      charCount
    }
  })

  return {
    success: true,
    data: {
      episodes: episodesWithCharCount
    }
  }
})
