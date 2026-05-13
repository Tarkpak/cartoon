import { z } from 'zod'
import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  SCRIPT_PARSE_MODES,
  normalizeScriptParseMode,
  type ScriptEpisodePlanItem,
  type ScriptParseMode
} from '../../../shared/types/script'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import { normalizeCharacterGender, normalizeCharacterRole } from '../../../shared/types/character'

const EpisodePlanRequestSchema = z.object({
  text: z.string().min(10).describe('原始小说文本'),
  scriptParseMode: z.enum(SCRIPT_PARSE_MODES).optional().default(DEFAULT_SCRIPT_PARSE_MODE).describe('解析模式')
})

const EpisodePlanModelEpisodeSchema = z.object({
  index: z.coerce.number().int().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  startAnchor: z.string().trim().min(8).optional(),
  episodeHook: z.string().trim().optional(),
  humiliationOrThreat: z.string().trim().optional(),
  reversalPoint: z.string().trim().optional(),
  emotionalCurve: z.string().trim().optional(),
  cliffhanger: z.string().trim().optional(),
  payoffType: z.enum(['打脸', '反杀', '揭露', '甜宠撑腰', '身世反转', '危机升级', '搞钱逆袭', '权力升级']).optional(),
  episodeAssets: z.object({
    characters: z.array(z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional(),
      role: z.string().trim().optional(),
      gender: z.string().trim().optional()
    })).optional(),
    props: z.array(z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().optional()
    })).optional(),
    environments: z.array(z.object({
      location: z.string().trim().min(1),
      timeOfDay: z.string().trim().optional(),
      mood: z.string().trim().optional()
    })).optional()
  }).optional()
})

const EpisodePlanModelOutputSchema = z.object({
  episodes: z.array(EpisodePlanModelEpisodeSchema).min(1)
})

const MIN_EPISODE_CHAR_GAP = 1
const EPISODE_PLAN_SINGLE_PASS_MAX_CHARS = 32000
const EPISODE_PLAN_CHUNK_FALLBACK_MIN_CHARS = 12000
const EPISODE_PLAN_CHUNK_TARGET_CHARS = 24000
const EPISODE_PLAN_CHUNK_MAX_CHARS = 32000
const EPISODE_PLAN_CHUNK_MIN_CHARS = 10000
const EPISODE_PLAN_MAX_CHUNK_COUNT = 64
const CHAPTER_HEADING_REGEX = /(?:^|\n)\s*(?:第[0-9零一二三四五六七八九十百千万两]+[章节回卷部篇集]|chapter\s+\d+)[^\n]*/giu

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

async function buildEpisodePlanPrompt(
  text: string,
  scriptParseMode: ScriptParseMode,
  options: {
    chunkIndex?: number
    chunkCount?: number
  } = {}
): Promise<string> {
  const modeRule = scriptParseMode === 'short_drama'
    ? '短剧模式额外约束：请由剧情节奏决定分集数量，并确保每集对应的场景合成总时长目标不超过 300 秒（5 分钟）。'
    : '精品剧模式：由剧情结构自行决定分集数量。'
  const chunkCount = options.chunkCount && options.chunkCount > 1 ? options.chunkCount : 1
  const chunkIndex = options.chunkIndex && options.chunkIndex >= 1 ? options.chunkIndex : 1
  const isSegmented = chunkCount > 1
  const chunkRule = isSegmented
    ? `当前仅提供原文第 ${chunkIndex}/${chunkCount} 段，请严格基于本段文本拆分，不得补写未提供段落。`
    : '当前提供的是完整原文。'
  const firstAnchorRule = isSegmented
    ? '第1集 startAnchor 必须取“本段开头”的连续片段。'
    : '第1集 startAnchor 必须取原文开头连续片段。'

  const prompt = await getInterpolatedPrompt(
    PROMPT_TEMPLATE_IDS.SCRIPT_EPISODE_PLAN,
    {
      novelText: text,
      modeRule,
      chunkRule,
      firstAnchorRule
    },
    undefined,
    'asset_consistency'
  )
  if (!prompt) {
    throw new Error('无法获取分集目录规划模板，请在设置中检查提示词配置')
  }
  return prompt
}

interface EpisodePlanChunk {
  index: number
  startOffset: number
  endOffset: number
  text: string
}

interface EpisodeAssetCharacter {
  name: string
  description?: string
  role?: string
  gender?: string
}

interface EpisodeAssetProp {
  name: string
  description?: string
}

interface EpisodeAssetEnvironment {
  location: string
  timeOfDay?: string
  mood?: string
}

