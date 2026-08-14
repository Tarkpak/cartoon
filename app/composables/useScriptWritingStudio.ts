import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import {
  ScriptStoryBibleSchema,
  ScriptWritingEpisodeSchema,
  ScriptWritingReviewSchema,
  applyLockedStoryBibleFields,
  createScriptWritingBriefFingerprint,
  createScriptWritingDraftInputFingerprint,
  createScriptWritingOutlineInputFingerprint,
  createScriptWritingReviewInputFingerprint,
  createScriptWritingSnapshot,
  ensureScriptWritingReviewTasks,
  ensureScriptWritingCharacterIds,
  ensureScriptWritingEpisodeIds,
  resolveScriptWritingAudience,
  resolveScriptWritingFreshness,
  resolveScriptWritingGenre,
  serializeScriptWritingContent,
  type ScriptWritingAction,
  type ScriptStoryBible,
  type ScriptWritingEpisode,
  type ScriptWritingReview,
  type ScriptWritingStudio
} from '#shared/types/script-writing'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

interface UseScriptWritingStudioOptions {
  projectId?: string
  studio: Ref<ScriptWritingStudio>
  saveProject: () => Promise<boolean>
  loading?: Ref<boolean>
}

type PendingScriptGeneration =
  | { kind: 'story_bible', storyBible: ScriptStoryBible }
  | { kind: 'outline', episodes: ScriptWritingEpisode[] }
  | { kind: 'episode_draft', episodeId: string, draft: string, continuityNotes: string }

const REVIEW_DRAFT_CHAR_BUDGET = 60_000
const REVIEW_CONTINUITY_CHAR_BUDGET = 48_000
const AUTO_SAVE_DELAY_MS = 1000

