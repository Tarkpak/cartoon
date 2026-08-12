import { z } from 'zod'

export const ScriptWritingCharacterSchema = z.object({
  id: z.string().trim().default(''),
  name: z.string().trim().min(1),
  role: z.string().trim().default(''),
  profile: z.string().trim().default(''),
  motivation: z.string().trim().default(''),
  arc: z.string().trim().default('')
})
export type ScriptWritingCharacter = z.infer<typeof ScriptWritingCharacterSchema>

export const ScriptStoryBibleSchema = z.object({
  premise: z.string().trim().default(''),
  theme: z.string().trim().default(''),
  world: z.string().trim().default(''),
  tone: z.string().trim().default(''),
  characters: z.array(ScriptWritingCharacterSchema).default([]),
  rules: z.array(z.string().trim()).default([])
})
export type ScriptStoryBible = z.infer<typeof ScriptStoryBibleSchema>

export const ScriptWritingBriefSchema = z.object({
  idea: z.string().default(''),
  genre: z.string().default('现代甜宠·都市情感'),
  customGenre: z.string().default(''),
  audience: z.string().default('短视频用户'),
  customAudience: z.string().default(''),
  episodeCount: z.number().int().min(1).max(100).default(8),
  episodeDuration: z.number().int().min(15).max(1800).default(90),
  requirements: z.string().default(''),
  sourceMaterial: z.string().default(''),
  referenceStyle: z.string().default(''),
  protectedContent: z.string().default('')
})
export type ScriptWritingBrief = z.infer<typeof ScriptWritingBriefSchema>

export const ScriptWritingEpisodeSchema = z.object({
  id: z.string().trim().min(1),
  index: z.number().int().positive(),
  title: z.string().trim().min(1),
  summary: z.string().trim().default(''),
  hook: z.string().trim().default(''),
  beats: z.array(z.string().trim().min(1)).default([]),
  draft: z.string().default(''),
  review: z.string().default(''),
  continuityNotes: z.string().optional(),
  draftSource: z.string().optional()
})
export type ScriptWritingEpisode = z.infer<typeof ScriptWritingEpisodeSchema>

export const ScriptWritingReviewEpisodeNoteSchema = z.object({
  episodeId: z.string().trim().min(1),
  notes: z.string().trim().min(1)
})
export type ScriptWritingReviewEpisodeNote = z.infer<typeof ScriptWritingReviewEpisodeNoteSchema>

export const ScriptWritingReviewTaskSchema = z.object({
  id: z.string().trim().min(1),
  category: z.string().trim().default('综合'),
  severity: z.enum(['high', 'medium', 'low']).default('medium'),
  episodeId: z.string().trim().default(''),
  location: z.string().trim().default(''),
  issue: z.string().trim().min(1),
  suggestion: z.string().trim().min(1)
})
export type ScriptWritingReviewTask = z.infer<typeof ScriptWritingReviewTaskSchema>

export const ScriptWritingReviewSchema = z.object({
  score: z.number().min(0).max(100).default(0),
  summary: z.string().trim().default(''),
  issues: z.array(z.string().trim().min(1)).default([]),
  suggestions: z.array(z.string().trim().min(1)).default([]),
  episodeNotes: z.array(ScriptWritingReviewEpisodeNoteSchema).default([]),
  tasks: z.array(ScriptWritingReviewTaskSchema).optional()
})
export type ScriptWritingReview = z.infer<typeof ScriptWritingReviewSchema>
export const SCRIPT_WRITING_REVIEW_PASS_SCORE = 80