interface EpisodeAssetSummary {
  characters: EpisodeAssetCharacter[]
  props: EpisodeAssetProp[]
  environments: EpisodeAssetEnvironment[]
}

interface EpisodePlanItemWithAssets extends ScriptEpisodePlanItem {
  episodeAssets?: EpisodeAssetSummary
}

type EpisodeDramaMeta = Pick<
  ScriptEpisodePlanItem,
  'episodeHook' | 'humiliationOrThreat' | 'reversalPoint' | 'emotionalCurve' | 'cliffhanger' | 'payoffType'
>

function pickEpisodeDramaMeta(source?: Partial<EpisodeDramaMeta>): EpisodeDramaMeta {
  return {
    ...(source?.episodeHook ? { episodeHook: source.episodeHook } : {}),
    ...(source?.humiliationOrThreat ? { humiliationOrThreat: source.humiliationOrThreat } : {}),
    ...(source?.reversalPoint ? { reversalPoint: source.reversalPoint } : {}),
    ...(source?.emotionalCurve ? { emotionalCurve: source.emotionalCurve } : {}),
    ...(source?.cliffhanger ? { cliffhanger: source.cliffhanger } : {}),
    ...(source?.payoffType ? { payoffType: source.payoffType } : {})
  }
}

function normalizeEpisodeAssetKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s\r\n\t]+/g, '').trim()
}

function normalizeEpisodeAssetSummary(raw: unknown): EpisodeAssetSummary | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = raw as {
    characters?: Array<{ name?: unknown, description?: unknown, role?: unknown, gender?: unknown }>
    props?: Array<{ name?: unknown, description?: unknown }>
    environments?: Array<{ location?: unknown, timeOfDay?: unknown, mood?: unknown }>
  }

  const characterMap = new Map<string, EpisodeAssetCharacter>()
  for (const item of source.characters || []) {
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!name) continue
    const key = normalizeEpisodeAssetKey(name)
    if (!key) continue
    const description = typeof item?.description === 'string' ? item.description.trim() : ''
    const role = normalizeCharacterRole(item?.role)
    const gender = normalizeCharacterGender(item?.gender)
    const existing = characterMap.get(key)
    if (!existing) {
      characterMap.set(key, {
        name,
        ...(description ? { description } : {}),
        ...(role ? { role } : {}),
        ...(gender ? { gender } : {})
      })
      continue
    }
    if (description && (!existing.description || description.length > existing.description.length)) {
      existing.description = description
    }
    if (role && !existing.role) {
      existing.role = role
    }
    if (gender && !existing.gender) {
      existing.gender = gender
    }
  }

  const propMap = new Map<string, EpisodeAssetProp>()
  for (const item of source.props || []) {
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!name) continue
    const key = normalizeEpisodeAssetKey(name)
    if (!key) continue
    const description = typeof item?.description === 'string' ? item.description.trim() : ''
    const existing = propMap.get(key)
    if (!existing) {
      propMap.set(key, {
        name,
        ...(description ? { description } : {})
      })
      continue
    }
    if (description && (!existing.description || description.length > existing.description.length)) {
      existing.description = description
    }
  }

  const environmentMap = new Map<string, EpisodeAssetEnvironment>()
  for (const item of source.environments || []) {
    const location = typeof item?.location === 'string' ? item.location.trim() : ''
    if (!location) continue
    const timeOfDay = typeof item?.timeOfDay === 'string' ? item.timeOfDay.trim() : ''
    const mood = typeof item?.mood === 'string' ? item.mood.trim() : ''
    const key = normalizeEpisodeAssetKey(`${location}||${timeOfDay}`)
    if (!key) continue
    const existing = environmentMap.get(key)
    if (!existing) {
      environmentMap.set(key, {
        location,
        ...(timeOfDay ? { timeOfDay } : {}),
        ...(mood ? { mood } : {})
      })
      continue
    }
    if (mood && (!existing.mood || mood.length > existing.mood.length)) {
      existing.mood = mood
    }
  }

  const normalized: EpisodeAssetSummary = {
    characters: Array.from(characterMap.values()),
    props: Array.from(propMap.values()),
    environments: Array.from(environmentMap.values())
  }

  if (
    normalized.characters.length === 0
    && normalized.props.length === 0
    && normalized.environments.length === 0
  ) {
    return undefined
  }

  return normalized
}

function mergeEpisodeAssetSummaries(
  current?: EpisodeAssetSummary,
  incoming?: EpisodeAssetSummary
): EpisodeAssetSummary | undefined {
  if (!current && !incoming) return undefined
  if (!current) return incoming
  if (!incoming) return current
  return normalizeEpisodeAssetSummary({
    characters: [...current.characters, ...incoming.characters],
    props: [...current.props, ...incoming.props],
    environments: [...current.environments, ...incoming.environments]
  })
}