export function useScriptWritingStudio(options: UseScriptWritingStudioOptions) {
  const activeAction = ref<ScriptWritingAction | null>(null)
  const activeEpisodeId = ref('')
  const isBatchGenerating = ref(false)
  const batchCompleted = ref(0)
  const batchTotal = ref(0)
  const batchEtaSeconds = ref(0)
  const averageEpisodeGenerationSeconds = ref(75)
  const error = ref('')
  const notice = ref('')
  const pendingGeneration = ref<PendingScriptGeneration | null>(null)
  const autoSaveState = ref<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const isBatchPaused = ref(false)
  const isBatchCancellationRequested = ref(false)
  const batchPendingEpisodeIds = ref<string[]>([])
  const batchFailedIndexes = ref<number[]>([])
  let batchStartedAt = 0
  let activeRequestController: AbortController | null = null
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  let lastSavedSnapshot = serializeScriptWritingContent(options.studio.value)

  const isDirty = computed(() => autoSaveState.value === 'dirty' || autoSaveState.value === 'error')

  function buildBriefContext() {
    const brief = options.studio.value.brief
    return {
      ...brief,
      genre: resolveScriptWritingGenre(brief),
      audience: resolveScriptWritingAudience(brief)
    }
  }

  function clearAutoSaveTimer() {
    if (!autoSaveTimer) return
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  function markSaved(savedSnapshot = serializeScriptWritingContent(options.studio.value)) {
    lastSavedSnapshot = savedSnapshot
    if (serializeScriptWritingContent(options.studio.value) === savedSnapshot) {
      autoSaveState.value = 'saved'
    } else {
      autoSaveState.value = 'dirty'
      scheduleAutoSave()
    }
  }

  async function saveCurrent(force = false) {
    clearAutoSaveTimer()
    const currentSnapshot = serializeScriptWritingContent(options.studio.value)
    if (!force && currentSnapshot === lastSavedSnapshot) {
      autoSaveState.value = 'saved'
      return true
    }
    autoSaveState.value = 'saving'
    const saved = await options.saveProject()
    if (saved) markSaved(currentSnapshot)
    else autoSaveState.value = 'error'
    return saved
  }

  function scheduleAutoSave() {
    clearAutoSaveTimer()
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null
      void saveCurrent()
    }, AUTO_SAVE_DELAY_MS)
  }

  watch(
    () => createScriptWritingSnapshot(options.studio.value),
    (snapshot) => {
      if (options.loading?.value) return
      if (JSON.stringify(snapshot) === lastSavedSnapshot) {
        autoSaveState.value = 'saved'
        clearAutoSaveTimer()
        return
      }
      autoSaveState.value = 'dirty'
      scheduleAutoSave()
    },
    { deep: true }
  )

  if (options.loading) {
    watch(options.loading, (loading, previous) => {
      if (!loading && previous) markSaved()
    })
  }

  if (getCurrentInstance()) {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty.value) return
      event.preventDefault()
      event.returnValue = ''
    }
    onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      clearAutoSaveTimer()
      if (isDirty.value) void saveCurrent()
      activeRequestController?.abort()
    })
  }

  async function request(action: ScriptWritingAction, context: Record<string, unknown>) {
    if (activeAction.value) return null
    error.value = ''
    activeAction.value = action
    activeRequestController = new AbortController()
    try {
      const response = await $fetch<{
        success: boolean
        data?: unknown
      }>('/api/script/write', {
        method: 'POST',
        body: {
          action,
          projectId: options.projectId,
          context
        },
        signal: activeRequestController.signal
      })
      if (!response.success || !response.data) throw new Error('模型未返回有效内容')
      return response.data as Record<string, unknown>
    } catch (requestError) {
      if (activeRequestController?.signal.aborted) {
        notice.value = '已停止当前生成任务'
      } else {
        error.value = getDisplayErrorMessage(requestError, '剧本创作失败，请稍后重试')
      }
      return null
    } finally {
      activeRequestController = null
      activeAction.value = null
      activeEpisodeId.value = ''
    }
  }

  function commitStoryBible(storyBible: ScriptStoryBible) {
    const nextStudio = options.studio.value
    options.studio.value = {
      ...nextStudio,
      storyBible: ensureScriptWritingCharacterIds(storyBible),
      review: null,
      provenance: {
        ...nextStudio.provenance,
        storyBibleInput: createScriptWritingBriefFingerprint(nextStudio.brief),
        outlineInput: '',
        reviewInput: ''
      },
      resolvedReviewItems: []
    }
    return saveCurrent(true)
  }

  async function generateStoryBible(preview = false, instruction = '') {
    if (!options.studio.value.brief.idea.trim()) {
      error.value = '请先填写核心创意'
      return false
    }
    notice.value = ''
    const data = await request('story_bible', {
      brief: buildBriefContext(),
      instruction: instruction.trim(),
      lockedFields: options.studio.value.lockedStoryBibleFields,
      currentStoryBible: options.studio.value.storyBible
    })
    if (!data) return false
    const parsed = ScriptStoryBibleSchema.safeParse(data.storyBible)
    if (!parsed.success) {
      error.value = '故事圣经结构不完整，请重新生成'
      return false
    }
    const storyBible = ensureScriptWritingCharacterIds(applyLockedStoryBibleFields(
      options.studio.value.storyBible,
      parsed.data,
      options.studio.value.lockedStoryBibleFields
    ))
    if (preview) {
      pendingGeneration.value = { kind: 'story_bible', storyBible }
      return true
    }
    return commitStoryBible(storyBible)
  }

  function commitOutline(episodes: ScriptWritingEpisode[]) {
    const nextStudio = options.studio.value
    options.studio.value = {
      ...nextStudio,
      episodes: ensureScriptWritingEpisodeIds(episodes).map(episode => ({
        ...episode,
        draft: '',
        review: '',
        draftSource: ''
      })),
      review: null,
      provenance: {
        ...nextStudio.provenance,
        outlineInput: createScriptWritingOutlineInputFingerprint(nextStudio),
        reviewInput: ''
      },
      resolvedReviewItems: []
    }
    return saveCurrent(true)
  }

  async function generateOutline(preview = false, instruction = '') {
    if (!options.studio.value.storyBible) {
      error.value = '请先生成故事圣经'
      return false
    }
    notice.value = ''
    const data = await request('outline', {
      brief: buildBriefContext(),
      storyBible: options.studio.value.storyBible,
      instruction: instruction.trim()
    })
    if (!data) return false
    const parsed = ScriptWritingEpisodeSchema.array().min(1).safeParse(data.episodes)
    if (!parsed.success) {
      error.value = '分集大纲结构不完整，请重新生成'
      return false
    }
    const expectedCount = options.studio.value.brief.episodeCount
    if (parsed.data.length !== expectedCount) {
      notice.value = `模型返回 ${parsed.data.length} 集，与设定的 ${expectedCount} 集不一致，已保留结果，可调整后重新生成`
    }
    if (preview) {
      pendingGeneration.value = { kind: 'outline', episodes: ensureScriptWritingEpisodeIds(parsed.data) }
      return true
    }
    return commitOutline(parsed.data)
  }

  async function commitEpisodeDraft(
    episodeId: string,
    draft: string,
    continuityNotes: string,
    createVersion: boolean
  ) {
    const target = options.studio.value.episodes.find(item => item.id === episodeId)
    if (!target) return false
    const nextStudio = options.studio.value
    const draftSource = createScriptWritingDraftInputFingerprint(nextStudio, episodeId)
    options.studio.value = {
      ...nextStudio,
      episodes: nextStudio.episodes.map(episode => episode.id === episodeId
        ? { ...episode, draft, continuityNotes, draftSource, review: '' }
        : episode),
      provenance: { ...nextStudio.provenance, reviewInput: '' },
      resolvedReviewItems: nextStudio.resolvedReviewItems
    }
    return saveCurrent(createVersion)
  }

  async function generateEpisodeDraft(
    episodeId: string,
    createVersion = true,
    preview = false,
    instruction = ''
  ) {
    const target = options.studio.value.episodes.find(item => item.id === episodeId)
    if (!target || !options.studio.value.storyBible) return false
    activeEpisodeId.value = episodeId
    const previousDrafts = options.studio.value.episodes
      .filter(item => item.index < target.index && item.draft.trim())
      .sort((a, b) => b.index - a.index)
      .slice(0, 2)
      .map(item => ({
        index: item.index,
        title: item.title,
        draft: item.draft.length <= 8_000
          ? item.draft
          : `${item.draft.slice(0, 4_000)}\n...[中段省略]...\n${item.draft.slice(-4_000)}`
      }))
      .reverse()
    const requestStartedAt = Date.now()
    const data = await request('episode_draft', {
      brief: buildBriefContext(),
      storyBible: options.studio.value.storyBible,
      episodes: options.studio.value.episodes.map(({ draft: _draft, review: _review, ...episode }) => episode),
      previousDrafts,
      continuityLedger: options.studio.value.episodes
        .filter(item => item.index < target.index && item.continuityNotes?.trim())
        .map(item => ({ episodeId: item.id, index: item.index, notes: item.continuityNotes })),
      targetEpisode: target,
      instruction: instruction.trim()
    })
    if (!data
      || typeof data.draft !== 'string'
      || !data.draft.trim()
      || (typeof data.episodeId === 'string' && data.episodeId !== episodeId)) {
      if (data) error.value = '单集剧本内容为空，请重新生成'
      return false
    }
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000))
    averageEpisodeGenerationSeconds.value = Math.round(
      averageEpisodeGenerationSeconds.value * 0.6 + elapsedSeconds * 0.4
    )
    const draft = data.draft.trim()
    const continuityNotes = typeof data.continuityNotes === 'string'
      ? data.continuityNotes.trim()
      : target.continuityNotes || ''
    if (preview) {
      pendingGeneration.value = { kind: 'episode_draft', episodeId, draft, continuityNotes }
      return true
    }
    return commitEpisodeDraft(episodeId, draft, continuityNotes, createVersion)
  }

  async function confirmEpisodeDraftCurrent(episodeId: string) {
    const target = options.studio.value.episodes.find(episode => episode.id === episodeId)
    if (!target?.draft.trim()) return false
    const draftSource = createScriptWritingDraftInputFingerprint(options.studio.value, episodeId)
    if (target.draftSource === draftSource) return true
    options.studio.value = {
      ...options.studio.value,
      episodes: options.studio.value.episodes.map(episode => episode.id === episodeId
        ? { ...episode, draftSource }
        : episode)
    }
    return saveCurrent(true)
  }

  async function applyPendingGeneration() {
    const pending = pendingGeneration.value
    if (!pending) return false
    if (pending.kind === 'story_bible') {
      const parsed = ScriptStoryBibleSchema.safeParse(pending.storyBible)
      if (!parsed.success) {
        error.value = '候选故事圣经存在空角色名或无效内容，请修正后再采纳'
        return false
      }
      pendingGeneration.value = null
      return commitStoryBible(parsed.data)
    }
    if (pending.kind === 'outline') {
      const parsed = ScriptWritingEpisodeSchema.array().min(1).safeParse(pending.episodes)
      if (!parsed.success) {
        error.value = '候选大纲至少需要一集，且标题与剧情节拍不能为空'
        return false
      }
      pendingGeneration.value = null
      return commitOutline(parsed.data)
    }
    if (!pending.draft.trim()) {
      error.value = '候选剧本不能为空'
      return false
    }
    pendingGeneration.value = null
    return commitEpisodeDraft(pending.episodeId, pending.draft.trim(), pending.continuityNotes, true)
  }

  function discardPendingGeneration() {
    pendingGeneration.value = null
  }

  async function generateRemainingEpisodeDrafts() {
    if (activeAction.value || isBatchGenerating.value) return false
    const isResume = isBatchPaused.value && batchPendingEpisodeIds.value.length > 0
    const pendingEpisodes = (isResume
      ? batchPendingEpisodeIds.value
          .map(id => options.studio.value.episodes.find(episode => episode.id === id))
          .filter((episode): episode is ScriptWritingEpisode => !!episode)
      : options.studio.value.episodes
          .filter(episode => !episode.draft.trim())
          .sort((a, b) => a.index - b.index))
      .map(episode => ({ id: episode.id, index: episode.index }))
    if (!options.studio.value.storyBible || pendingEpisodes.length === 0) return false

    error.value = ''
    notice.value = ''
    isBatchGenerating.value = true
    isBatchPaused.value = false
    isBatchCancellationRequested.value = false
    batchPendingEpisodeIds.value = pendingEpisodes.map(episode => episode.id)
    if (!isResume) {
      batchCompleted.value = 0
      batchTotal.value = pendingEpisodes.length
      batchEtaSeconds.value = 0
      batchFailedIndexes.value = []
      batchStartedAt = Date.now()
    }
    try {
      for (const episode of pendingEpisodes) {
        if (isBatchCancellationRequested.value || isBatchPaused.value) break
        if (await generateEpisodeDraft(episode.id, false)) {
          batchCompleted.value += 1
          batchPendingEpisodeIds.value = batchPendingEpisodeIds.value.filter(id => id !== episode.id)
          const averageMs = (Date.now() - batchStartedAt) / Math.max(1, batchCompleted.value)
          batchEtaSeconds.value = Math.max(0, Math.round((batchTotal.value - batchCompleted.value) * averageMs / 1000))
        } else {
          batchFailedIndexes.value.push(episode.index)
          batchPendingEpisodeIds.value = batchPendingEpisodeIds.value.filter(id => id !== episode.id)
        }
      }
      if (isBatchCancellationRequested.value) {
        notice.value = `批量生成已停止，已完成 ${batchCompleted.value}/${batchTotal.value} 集`
        batchPendingEpisodeIds.value = []
        isBatchPaused.value = false
        return false
      }
      if (isBatchPaused.value) {
        notice.value = `批量生成已暂停，已完成 ${batchCompleted.value}/${batchTotal.value} 集`
        return false
      }
      if (batchFailedIndexes.value.length > 0) {
        error.value = `第 ${batchFailedIndexes.value.join('、')} 集生成失败，其余已完成，可单独重试失败集`
        batchPendingEpisodeIds.value = []
        isBatchPaused.value = false
        return false
      }
      batchPendingEpisodeIds.value = []
      isBatchPaused.value = false
      return true
    } finally {
      isBatchGenerating.value = false
    }
  }

  function pauseBatchGeneration() {
    if (!isBatchGenerating.value) return
    isBatchPaused.value = true
  }

  function cancelGeneration() {
    isBatchCancellationRequested.value = true
    activeRequestController?.abort()
  }

  function chunkEpisodesForReview<T extends { draft: string }>(episodes: T[]): T[][] {
    const chunks: T[][] = []
    let current: T[] = []
    let currentChars = 0
    for (const episode of episodes) {
      const draftChars = episode.draft.length
      if (current.length > 0 && currentChars + draftChars > REVIEW_DRAFT_CHAR_BUDGET) {
        chunks.push(current)
        current = []
        currentChars = 0
      }
      current.push(episode)
      currentChars += draftChars
    }
    if (current.length > 0) chunks.push(current)
    return chunks
  }

  function mergeReviews(reviews: { review: ScriptWritingReview, episodeCount: number }[]): ScriptWritingReview {
    const totalEpisodes = reviews.reduce((sum, item) => sum + item.episodeCount, 0)
    const score = totalEpisodes > 0
      ? Math.round(reviews.reduce((sum, item) => sum + item.review.score * item.episodeCount, 0) / totalEpisodes)
      : 0
    return {
      score,
      summary: reviews.map(item => item.review.summary).filter(Boolean).join('\n'),
      issues: reviews.flatMap(item => item.review.issues),
      suggestions: reviews.flatMap(item => item.review.suggestions),
      episodeNotes: reviews.flatMap(item => item.review.episodeNotes),
      tasks: reviews.flatMap(item => item.review.tasks || [])
    }
  }

  function buildContinuityReviewEpisodes(episodes: typeof options.studio.value.episodes) {
    const excerptBudget = Math.max(240, Math.floor(REVIEW_CONTINUITY_CHAR_BUDGET / episodes.length))
    return episodes.map((episode) => {
      const half = Math.floor(excerptBudget / 2)
      const excerpt = episode.draft.length <= excerptBudget
        ? episode.draft
        : `${episode.draft.slice(0, half)}\n...[中段省略]...\n${episode.draft.slice(-half)}`
      return { ...episode, draft: excerpt }
    })
  }

  async function reviewDrafts(instruction = '') {
    if (activeAction.value || isBatchGenerating.value) return false
    const draftedEpisodes = options.studio.value.episodes.filter(item => item.draft.trim())
    if (draftedEpisodes.length !== options.studio.value.episodes.length || draftedEpisodes.length === 0) {
      error.value = '请先完成全部分集剧本，再执行全剧审校'
      return false
    }
    const freshness = resolveScriptWritingFreshness(options.studio.value)
    if (freshness.outlineStale || freshness.staleDraftIds.length > 0) {
      error.value = '故事设定或分集大纲已修改，请先更新过期正文，再执行全剧审校'
      return false
    }
    notice.value = ''
    const chunks = chunkEpisodesForReview(draftedEpisodes)
    const chunkReviews: { review: ScriptWritingReview, episodeCount: number }[] = []
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const data = await request('review', {
        brief: buildBriefContext(),
        storyBible: options.studio.value.storyBible,
        episodes: chunk,
        instruction: instruction.trim(),
        reviewScope: chunks.length > 1
          ? {
              chunkIndex: chunkIndex + 1,
              chunkCount: chunks.length,
              episodeRange: `${chunk[0]!.index}-${chunk[chunk.length - 1]!.index}`
            }
          : null
      })
      if (!data) return false
      const parsed = ScriptWritingReviewSchema.safeParse(data.review)
      if (!parsed.success) {
        error.value = '审校结果结构不完整，请重新审校'
        return false
      }
      chunkReviews.push({ review: parsed.data, episodeCount: chunk.length })
    }
    let merged = mergeReviews(chunkReviews)
    if (chunks.length > 1) {
      const continuityData = await request('review', {
        brief: buildBriefContext(),
        storyBible: options.studio.value.storyBible,
        episodes: buildContinuityReviewEpisodes(draftedEpisodes),
        preliminaryReviews: chunkReviews.map(item => item.review),
        instruction: instruction.trim(),
        reviewScope: {
          kind: 'cross_chunk_continuity',
          chunkCount: chunks.length
        }
      })
      if (!continuityData) return false
      const continuityReview = ScriptWritingReviewSchema.safeParse(continuityData.review)
      if (!continuityReview.success) {
        error.value = '跨批连续性复核结果不完整，请重新审校'
        return false
      }
      const continuity = continuityReview.data
      merged = {
        score: continuity.score,
        summary: [merged.summary, continuity.summary].filter(Boolean).join('\n'),
        issues: [...new Set([...merged.issues, ...continuity.issues])],
        suggestions: [...new Set([...merged.suggestions, ...continuity.suggestions])],
        episodeNotes: [...merged.episodeNotes, ...continuity.episodeNotes],
        tasks: [...(merged.tasks || []), ...(continuity.tasks || [])]
          .filter((task, index, items) => items.findIndex(item => item.id === task.id) === index)
      }
      notice.value = `剧本较长，已分 ${chunks.length} 批审校，并完成跨批连续性复核`
    }
    merged.tasks = ensureScriptWritingReviewTasks(merged).map((task, index) => ({
      ...task,
      id: `review_task_${index + 1}`
    }))
    const notesByEpisodeId = new Map(merged.episodeNotes.map(note => [note.episodeId, note.notes]))
    const nextStudio = options.studio.value
    options.studio.value = {
      ...nextStudio,
      episodes: nextStudio.episodes.map(episode => notesByEpisodeId.has(episode.id)
        ? { ...episode, review: notesByEpisodeId.get(episode.id)! }
        : episode),
      review: merged,
      provenance: {
        ...nextStudio.provenance,
        reviewInput: createScriptWritingReviewInputFingerprint(nextStudio)
      },
      resolvedReviewItems: []
    }
    return saveCurrent(true)
  }

  // Kept for callers compiled against the former versions API. Version actions are no longer part of the studio UI.
  async function createMilestone(..._args: unknown[]) { return { created: false, saved: true } }
  async function restoreVersion(..._args: unknown[]) { return false }
  async function setVersionPinned(..._args: unknown[]) { return false }
  async function deleteVersion(..._args: unknown[]) { return false }

  return {
    activeAction,
    activeEpisodeId,
    isBatchGenerating,
    batchCompleted,
    batchTotal,
    batchEtaSeconds,
    averageEpisodeGenerationSeconds,
    isBatchPaused,
    autoSaveState,
    isDirty,
    error,
    notice,
    pendingGeneration,
    generateStoryBible,
    generateOutline,
    generateEpisodeDraft,
    confirmEpisodeDraftCurrent,
    generateRemainingEpisodeDrafts,
    applyPendingGeneration,
    discardPendingGeneration,
    pauseBatchGeneration,
    cancelGeneration,
    saveCurrent,
    reviewDrafts,
    createMilestone,
    restoreVersion,
    setVersionPinned,
    deleteVersion
  }
}