export function ensureScriptWritingReviewTasks(review: ScriptWritingReview): ScriptWritingReviewTask[] {
  if (review.tasks?.length) {
    return review.tasks.map((task, index) => ({
      ...task,
      id: task.id || `review_task_${index + 1}`,
      severity: task.severity || 'medium'
    }))
  }
  const count = Math.max(review.issues.length, review.suggestions.length)
  return Array.from({ length: count }, (_, index) => ({
    id: `review_task_${index + 1}`,
    category: '综合',
    severity: 'medium' as const,
    episodeId: '',
    location: '',
    issue: review.issues[index] || review.suggestions[index] || '待确认问题',
    suggestion: review.suggestions[index] || '请根据审校意见完成修订'
  }))
}

export function resolveScriptWritingReviewProgress(studio: Pick<ScriptWritingStudio, 'review' | 'resolvedReviewItems'>) {
  const tasks = studio.review ? ensureScriptWritingReviewTasks(studio.review) : []
  const isResolved = (task: ScriptWritingReviewTask) => studio.resolvedReviewItems.includes(task.id)
    || studio.resolvedReviewItems.includes(task.issue)
    || studio.resolvedReviewItems.includes(task.suggestion)
  const completed = tasks.filter(isResolved).length
  return {
    tasks,
    completed,
    remaining: tasks.length - completed,
    passed: !!studio.review
      && studio.review.score >= SCRIPT_WRITING_REVIEW_PASS_SCORE
      && tasks.length - completed === 0
  }
}

export const ScriptWritingSnapshotSchema = z.object({
  brief: ScriptWritingBriefSchema.optional(),
  storyBible: ScriptStoryBibleSchema.nullable().default(null),
  episodes: z.array(ScriptWritingEpisodeSchema).default([]),
  review: ScriptWritingReviewSchema.nullable().default(null),
  provenance: z.object({
    storyBibleInput: z.string().default(''),
    outlineInput: z.string().default(''),
    reviewInput: z.string().default('')
  }).optional(),
  resolvedReviewItems: z.array(z.string()).optional(),
  lockedStoryBibleFields: z.array(z.enum([
    'premise',
    'theme',
    'world',
    'tone',
    'characters',
    'rules'
  ])).optional()
})
export type ScriptWritingSnapshot = z.infer<typeof ScriptWritingSnapshotSchema>

export const ScriptWritingVersionKindSchema = z.enum(['protection', 'milestone'])
export type ScriptWritingVersionKind = z.infer<typeof ScriptWritingVersionKindSchema>

export const ScriptWritingVersionSourceSchema = z.enum([
  'brief',
  'bible',
  'outline',
  'episode',
  'review',
  'restore',
  'unknown'
])
export type ScriptWritingVersionSource = z.infer<typeof ScriptWritingVersionSourceSchema>

export const ScriptWritingVersionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  note: z.string().trim().default(''),
  kind: ScriptWritingVersionKindSchema.default('milestone'),
  pinned: z.boolean().default(true),
  source: ScriptWritingVersionSourceSchema.default('unknown'),
  episodeId: z.string().trim().optional(),
  createdAt: z.string().trim().min(1),
  snapshot: ScriptWritingSnapshotSchema
})
export type ScriptWritingVersion = z.infer<typeof ScriptWritingVersionSchema>

export const ScriptWritingStudioSchema = z.object({
  brief: ScriptWritingBriefSchema.default({}),
  storyBible: ScriptStoryBibleSchema.nullable().default(null),
  episodes: z.array(ScriptWritingEpisodeSchema).default([]),
  review: ScriptWritingReviewSchema.nullable().default(null),
  provenance: z.object({
    storyBibleInput: z.string().default(''),
    outlineInput: z.string().default(''),
    reviewInput: z.string().default('')
  }).default({}),
  resolvedReviewItems: z.array(z.string()).default([]),
  lockedStoryBibleFields: z.array(z.enum([
    'premise',
    'theme',
    'world',
    'tone',
    'characters',
    'rules'
  ])).default([]),
  versions: z.array(ScriptWritingVersionSchema).default([]),
  updatedAt: z.string().default('')
})
export type ScriptWritingStudio = z.infer<typeof ScriptWritingStudioSchema>