function findBackwardBreak(text: string, from: number, min: number, breakChars: Set<string>): number {
  for (let i = from; i >= min; i--) {
    const char = text[i]
    if (char && breakChars.has(char)) {
      return i + 1
    }
  }
  return -1
}

function findForwardBreak(text: string, from: number, max: number, breakChars: Set<string>): number {
  for (let i = from; i < max; i++) {
    const char = text[i]
    if (char && breakChars.has(char)) {
      return i + 1
    }
  }
  return -1
}

function resolveChunkBreakOffset(options: {
  text: string
  minOffset: number
  preferredOffset: number
  maxOffset: number
}): number {
  const { text, minOffset, preferredOffset, maxOffset } = options
  const windowText = text.slice(minOffset, maxOffset)
  const chapterBreakCandidates: number[] = []

  CHAPTER_HEADING_REGEX.lastIndex = 0
  let match = CHAPTER_HEADING_REGEX.exec(windowText)
  while (match) {
    const raw = match[0] || ''
    const localStart = match.index + (raw.startsWith('\n') ? 1 : 0)
    const candidate = minOffset + localStart
    if (candidate > minOffset && candidate < maxOffset) {
      chapterBreakCandidates.push(candidate)
    }
    match = CHAPTER_HEADING_REGEX.exec(windowText)
  }

  if (chapterBreakCandidates.length > 0) {
    chapterBreakCandidates.sort((a, b) => {
      return Math.abs(a - preferredOffset) - Math.abs(b - preferredOffset)
    })
    const best = chapterBreakCandidates[0]
    if (best && best > minOffset && best < maxOffset) return best
  }

  const paragraphBreak = text.lastIndexOf('\n\n', preferredOffset)
  if (paragraphBreak >= minOffset && paragraphBreak < maxOffset) {
    return paragraphBreak + 2
  }

  const lineBreak = text.lastIndexOf('\n', preferredOffset)
  if (lineBreak >= minOffset && lineBreak < maxOffset) {
    return lineBreak + 1
  }

  const sentenceBreakChars = new Set(['。', '！', '？', '!', '?'])
  const punctuationBreakChars = new Set(['；', ';', '，', ',', '、'])
  const backwardSentenceBreak = findBackwardBreak(text, preferredOffset, minOffset, sentenceBreakChars)
  if (backwardSentenceBreak > minOffset && backwardSentenceBreak < maxOffset) {
    return backwardSentenceBreak
  }
  const backwardPunctuationBreak = findBackwardBreak(text, preferredOffset, minOffset, punctuationBreakChars)
  if (backwardPunctuationBreak > minOffset && backwardPunctuationBreak < maxOffset) {
    return backwardPunctuationBreak
  }

  const forwardSentenceBreak = findForwardBreak(text, preferredOffset + 1, maxOffset, sentenceBreakChars)
  if (forwardSentenceBreak > minOffset && forwardSentenceBreak < maxOffset) {
    return forwardSentenceBreak
  }

  return maxOffset
}