export type ScriptWritingAction = 'story_bible' | 'outline' | 'episode_draft' | 'review'
export type ScriptWritingLockedField = ScriptWritingStudio['lockedStoryBibleFields'][number]

export function createEmptyScriptWritingStudio(): ScriptWritingStudio {
  return ScriptWritingStudioSchema.parse({})
}

export function ensureScriptWritingCharacterIds(storyBible: ScriptStoryBible): ScriptStoryBible {
  const usedIds = new Set<string>()
  return {
    ...storyBible,
    rules: storyBible.rules.filter(Boolean),
    characters: storyBible.characters.map((character, index) => {
      let id = character.id
      if (!id || usedIds.has(id)) {
        const baseId = `character_${index + 1}`
        id = baseId
        let suffix = 2
        while (usedIds.has(id)) {
          id = `${baseId}_${suffix}`
          suffix += 1
        }
      }
      usedIds.add(id)
      return { ...character, id }
    })
  }
}

export function ensureScriptWritingEpisodeIds(
  episodes: ScriptWritingEpisode[]
): ScriptWritingEpisode[] {
  const usedIds = new Set<string>()
  return [...episodes]
    .sort((a, b) => a.index - b.index)
    .map((episode, position) => {
      const index = position + 1
      let id = episode.id.trim()
      if (!id || usedIds.has(id)) {
        const baseId = `episode_${index}`
        id = baseId
        let suffix = 2
        while (usedIds.has(id)) {
          id = `${baseId}_${suffix}`
          suffix += 1
        }
      }
      usedIds.add(id)
      return { ...episode, id, index }
    })
}

export function normalizeScriptWritingStudio(raw: unknown): ScriptWritingStudio {
  const parsed = ScriptWritingStudioSchema.safeParse(raw)
  if (!parsed.success) return createEmptyScriptWritingStudio()

  const normalized: ScriptWritingStudio = {
    ...parsed.data,
    storyBible: parsed.data.storyBible
      ? ensureScriptWritingCharacterIds(parsed.data.storyBible)
      : null,
    versions: parsed.data.versions.map(version => ({
      ...version,
      snapshot: {
        ...version.snapshot,
        storyBible: version.snapshot.storyBible
          ? ensureScriptWritingCharacterIds(version.snapshot.storyBible)
          : null
      }
      }))
  }
  if (normalized.storyBible && !normalized.provenance.storyBibleInput) {
    normalized.provenance.storyBibleInput = createScriptWritingBriefFingerprint(normalized.brief)
  }
  if (normalized.episodes.length > 0 && !normalized.provenance.outlineInput) {
    normalized.provenance.outlineInput = createScriptWritingOutlineInputFingerprint(normalized)
  }
  normalized.episodes = normalized.episodes.map(episode => ({
    ...episode,
    draftSource: episode.draft.trim() && !episode.draftSource
      ? createScriptWritingDraftInputFingerprint(normalized, episode.id)
      : episode.draftSource
  }))
  if (normalized.review && !normalized.provenance.reviewInput) {
    normalized.provenance.reviewInput = createScriptWritingReviewInputFingerprint(normalized)
  }
  return normalized
}

function cloneWritingData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createScriptWritingSnapshot(studio: ScriptWritingStudio): ScriptWritingSnapshot {
  return {
    brief: cloneWritingData(studio.brief),
    storyBible: studio.storyBible ? cloneWritingData(studio.storyBible) : null,
    episodes: cloneWritingData(studio.episodes),
    review: studio.review ? cloneWritingData(studio.review) : null,
    provenance: cloneWritingData(studio.provenance),
    resolvedReviewItems: cloneWritingData(studio.resolvedReviewItems),
    lockedStoryBibleFields: cloneWritingData(studio.lockedStoryBibleFields)
  }
}

export function serializeScriptWritingContent(studio: ScriptWritingStudio): string {
  return JSON.stringify(createScriptWritingSnapshot(studio))
}

export function appendScriptWritingVersion(
  studio: ScriptWritingStudio,
  label: string,
  optionsOrNow: {
    note?: string
    kind?: ScriptWritingVersionKind
    pinned?: boolean
    source?: ScriptWritingVersionSource
    episodeId?: string
  } | Date = {},
  requestedNow = new Date()
): ScriptWritingStudio {
  const options = optionsOrNow instanceof Date ? {} : optionsOrNow
  const now = optionsOrNow instanceof Date ? optionsOrNow : requestedNow
  const createdAt = now.toISOString()
  const snapshot = createScriptWritingSnapshot(studio)
  const latest = studio.versions[0]
  if (latest && JSON.stringify(latest.snapshot) === JSON.stringify(snapshot)) {
    return studio
  }
  const kind = options.kind || 'milestone'
  const version: ScriptWritingVersion = {
    id: `writing_${createdAt.replace(/\D/g, '')}_${studio.versions.length + 1}`,
    label: label.trim() || (kind === 'milestone' ? '未命名里程碑' : '自动保护版本'),
    note: options.note?.trim() || '',
    kind,
    pinned: options.pinned ?? kind === 'milestone',
    source: options.source || 'unknown',
    episodeId: options.episodeId,
    createdAt,
    snapshot
  }
  let unpinnedCount = 0
  const versions = [version, ...studio.versions].filter((item) => {
    if (item.pinned) return true
    unpinnedCount += 1
    return unpinnedCount <= 100
  })
  return {
    ...studio,
    versions,
    updatedAt: createdAt
  }
}

export function setScriptWritingVersionPinned(
  studio: ScriptWritingStudio,
  versionId: string,
  pinned: boolean
): ScriptWritingStudio {
  if (!studio.versions.some(version => version.id === versionId)) return studio
  return {
    ...studio,
    versions: studio.versions.map(version => version.id === versionId
      ? { ...version, pinned }
      : version),
    updatedAt: new Date().toISOString()
  }
}

export function deleteScriptWritingVersion(
  studio: ScriptWritingStudio,
  versionId: string
): ScriptWritingStudio {
  if (!studio.versions.some(version => version.id === versionId)) return studio
  return {
    ...studio,
    versions: studio.versions.filter(version => version.id !== versionId),
    updatedAt: new Date().toISOString()
  }
}

export type ScriptWritingRestoreScope = 'all' | 'brief' | 'story_bible' | 'outline' | 'episode' | 'review'