function splitTextIntoEpisodePlanChunks(text: string): EpisodePlanChunk[] {
  if (text.length <= EPISODE_PLAN_CHUNK_MAX_CHARS) {
    return [{
      index: 1,
      startOffset: 0,
      endOffset: text.length,
      text
    }]
  }

  const chunks: EpisodePlanChunk[] = []
  let cursor = 0

  while (cursor < text.length && chunks.length < EPISODE_PLAN_MAX_CHUNK_COUNT) {
    const remaining = text.length - cursor
    if (remaining <= EPISODE_PLAN_CHUNK_MAX_CHARS) {
      chunks.push({
        index: chunks.length + 1,
        startOffset: cursor,
        endOffset: text.length,
        text: text.slice(cursor)
      })
      break
    }

    const minOffset = Math.min(text.length, cursor + EPISODE_PLAN_CHUNK_MIN_CHARS)
    const preferredOffset = Math.min(text.length, cursor + EPISODE_PLAN_CHUNK_TARGET_CHARS)
    const maxOffset = Math.min(text.length, cursor + EPISODE_PLAN_CHUNK_MAX_CHARS)
    const nextOffset = resolveChunkBreakOffset({
      text,
      minOffset,
      preferredOffset,
      maxOffset
    })

    const safeNextOffset = Math.max(cursor + MIN_EPISODE_CHAR_GAP, Math.min(text.length, nextOffset))
    if (safeNextOffset <= cursor) break

    chunks.push({
      index: chunks.length + 1,
      startOffset: cursor,
      endOffset: safeNextOffset,
      text: text.slice(cursor, safeNextOffset)
    })
    cursor = safeNextOffset
  }

  if (cursor < text.length) {
    chunks.push({
      index: chunks.length + 1,
      startOffset: cursor,
      endOffset: text.length,
      text: text.slice(cursor)
    })
  }

  return chunks.filter(chunk => chunk.endOffset > chunk.startOffset && chunk.text.length > 0)
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
): EpisodePlanItemWithAssets[] {
  const rawEpisodes = modelOutput.episodes
    .map((item, order) => ({
      order,
      index: item.index ?? (order + 1),
      title: item.title,
      startAnchor: item.startAnchor,
      episodeAssets: normalizeEpisodeAssetSummary(item.episodeAssets),
      episodeHook: item.episodeHook,
      humiliationOrThreat: item.humiliationOrThreat,
      reversalPoint: item.reversalPoint,
      emotionalCurve: item.emotionalCurve,
      cliffhanger: item.cliffhanger,
      payoffType: item.payoffType
    }))
    .sort((a, b) => a.index - b.index || a.order - b.order)

  if (rawEpisodes.length === 0) return []

  const resolvedStarts: Array<{ title: string, startOffset: number, episodeAssets?: EpisodeAssetSummary } & EpisodeDramaMeta> = [{
    title: normalizeEpisodeTitle(rawEpisodes[0]?.title, 0),
    startOffset: 0,
    episodeAssets: rawEpisodes[0]?.episodeAssets,
    ...pickEpisodeDramaMeta(rawEpisodes[0])
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
      startOffset,
      episodeAssets: episode.episodeAssets,
      ...pickEpisodeDramaMeta(episode)
    })
    lastStartOffset = startOffset
  }

  if (resolvedStarts.length === 1) {
    return [{
      id: toEpisodeId(0),
      title: normalizeEpisodeTitle(rawEpisodes[0]?.title, 0),
      index: 1,
      startOffset: 0,
      endOffset: text.length,
      episodeAssets: rawEpisodes[0]?.episodeAssets,
      ...pickEpisodeDramaMeta(rawEpisodes[0])
    }]
  }

  const plannedEpisodes: EpisodePlanItemWithAssets[] = []
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
      endOffset,
      episodeAssets: current.episodeAssets,
      ...pickEpisodeDramaMeta(current)
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

async function runModelDrivenEpisodePlanPass(options: {
  text: string
  scriptParseMode: ScriptParseMode
  chunkIndex?: number
  chunkCount?: number
}): Promise<EpisodePlanItemWithAssets[]> {
  const prompt = await buildEpisodePlanPrompt(options.text, options.scriptParseMode, {
    chunkIndex: options.chunkIndex,
    chunkCount: options.chunkCount
  })
  const modelResult = await generateJSONForWorkflow<unknown>('script_parsing', {
    prompt,
    temperature: 0.2,
    maxRetries: 2
  })

  const parsedModelResult = EpisodePlanModelOutputSchema.safeParse(modelResult)
  if (!parsedModelResult.success) {
    throw new Error('分集目录模型输出格式无效')
  }

  return buildEpisodePlanFromModelOutput(options.text, parsedModelResult.data)
}

async function buildModelDrivenEpisodePlan(text: string, scriptParseMode: ScriptParseMode): Promise<EpisodePlanItemWithAssets[]> {
  return await runModelDrivenEpisodePlanPass({
    text,
    scriptParseMode
  })
}

function isGenericEpisodeTitle(title: string): boolean {
  return /^第\s*\d+\s*集(?:\s*[：:、-].*)?$/u.test(title.trim())
}

function pickPreferredTitle(current: string | undefined, incoming: string): string {
  const next = incoming.trim()
  if (!next) return (current || '').trim()
  const existing = (current || '').trim()
  if (!existing) return next

  const existingGeneric = isGenericEpisodeTitle(existing)
  const nextGeneric = isGenericEpisodeTitle(next)
  if (existingGeneric && !nextGeneric) return next
  if (!existingGeneric && nextGeneric) return existing

  return next.length > existing.length ? next : existing
}

async function buildChunkedModelDrivenEpisodePlan(
  text: string,
  scriptParseMode: ScriptParseMode
): Promise<EpisodePlanItemWithAssets[]> {
  const chunks = splitTextIntoEpisodePlanChunks(text)
  if (chunks.length === 0) return []

  console.log('[EpisodePlan] 启用分段分集策略:', {
    textLength: text.length,
    chunkCount: chunks.length,
    targetChunkChars: EPISODE_PLAN_CHUNK_TARGET_CHARS
  })

  const startMetaMap = new Map<number, {
    title: string
    episodeAssets?: EpisodeAssetSummary
  } & EpisodeDramaMeta>()
  startMetaMap.set(0, { title: '' })

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]
    if (!chunk) continue

    const localEpisodes = await runModelDrivenEpisodePlanPass({
      text: chunk.text,
      scriptParseMode,
      chunkIndex: index + 1,
      chunkCount: chunks.length
    })

    for (const localEpisode of localEpisodes) {
      const localStartOffset = Number.isFinite(localEpisode.startOffset)
        ? Math.max(0, Math.floor(localEpisode.startOffset))
        : 0
      const globalStartOffset = Math.max(
        0,
        Math.min(text.length - 1, chunk.startOffset + localStartOffset)
      )
      const currentMeta = startMetaMap.get(globalStartOffset)
      startMetaMap.set(globalStartOffset, {
        title: pickPreferredTitle(currentMeta?.title, localEpisode.title || ''),
        episodeAssets: mergeEpisodeAssetSummaries(currentMeta?.episodeAssets, localEpisode.episodeAssets),
        ...pickEpisodeDramaMeta({
          ...localEpisode,
          ...currentMeta
        })
      })
    }
  }

  const sortedStarts = Array.from(startMetaMap.keys())
    .sort((a, b) => a - b)
    .filter((start, idx, list) => {
      if (idx === 0) return true
      const prev = list[idx - 1] ?? -1
      return start - prev >= MIN_EPISODE_CHAR_GAP
    })

  if (sortedStarts.length === 0 || sortedStarts[0] !== 0) {
    sortedStarts.unshift(0)
  }

  const mergedEpisodes: EpisodePlanItemWithAssets[] = []
  for (let i = 0; i < sortedStarts.length; i++) {
    const startOffset = sortedStarts[i]
    if (startOffset === undefined) continue
    const endOffset = sortedStarts[i + 1] ?? text.length
    if (endOffset - startOffset < MIN_EPISODE_CHAR_GAP) continue

    const meta = startMetaMap.get(startOffset)
    mergedEpisodes.push({
      id: toEpisodeId(mergedEpisodes.length),
      title: normalizeEpisodeTitle(meta?.title, mergedEpisodes.length),
      index: mergedEpisodes.length + 1,
      startOffset,
      endOffset,
      episodeAssets: meta?.episodeAssets,
      ...pickEpisodeDramaMeta(meta)
    })
  }

  if (mergedEpisodes.length === 0) return []
  if (mergedEpisodes[0] && mergedEpisodes[0].startOffset !== 0) {
    mergedEpisodes[0] = {
      ...mergedEpisodes[0],
      startOffset: 0
    }
  }
  if (mergedEpisodes[mergedEpisodes.length - 1]) {
    mergedEpisodes[mergedEpisodes.length - 1] = {
      ...mergedEpisodes[mergedEpisodes.length - 1]!,
      endOffset: text.length
    }
  }

  return mergedEpisodes
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = EpisodePlanRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
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

  let episodes: EpisodePlanItemWithAssets[] = []
  try {
    const normalizedScriptParseMode = normalizeScriptParseMode(parseResult.data.scriptParseMode)
    const shouldUseChunkStrategy = normalizedText.length > EPISODE_PLAN_SINGLE_PASS_MAX_CHARS

    if (shouldUseChunkStrategy) {
      episodes = await buildChunkedModelDrivenEpisodePlan(normalizedText, normalizedScriptParseMode)
    } else {
      try {
        episodes = await buildModelDrivenEpisodePlan(normalizedText, normalizedScriptParseMode)
      } catch (singlePassError) {
        if (normalizedText.length < EPISODE_PLAN_CHUNK_FALLBACK_MIN_CHARS) {
          throw singlePassError
        }
        console.warn('[EpisodePlan] 单次分集失败，回退分段分集策略:', singlePassError)
        episodes = await buildChunkedModelDrivenEpisodePlan(normalizedText, normalizedScriptParseMode)
      }
    }

    if (episodes.length === 0) {
      throw new Error('分集目录模型结果为空')
    }
  } catch (error) {
    console.error('[EpisodePlan] 模型分集失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: '大模型分集失败，请重试或检查模型配置'
    })
  }

  const episodesWithCharCount = episodes.map((item) => {
    const charCount = Math.max(0, item.endOffset - item.startOffset)
    return {
      ...item,
      charCount,
      ...(item.episodeAssets ? { episodeAssets: item.episodeAssets } : {})
    }
  })

  return {
    success: true,
    data: {
      episodes: episodesWithCharCount
    }
  }
})