export function restoreScriptWritingVersion(
  studio: ScriptWritingStudio,
  versionId: string,
  scope: ScriptWritingRestoreScope = 'all',
  episodeId?: string
): ScriptWritingStudio | null {
  const version = studio.versions.find(item => item.id === versionId)
  if (!version) return null
  const snapshot = version.snapshot
  if (scope === 'brief') {
    if (!snapshot.brief) return null
    return { ...studio, brief: cloneWritingData(snapshot.brief), updatedAt: new Date().toISOString() }
  }
  if (scope === 'story_bible') {
    return {
      ...studio,
      storyBible: cloneWritingData(snapshot.storyBible),
      provenance: {
        ...studio.provenance,
        storyBibleInput: snapshot.provenance?.storyBibleInput || ''
      },
      updatedAt: new Date().toISOString()
    }
  }
  if (scope === 'outline') {
    const currentEpisodes = new Map(studio.episodes.map(episode => [episode.id, episode]))
    const episodes = snapshot.episodes.map((episode) => {
      const current = currentEpisodes.get(episode.id)
      return {
        ...cloneWritingData(episode),
        draft: current?.draft || '',
        review: current?.review || '',
        draftSource: current?.draftSource || ''
      }
    })
    return {
      ...studio,
      episodes,
      provenance: {
        ...studio.provenance,
        outlineInput: snapshot.provenance?.outlineInput || ''
      },
      updatedAt: new Date().toISOString()
    }
  }
  if (scope === 'episode') {
    if (!episodeId) return null
    const snapshotEpisode = snapshot.episodes.find(episode => episode.id === episodeId)
    if (!snapshotEpisode || !studio.episodes.some(episode => episode.id === episodeId)) return null
    return {
      ...studio,
      episodes: studio.episodes.map(episode => episode.id === episodeId
        ? cloneWritingData(snapshotEpisode)
        : episode),
      updatedAt: new Date().toISOString()
    }
  }
  if (scope === 'review') {
    const episodeReviews = new Map(snapshot.episodes.map(episode => [episode.id, episode.review]))
    return {
      ...studio,
      episodes: studio.episodes.map(episode => episodeReviews.has(episode.id)
        ? { ...episode, review: episodeReviews.get(episode.id) || '' }
        : episode),
      review: cloneWritingData(snapshot.review),
      provenance: {
        ...studio.provenance,
        reviewInput: snapshot.provenance?.reviewInput || ''
      },
      resolvedReviewItems: cloneWritingData(snapshot.resolvedReviewItems || []),
      lockedStoryBibleFields: cloneWritingData(snapshot.lockedStoryBibleFields || []),
      updatedAt: new Date().toISOString()
    }
  }
  return {
    ...studio,
    brief: cloneWritingData(snapshot.brief || studio.brief),
    storyBible: cloneWritingData(snapshot.storyBible),
    episodes: cloneWritingData(snapshot.episodes),
    review: cloneWritingData(snapshot.review),
    provenance: cloneWritingData(snapshot.provenance || studio.provenance),
    resolvedReviewItems: cloneWritingData(snapshot.resolvedReviewItems || []),
    lockedStoryBibleFields: cloneWritingData(snapshot.lockedStoryBibleFields || []),
    updatedAt: new Date().toISOString()
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value: unknown): string {
  const text = stableSerialize(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createScriptWritingBriefFingerprint(brief: ScriptWritingBrief): string {
  const {
    customGenre: _customGenre,
    customAudience: _customAudience,
    ...rest
  } = brief
  return fingerprint({
    ...rest,
    genre: resolveScriptWritingGenre(brief),
    audience: resolveScriptWritingAudience(brief)
  })
}

export function resolveScriptWritingGenre(brief: ScriptWritingBrief): string {
  return brief.genre === '其他' && brief.customGenre.trim()
    ? brief.customGenre.trim()
    : brief.genre
}

export function resolveScriptWritingAudience(brief: ScriptWritingBrief): string {
  return brief.audience === '其他' && brief.customAudience.trim()
    ? brief.customAudience.trim()
    : brief.audience
}

export function applyLockedStoryBibleFields(
  current: ScriptStoryBible | null,
  candidate: ScriptStoryBible,
  lockedFields: ScriptWritingLockedField[]
): ScriptStoryBible {
  if (!current || lockedFields.length === 0) return candidate
  const next = cloneWritingData(candidate)
  for (const field of lockedFields) {
    if (field === 'characters') next.characters = cloneWritingData(current.characters)
    else if (field === 'rules') next.rules = cloneWritingData(current.rules)
    else if (field === 'premise') next.premise = current.premise
    else if (field === 'theme') next.theme = current.theme
    else if (field === 'world') next.world = current.world
    else next.tone = current.tone
  }
  return next
}

export function createScriptWritingOutlineInputFingerprint(studio: Pick<ScriptWritingStudio, 'brief' | 'storyBible'>): string {
  return fingerprint({ brief: studio.brief, storyBible: studio.storyBible })
}

export function createScriptWritingDraftInputFingerprint(
  studio: Pick<ScriptWritingStudio, 'brief' | 'storyBible' | 'episodes'>,
  episodeId: string
): string {
  const targetIndex = studio.episodes.find(episode => episode.id === episodeId)?.index || 0
  return fingerprint({
    brief: studio.brief,
    storyBible: studio.storyBible,
    episodes: studio.episodes.map(({
      draft: _draft,
      review: _review,
      draftSource: _draftSource,
      continuityNotes,
      ...episode
    }) => ({
      ...episode,
      continuityNotes: episode.index < targetIndex ? continuityNotes || '' : ''
    })),
    episodeId
  })
}

export function createScriptWritingReviewInputFingerprint(studio: Pick<ScriptWritingStudio, 'episodes'>): string {
  return fingerprint(studio.episodes.map(episode => ({ id: episode.id, index: episode.index, draft: episode.draft })))
}

export function resolveScriptWritingFreshness(studio: ScriptWritingStudio) {
  const storyBibleStale = !!studio.storyBible
    && studio.provenance.storyBibleInput !== createScriptWritingBriefFingerprint(studio.brief)
  const outlineStale = studio.episodes.length > 0
    && studio.provenance.outlineInput !== createScriptWritingOutlineInputFingerprint(studio)
  const staleDraftIds = studio.episodes
    .filter(episode => episode.draft.trim()
      && episode.draftSource !== createScriptWritingDraftInputFingerprint(studio, episode.id))
    .map(episode => episode.id)
  const reviewStale = !!studio.review
    && studio.provenance.reviewInput !== createScriptWritingReviewInputFingerprint(studio)
  return { storyBibleStale, outlineStale, staleDraftIds, reviewStale }
}

export interface ScriptWritingPublicationEpisode {
  id: string
  title: string
  index: number
  startOffset: number
  endOffset: number
  charCount: number
  episodeHook?: string
}

export interface ScriptWritingPublication {
  text: string
  episodes: ScriptWritingPublicationEpisode[]
}

export function resolveScriptWritingPublicationReadiness(studio: ScriptWritingStudio) {
  const freshness = resolveScriptWritingFreshness(studio)
  const reviewProgress = resolveScriptWritingReviewProgress(studio)
  const remainingDraftCount = studio.episodes.filter(episode => !episode.draft.trim()).length
  const blockers = [
    studio.episodes.length === 0 ? '尚未创建分集大纲' : '',
    remainingDraftCount > 0 ? `${remainingDraftCount} 集未成稿` : '',
    freshness.outlineStale ? '分集大纲待确认' : '',
    freshness.staleDraftIds.length > 0 ? `${freshness.staleDraftIds.length} 集正文待确认` : '',
    !studio.review ? '尚未全剧审校' : '',
    studio.review && studio.review.score < SCRIPT_WRITING_REVIEW_PASS_SCORE
      ? `审校分数低于 ${SCRIPT_WRITING_REVIEW_PASS_SCORE}`
      : '',
    studio.review && reviewProgress.remaining > 0 ? `${reviewProgress.remaining} 项整改未完成` : '',
    freshness.reviewStale ? '审校结果已过期' : ''
  ].filter(Boolean)
  return { ready: blockers.length === 0, blockers }
}

export function buildScriptWritingPublication(studio: ScriptWritingStudio): ScriptWritingPublication {
  const drafted = studio.episodes
    .filter(episode => episode.draft.trim())
    .sort((a, b) => a.index - b.index)
  let text = ''
  const episodes = drafted.map((episode) => {
    const section = `第${episode.index}集 ${episode.title}\n\n${episode.draft.trim()}`
    const separator = text ? '\n\n' : ''
    const startOffset = text.length + separator.length
    text += `${separator}${section}`
    return {
      id: episode.id,
      title: episode.title,
      index: episode.index,
      startOffset,
      endOffset: startOffset + section.length,
      charCount: section.length,
      episodeHook: episode.hook || undefined
    }
  })
  return { text, episodes }
}

export function renderScriptWritingText(studio: ScriptWritingStudio): string {
  return buildScriptWritingPublication(studio).text
}
