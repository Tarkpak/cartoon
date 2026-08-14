<script setup lang="ts">
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  Download,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Ellipsis,
  FileText,
  Focus,
  ListPlus,
  ListTree,
  Lock,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Shrink,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock
} from 'lucide-vue-next'
import {
  buildScriptWritingPublication,
  createScriptWritingBriefFingerprint,
  createScriptWritingDraftInputFingerprint,
  createScriptWritingOutlineInputFingerprint,
  resolveScriptWritingFreshness,
  resolveScriptWritingPublicationReadiness,
  resolveScriptWritingReviewProgress,
  SCRIPT_WRITING_REVIEW_PASS_SCORE,
  type ScriptWritingPublication,
  type ScriptWritingLockedField,
  type ScriptWritingReviewTask,
  type ScriptWritingStudio
} from '#shared/types/script-writing'
import { useScriptWritingStudio } from '~/composables/useScriptWritingStudio'
import { diffScriptWritingLines } from '~/lib/script-writing-diff'
import {
  buildScriptWritingDocx,
  buildScriptWritingExportFileName,
  buildScriptWritingExportText,
  downloadScriptWritingBlob
} from '~/lib/script-writing-export'

const studio = defineModel<ScriptWritingStudio>({ required: true })
const props = defineProps<{
  projectId?: string
  documentTitle?: string
  saveProject: () => Promise<boolean>
  loading?: boolean
}>()
const emit = defineEmits<{
  publish: [publication: ScriptWritingPublication]
  openProduction: []
  openList: []
}>()

type WritingView = 'bible' | 'episodes' | 'review'

const activeView = ref<WritingView>('bible')
const selectedEpisodeId = ref('')
const exportingDocx = ref(false)
const storyBibleInstruction = ref('')
const outlineInstruction = ref('')
const episodeInstruction = ref('')
const reviewInstruction = ref('')
const pendingReviewTaskId = ref('')
const episodeMetaOpen = ref(false)
const episodeInstructionOpen = ref(false)
const focusMode = ref(false)
const searchPanelOpen = ref(false)
const draftSearchText = ref('')
const draftReplaceText = ref('')
const draftSearchCursor = ref(0)
const replaceUndo = ref<{ episodeId: string, draft: string } | null>(null)
const generationElapsedSeconds = ref(0)
let generationElapsedTimer: ReturnType<typeof setInterval> | null = null
const { toast } = useToast()
const {
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
} = useScriptWritingStudio({
  projectId: props.projectId,
  studio,
  saveProject: props.saveProject,
  loading: toRef(props, 'loading')
})

defineExpose({
  saveCurrent: () => saveCurrent(true)
})

const selectedEpisode = computed(() => {
  return studio.value.episodes.find(item => item.id === selectedEpisodeId.value)
    || studio.value.episodes[0]
    || null
})
const draftedCount = computed(() => studio.value.episodes.filter(item => item.draft.trim()).length)
const remainingDraftCount = computed(() => studio.value.episodes.length - draftedCount.value)
const publication = computed(() => buildScriptWritingPublication(studio.value))
const isBusy = computed(() => activeAction.value !== null || isBatchGenerating.value)
const freshness = computed(() => resolveScriptWritingFreshness(studio.value))
const isComplete = computed(() => studio.value.episodes.length > 0 && remainingDraftCount.value === 0)
const hasStaleDrafts = computed(() => freshness.value.staleDraftIds.length > 0)
const publicationReadiness = computed(() => resolveScriptWritingPublicationReadiness(studio.value))
const canPublish = computed(() => publicationReadiness.value.ready && !!publication.value.text)
const publicationBlockers = computed(() => publicationReadiness.value.blockers)
const selectedEpisodeStats = computed(() => {
  const draft = selectedEpisode.value?.draft.trim() || ''
  const characters = draft.replace(/\s/g, '').length
  const estimatedSeconds = Math.max(0, Math.round(characters / 4.2))
  const sceneCount = (draft.match(/^(?:第?[一二三四五六七八九十百千万\d]+[\.、 ]*)?(?:场|场景)\b/gm) || []).length
  return { characters, estimatedSeconds, sceneCount }
})
const reviewProgress = computed(() => resolveScriptWritingReviewProgress(studio.value))
const estimatedBatchSeconds = computed(() => Math.max(30, remainingDraftCount.value * averageEpisodeGenerationSeconds.value))
const draftSearchMatchCount = computed(() => {
  if (!selectedEpisode.value || !draftSearchText.value) return 0
  return selectedEpisode.value.draft.split(draftSearchText.value).length - 1
})
const activeActionLabel = computed(() => {
  if (activeAction.value === 'story_bible') return '生成故事圣经'
  if (activeAction.value === 'outline') return '生成分集大纲'
  if (activeAction.value === 'review') return '执行全剧审校'
  if (activeAction.value === 'episode_draft') {
    const episode = studio.value.episodes.find(item => item.id === activeEpisodeId.value)
    return episode ? `生成第 ${episode.index} 集正文` : '生成分集正文'
  }
  return ''
})
const episodeCount = computed(() => studio.value.episodes.length || studio.value.brief.episodeCount || 0)
const selectedEpisodeOutlineSummary = computed(() => {
  const episode = selectedEpisode.value
  if (!episode) return '尚未填写大纲'
  const hook = episode.hook.trim()
  const parts = [
    episode.title.trim() || '未命名',
    hook ? (hook.length > 24 ? `${hook.slice(0, 24)}…` : hook) : '未写钩子',
    episode.beats.length ? `${episode.beats.length} 个节拍` : '未写节拍'
  ]
  return parts.join(' · ')
})
const autoSaveLabel = computed(() => ({
  saved: '已自动保存',
  dirty: '有未保存修改',
  saving: '保存中',
  error: '自动保存失败'
}[autoSaveState.value]))
const autoSaveTone = computed(() => ({
  saved: 'bg-emerald-500',
  dirty: 'bg-amber-500',
  saving: 'bg-primary animate-pulse',
  error: 'bg-destructive'
}[autoSaveState.value]))
const storyRulesText = computed({
  get: () => studio.value.storyBible?.rules.join('\n') || '',
  set: (value: string) => {
    if (!studio.value.storyBible) return
    studio.value.storyBible.rules = value.split('\n')
  }
})

const views = computed(() => [
  { key: 'bible' as const, label: '故事圣经', done: !!studio.value.storyBible, stale: freshness.value.storyBibleStale },
  { key: 'episodes' as const, label: isComplete.value ? '分集创作' : `分集创作 ${draftedCount.value}/${studio.value.episodes.length}`, done: isComplete.value, stale: freshness.value.outlineStale || hasStaleDrafts.value },
  { key: 'review' as const, label: '全剧审校', done: !!studio.value.review, stale: freshness.value.reviewStale },
])

async function createBible() {
  const preview = !!studio.value.storyBible
  if (studio.value.storyBible) {
    const confirmed = await useConfirm().confirm({
      title: '重新生成故事圣经',
      description: '新结果会先作为候选稿展示。采用后才会替换当前故事圣经，并使现有分集大纲和剧本标记为需要更新。',
      confirmText: '生成候选稿'
    })
    if (!confirmed) return
  }
  if (await generateStoryBible(preview, storyBibleInstruction.value) && !preview) activeView.value = 'bible'
}

async function createOutline() {
  const preview = studio.value.episodes.length > 0
  if (studio.value.episodes.length > 0) {
    const confirmed = await useConfirm().confirm({
      title: '重新生成分集大纲',
      description: '新大纲会先作为候选稿展示。采用后才会替换当前分集并清空已有单集正文，旧内容会保留在保护版本中。',
      confirmText: '生成候选稿',
      variant: 'destructive'
    })
    if (!confirmed) return
  }
  if (await generateOutline(preview, outlineInstruction.value) && !preview) {
    selectedEpisodeId.value = studio.value.episodes[0]?.id || ''
    activeView.value = 'episodes'
  }
}


async function regenerateEpisode() {
  if (!selectedEpisode.value) return
  if (selectedEpisode.value.draft.trim()) {
    const confirmed = await useConfirm().confirm({
      title: `重写第 ${selectedEpisode.value.index} 集`,
      description: '新正文会替换当前人工修改内容。系统会先创建可恢复版本。',
      confirmText: '继续重写',
      variant: 'destructive'
    })
    if (!confirmed) return
  }
  await generateEpisodeDraft(
    selectedEpisode.value.id,
    true,
    !!selectedEpisode.value.draft.trim(),
    episodeInstruction.value
  )
}

async function publishStudio(allowDraft = false) {
  if (canPublish.value) {
    emit('publish', publication.value)
    return
  }
  if (!publication.value.text) return
  if (!allowDraft) return
  const confirmed = await useConfirm().confirm({
    title: '发布未通过质检的草稿',
    description: `${publicationBlockers.value.join('；')}。草稿仍会替换当前生产剧本，并可能清空已有解析结果。`,
    confirmText: '发布草稿',
    variant: 'destructive'
  })
  if (confirmed) emit('publish', publication.value)
}

async function copyCurrentScript() {
  if (!publication.value.text) return
  try {
    await navigator.clipboard.writeText(buildScriptWritingExportText(studio.value))
    toast.success('完整剧本已复制')
  } catch {
    toast.error('复制失败，请检查剪贴板权限')
  }
}

function exportCurrentScriptTxt() {
  if (!publication.value.text) return
  const title = props.documentTitle?.trim() || studio.value.brief.idea.trim().slice(0, 30) || 'AI创作剧本'
  const blob = new Blob([buildScriptWritingExportText(studio.value)], { type: 'text/plain;charset=utf-8' })
  const fileName = buildScriptWritingExportFileName(title, 'txt')
  downloadScriptWritingBlob(blob, fileName)
  toast.success('TXT 剧本已导出', { description: fileName })
}

async function exportCurrentScriptDocx() {
  if (!publication.value.text || exportingDocx.value) return
  exportingDocx.value = true
  const title = props.documentTitle?.trim() || studio.value.brief.idea.trim().slice(0, 30) || 'AI创作剧本'
  try {
    const blob = await buildScriptWritingDocx(studio.value, title)
    const fileName = buildScriptWritingExportFileName(title, 'docx')
    downloadScriptWritingBlob(blob, fileName)
    toast.success('DOCX 剧本已导出', { description: fileName })
  } catch (exportError) {
    toast.error(exportError instanceof Error ? exportError.message : 'DOCX 剧本导出失败')
  } finally {
    exportingDocx.value = false
  }
}

function addCharacter() {
  if (!studio.value.storyBible) return
  studio.value.storyBible.characters.push({
    id: `character_${Date.now()}`,
    name: '新角色',
    role: '',
    profile: '',
    motivation: '',
    arc: ''
  })
}

async function removeCharacter(index: number) {
  if (!studio.value.storyBible) return
  const character = studio.value.storyBible.characters[index]
  if (!character) return
  const confirmed = await useConfirm().confirm({
    title: '删除角色',
    description: `将从故事圣经中删除“${character.name}”。已有大纲和正文会标记为需要更新。`,
    confirmText: '删除',
    variant: 'destructive'
  })
  if (confirmed) studio.value.storyBible.characters.splice(index, 1)
}

function moveCharacter(index: number, direction: -1 | 1) {
  if (!studio.value.storyBible) return
  const target = index + direction
  if (target < 0 || target >= studio.value.storyBible.characters.length) return
  const [character] = studio.value.storyBible.characters.splice(index, 1)
  if (character) studio.value.storyBible.characters.splice(target, 0, character)
}

function reindexEpisodes() {
  studio.value.episodes.forEach((episode, index) => { episode.index = index + 1 })
}

function addEpisode() {
  const index = studio.value.episodes.length + 1
  studio.value.episodes.push({
    id: `episode_${Date.now()}`,
    index,
    title: `第 ${index} 集`,
    summary: '',
    hook: '',
    beats: [],
    draft: '',
    review: '',
    draftSource: ''
  })
  studio.value.brief.episodeCount = studio.value.episodes.length
  selectedEpisodeId.value = studio.value.episodes.at(-1)?.id || ''
}

async function removeEpisode(index: number) {
  const episode = studio.value.episodes[index]
  if (!episode) return
  const confirmed = await useConfirm().confirm({
    title: `删除第 ${episode.index} 集`,
    description: episode.draft.trim() ? '该集已有正文，删除后只能通过版本历史恢复。' : '该集大纲将被删除。',
    confirmText: '删除',
    variant: 'destructive'
  })
  if (!confirmed) return
  studio.value.episodes.splice(index, 1)
  reindexEpisodes()
  studio.value.brief.episodeCount = Math.max(1, studio.value.episodes.length)
  selectedEpisodeId.value = studio.value.episodes[Math.min(index, studio.value.episodes.length - 1)]?.id || ''
}

function moveEpisode(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= studio.value.episodes.length) return
  const [episode] = studio.value.episodes.splice(index, 1)
  if (episode) studio.value.episodes.splice(target, 0, episode)
  reindexEpisodes()
}

function beatsText(episodeId: string) {
  return studio.value.episodes.find(item => item.id === episodeId)?.beats.join('\n') || ''
}

function updateBeats(episodeId: string, value: string) {
  const episode = studio.value.episodes.find(item => item.id === episodeId)
  if (!episode) return
  episode.beats = value.split('\n').map(item => item.trim()).filter(Boolean)
}

function updateEpisodeDraft(episodeId: string, value: string) {
  const episode = studio.value.episodes.find(item => item.id === episodeId)
  if (!episode) return
  const wasStale = freshness.value.staleDraftIds.includes(episodeId)
  episode.draft = value
  if (!value.trim()) episode.draftSource = ''
  else if (!wasStale) episode.draftSource = createScriptWritingDraftInputFingerprint(studio.value, episodeId)
}

async function confirmSelectedEpisodeCurrent() {
  if (!selectedEpisode.value) return
  if (await confirmEpisodeDraftCurrent(selectedEpisode.value.id)) {
    toast.success(`第 ${selectedEpisode.value.index} 集已确认适配当前大纲`)
  }
}

async function startBatchGeneration() {
  if (isBatchPaused.value) {
    await generateRemainingEpisodeDrafts()
    return
  }
  if (remainingDraftCount.value >= 3) {
    const confirmed = await useConfirm().confirm({
      title: `批量生成 ${remainingDraftCount.value} 集正文`,
      description: `将依次发起 ${remainingDraftCount.value} 次模型请求，预计${formatEta(estimatedBatchSeconds.value)}。可随时暂停或停止，已完成内容会保留。`,
      confirmText: '开始批量生成'
    })
    if (!confirmed) return
  }
  await generateRemainingEpisodeDrafts()
}

function rememberDraftForUndo() {
  if (!selectedEpisode.value) return
  replaceUndo.value = { episodeId: selectedEpisode.value.id, draft: selectedEpisode.value.draft }
}

function replaceNextInSelectedDraft() {
  if (!selectedEpisode.value || !draftSearchText.value) return
  const draft = selectedEpisode.value.draft
  let matchIndex = draft.indexOf(draftSearchText.value, draftSearchCursor.value)
  if (matchIndex < 0 && draftSearchCursor.value > 0) matchIndex = draft.indexOf(draftSearchText.value)
  if (matchIndex < 0) {
    toast.info('当前正文中没有匹配内容')
    return
  }
  rememberDraftForUndo()
  const nextDraft = `${draft.slice(0, matchIndex)}${draftReplaceText.value}${draft.slice(matchIndex + draftSearchText.value.length)}`
  updateEpisodeDraft(selectedEpisode.value.id, nextDraft)
  draftSearchCursor.value = matchIndex + draftReplaceText.value.length
}

async function replaceAllInSelectedDraft() {
  if (!selectedEpisode.value || !draftSearchText.value) return
  const matches = draftSearchMatchCount.value
  if (matches === 0) {
    toast.info('当前正文中没有匹配内容')
    return
  }
  const confirmed = await useConfirm().confirm({
    title: `替换全部 ${matches} 处内容`,
    description: `将把“${draftSearchText.value}”全部替换为“${draftReplaceText.value || '空内容'}”。完成后可撤销本次替换。`,
    confirmText: '全部替换'
  })
  if (!confirmed) return
  rememberDraftForUndo()
  updateEpisodeDraft(
    selectedEpisode.value.id,
    selectedEpisode.value.draft.split(draftSearchText.value).join(draftReplaceText.value)
  )
  draftSearchCursor.value = 0
  toast.success(`已替换 ${matches} 处`)
}

function undoDraftReplace() {
  const undo = replaceUndo.value
  if (!undo) return
  const episode = studio.value.episodes.find(item => item.id === undo.episodeId)
  if (!episode) return
  updateEpisodeDraft(episode.id, undo.draft)
  replaceUndo.value = null
  draftSearchCursor.value = 0
  toast.success('已撤销上次替换')
}

function reviewTaskResolved(task: ScriptWritingReviewTask) {
  return studio.value.resolvedReviewItems.includes(task.id)
    || studio.value.resolvedReviewItems.includes(task.issue)
    || studio.value.resolvedReviewItems.includes(task.suggestion)
}

function toggleReviewTask(task: ScriptWritingReviewTask) {
  const taskKeys = new Set([task.id, task.issue, task.suggestion])
  if (reviewTaskResolved(task)) {
    const unresolvedItems = studio.value.resolvedReviewItems.filter(item => !taskKeys.has(item))
    studio.value.resolvedReviewItems.splice(0, studio.value.resolvedReviewItems.length, ...unresolvedItems)
    return
  }
  studio.value.resolvedReviewItems.push(task.id)
}

function toggleStoryBibleLock(field: ScriptWritingLockedField) {
  const index = studio.value.lockedStoryBibleFields.indexOf(field)
  if (index >= 0) studio.value.lockedStoryBibleFields.splice(index, 1)
  else studio.value.lockedStoryBibleFields.push(field)
}

function storyBibleFieldLocked(field: ScriptWritingLockedField) {
  return studio.value.lockedStoryBibleFields.includes(field)
}

async function fixReviewTask(task: ScriptWritingReviewTask) {
  if (!task.episodeId || !studio.value.episodes.some(episode => episode.id === task.episodeId)) {
    toast.info('这是全局问题，请先选择需要修改的分集')
    return
  }
  selectedEpisodeId.value = task.episodeId
  episodeInstruction.value = [
    `落实审校任务：${task.issue}`,
    task.location ? `定位：${task.location}` : '',
    `修改建议：${task.suggestion}`,
    '保留未涉及的问题和已有有效内容。'
  ].filter(Boolean).join('\n')
  episodeInstructionOpen.value = true
  activeView.value = 'episodes'
  pendingReviewTaskId.value = task.id
  await nextTick()
  await generateEpisodeDraft(task.episodeId, true, true, episodeInstruction.value)
}

function confirmStoryBibleCurrent() {
  studio.value.provenance.storyBibleInput = createScriptWritingBriefFingerprint(studio.value.brief)
}

function confirmOutlineCurrent() {
  studio.value.provenance.outlineInput = createScriptWritingOutlineInputFingerprint(studio.value)
}

function openEpisodeFromReview(episodeId: string) {
  if (!studio.value.episodes.some(episode => episode.id === episodeId)) return
  selectedEpisodeId.value = episodeId
  activeView.value = 'episodes'
}

const pendingGenerationSummary = computed(() => {
  const pending = pendingGeneration.value
  if (!pending) return null
  if (pending.kind === 'story_bible') {
    return {
      title: '故事圣经候选稿',
      current: studio.value.storyBible?.premise || '无现有内容',
      candidate: pending.storyBible.premise || '未提供核心命题',
      detail: `候选稿包含 ${pending.storyBible.characters.length} 位角色、${pending.storyBible.rules.length} 条创作规则`
    }
  }
  if (pending.kind === 'outline') {
    return {
      title: '分集大纲候选稿',
      current: `当前 ${studio.value.episodes.length} 集，已成稿 ${draftedCount.value} 集`,
      candidate: `候选稿 ${pending.episodes.length} 集`,
      detail: pending.episodes.slice(0, 4).map(episode => `${episode.index}. ${episode.title}`).join('；')
    }
  }
  const current = studio.value.episodes.find(episode => episode.id === pending.episodeId)?.draft || ''
  return {
    title: '单集重写候选稿',
    current: `当前正文 ${current.length} 字`,
    candidate: `候选正文 ${pending.draft.length} 字`,
    detail: pending.draft.slice(0, 160)
  }
})
const pendingGenerationChanges = computed(() => {
  const pending = pendingGeneration.value
  if (!pending) return []
  if (pending.kind === 'story_bible') {
    const current = studio.value.storyBible
    if (!current) return ['新增完整故事圣经']
    const labels: Array<[keyof Pick<typeof current, 'premise' | 'theme' | 'world' | 'tone'>, string]> = [
      ['premise', '核心命题'], ['theme', '主题'], ['world', '世界设定'], ['tone', '基调']
    ]
    const changes = labels.filter(([key]) => current[key] !== pending.storyBible[key]).map(([, label]) => label)
    if (current.characters.length !== pending.storyBible.characters.length) changes.push(`角色 ${current.characters.length} → ${pending.storyBible.characters.length}`)
    if (current.rules.length !== pending.storyBible.rules.length) changes.push(`规则 ${current.rules.length} → ${pending.storyBible.rules.length}`)
    return changes
  }
  if (pending.kind === 'outline') {
    const currentById = new Map(studio.value.episodes.map(episode => [episode.id, episode]))
    const candidateIds = new Set(pending.episodes.map(episode => episode.id))
    const added = pending.episodes.filter(episode => !currentById.has(episode.id)).length
    const removed = studio.value.episodes.filter(episode => !candidateIds.has(episode.id)).length
    const changed = pending.episodes.filter((episode) => {
      const current = currentById.get(episode.id)
      return current && (current.title !== episode.title || current.summary !== episode.summary
        || current.hook !== episode.hook || JSON.stringify(current.beats) !== JSON.stringify(episode.beats)
      )
    }).length
    return [
      `集数 ${studio.value.episodes.length} → ${pending.episodes.length}`,
      added ? `新增 ${added} 集` : '',
      removed ? `删除 ${removed} 集` : '',
      changed ? `修改 ${changed} 集` : ''
    ].filter(Boolean)
  }
  const current = studio.value.episodes.find(episode => episode.id === pending.episodeId)?.draft || ''
  const delta = pending.draft.length - current.length
  return [`正文 ${current.length} → ${pending.draft.length} 字`, `字数变化 ${delta >= 0 ? '+' : ''}${delta}`]
})
const pendingDraftDiff = computed(() => {
  const pending = pendingGeneration.value
  if (pending?.kind !== 'episode_draft') return []
  const current = studio.value.episodes.find(episode => episode.id === pending.episodeId)?.draft || ''
  return diffScriptWritingLines(current, pending.draft)
})

async function acceptPendingGeneration() {
  const pending = pendingGeneration.value
  if (!pending) return
  if (await applyPendingGeneration()) {
    if (pendingReviewTaskId.value) {
      if (!studio.value.resolvedReviewItems.includes(pendingReviewTaskId.value)) {
        studio.value.resolvedReviewItems.push(pendingReviewTaskId.value)
      }
      pendingReviewTaskId.value = ''
      await saveCurrent(true)
    }
    if (pending.kind === 'story_bible') activeView.value = 'bible'
    if (pending.kind === 'outline') {
      selectedEpisodeId.value = studio.value.episodes[0]?.id || ''
      activeView.value = 'episodes'
    }
  }
}

function discardCandidate() {
  pendingReviewTaskId.value = ''
  discardPendingGeneration()
}

const pendingCurrentContent = computed(() => {
  const pending = pendingGeneration.value
  if (!pending) return ''
  if (pending.kind === 'story_bible') {
    return studio.value.storyBible ? JSON.stringify(studio.value.storyBible, null, 2) : '无现有内容'
  }
  if (pending.kind === 'outline') {
    return studio.value.episodes.map(episode => [
      `第 ${episode.index} 集 ${episode.title}`,
      episode.summary,
      `结尾钩子：${episode.hook}`,
      ...episode.beats.map(beat => `- ${beat}`)
    ].filter(Boolean).join('\n')).join('\n\n') || '无现有内容'
  }
  return studio.value.episodes.find(episode => episode.id === pending.episodeId)?.draft || '无现有内容'
})

const pendingCandidateContent = computed({
  get: () => {
    const pending = pendingGeneration.value
    if (!pending) return ''
    if (pending.kind === 'story_bible') return JSON.stringify(pending.storyBible, null, 2)
    if (pending.kind === 'outline') {
      return pending.episodes.map(episode => [
        `第 ${episode.index} 集 ${episode.title}`,
        episode.summary,
        `结尾钩子：${episode.hook}`,
        ...episode.beats.map(beat => `- ${beat}`)
      ].filter(Boolean).join('\n')).join('\n\n')
    }
    return pending.draft
  },
  set: (value: string) => {
    const pending = pendingGeneration.value
    if (pending?.kind === 'episode_draft') pending.draft = value
  }
})

function updatePendingStoryBibleField(field: 'premise' | 'theme' | 'world' | 'tone', value: string) {
  const pending = pendingGeneration.value
  if (pending?.kind === 'story_bible') pending.storyBible[field] = value
}

function updatePendingStoryRules(value: string) {
  const pending = pendingGeneration.value
  if (pending?.kind !== 'story_bible') return
  pending.storyBible.rules = value.split('\n').map(item => item.trim()).filter(Boolean)
}

function updatePendingEpisodeField(
  episodeId: string,
  field: 'title' | 'summary' | 'hook' | 'beats',
  value: string
) {
  const pending = pendingGeneration.value
  if (pending?.kind !== 'outline') return
  const episode = pending.episodes.find(item => item.id === episodeId)
  if (!episode) return
  if (field === 'beats') episode.beats = value.split('\n').map(item => item.trim()).filter(Boolean)
  else episode[field] = value
}

function removePendingCharacter(characterId: string) {
  const pending = pendingGeneration.value
  if (pending?.kind !== 'story_bible') return
  pending.storyBible.characters = pending.storyBible.characters.filter(character => character.id !== characterId)
}

function removePendingEpisode(episodeId: string) {
  const pending = pendingGeneration.value
  if (pending?.kind !== 'outline') return
  pending.episodes = pending.episodes
    .filter(episode => episode.id !== episodeId)
    .map((episode, index) => ({ ...episode, index: index + 1 }))
}

function formatEta(seconds: number) {
  if (seconds <= 0) return '计算中'
  if (seconds < 60) return `约 ${seconds} 秒`
  return `约 ${Math.ceil(seconds / 60)} 分钟`
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

watch(activeAction, (action) => {
  if (generationElapsedTimer) {
    clearInterval(generationElapsedTimer)
    generationElapsedTimer = null
  }
  generationElapsedSeconds.value = 0
  if (!action) return
  generationElapsedTimer = setInterval(() => {
    generationElapsedSeconds.value += 1
  }, 1000)
})

onBeforeUnmount(() => {
  if (generationElapsedTimer) clearInterval(generationElapsedTimer)
})

watch(
  () => selectedEpisode.value?.id,
  () => {
    episodeMetaOpen.value = false
  }
)

function formatVersionTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent"
    :class="focusMode
      ? 'fixed inset-2 z-50 rounded-2xl bg-background shadow-2xl'
      : ''"
  >
    <header
      v-if="!focusMode"
      class="flex h-10 shrink-0 items-center justify-between gap-3 px-2"
    >
      <div class="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          title="返回项目总览"
          aria-label="返回项目总览"
          @click="emit('openList')"
        >
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <h1
          class="truncate text-sm font-semibold tracking-tight"
          :title="documentTitle || '未命名项目'"
        >
          {{ documentTitle || '未命名项目' }}
        </h1>
        <span class="hidden h-3 w-px shrink-0 bg-border sm:block" />
        <span class="hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span class="tabular-nums">{{ draftedCount }}/{{ episodeCount }} 成稿</span>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="autoSaveTone" />
            {{ autoSaveLabel }}
          </span>
        </span>
      </div>
    </header>

    <div
      class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
      :class="focusMode ? 'grid-cols-1' : 'md:grid-cols-[200px_minmax(0,1fr)]'"
    >
    <aside
      v-if="!focusMode"
      class="flex min-h-0 flex-col overflow-hidden bg-muted/20"
    >
      <nav class="min-h-0 flex-1 space-y-0.5 overflow-x-auto overflow-y-auto p-2 md:block">
        <button
          v-for="(item, index) in views"
          :key="item.key"
          type="button"
          class="group flex w-auto min-w-[8.5rem] shrink-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[0.98] md:w-full"
          :class="activeView === item.key
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'"
          @click="activeView = item.key"
        >
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums"
            :class="activeView === item.key
              ? 'bg-primary text-primary-foreground'
              : item.done
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground'"
          >
            <Check v-if="item.done && !item.stale" class="h-3.5 w-3.5" :stroke-width="2.25" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ item.label }}</span>
          <CircleAlert v-if="item.stale" class="h-3.5 w-3.5 shrink-0 text-amber-600" :stroke-width="2" />
        </button>
      </nav>

      <div class="mt-auto space-y-2 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              class="w-full justify-between gap-2"
              size="sm"
              :disabled="!publication.text || isBusy || exportingDocx"
            >
              <span class="inline-flex items-center gap-2">
                <Loader2 v-if="exportingDocx" class="h-4 w-4 animate-spin" />
                <Download v-else class="h-4 w-4" />
                {{ exportingDocx ? '正在导出' : '导出剧本' }}
              </span>
              <ChevronDown v-if="!exportingDocx" class="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-48">
            <DropdownMenuItem @select="copyCurrentScript"><Copy />复制完整剧本</DropdownMenuItem>
            <DropdownMenuItem @select="exportCurrentScriptTxt"><Type />导出 TXT</DropdownMenuItem>
            <DropdownMenuItem @select="exportCurrentScriptDocx"><FileText />导出 DOCX</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          class="w-full gap-2"
          size="sm"
          :disabled="!canPublish || isBusy"
          @click="publishStudio()"
        >
          <Send class="h-4 w-4" />
          发布并进入解析
        </Button>
        <p v-if="publicationBlockers.length" class="px-1 text-center text-[11px] leading-4 text-muted-foreground">
          {{ publicationBlockers.join(' · ') }}
        </p>
        <Button
          v-if="publication.text && !canPublish"
          variant="ghost"
          size="sm"
          class="w-full text-xs text-muted-foreground hover:text-destructive"
          :disabled="isBusy"
          @click="publishStudio(true)"
        >
          发布草稿版本
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="w-full text-xs text-muted-foreground"
          :disabled="isBusy"
          @click="emit('openProduction')"
        >
          查看当前解析
        </Button>
      </div>
    </aside>

    <main class="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        v-if="error"
        class="shrink-0 bg-destructive/5 px-5 py-2.5 text-sm text-destructive"
      >
        {{ error }}
      </div>
      <div
        v-if="notice"
        class="shrink-0 bg-amber-500/5 px-5 py-2.5 text-sm text-amber-700 dark:text-amber-300"
      >
        {{ notice }}
      </div>
      <div
        v-if="freshness.storyBibleStale || freshness.outlineStale || hasStaleDrafts || freshness.reviewStale"
        class="flex shrink-0 items-center gap-2 bg-amber-500/5 px-5 py-2.5 text-sm text-amber-700 dark:text-amber-300"
      >
        <CircleAlert class="h-4 w-4 shrink-0" />
        上游内容已修改：带橙色标记的步骤需要重新确认或生成。
      </div>
      <div
        v-if="activeAction && !isBatchGenerating"
        class="flex shrink-0 items-center justify-between gap-3 bg-muted/30 px-5 py-2.5 text-sm"
        aria-live="polite"
      >
        <span class="flex min-w-0 items-center gap-2">
          <Loader2 class="h-4 w-4 shrink-0 animate-spin" />
          <span class="truncate">{{ activeActionLabel }}</span>
          <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
            已用 {{ formatElapsed(generationElapsedSeconds) }}
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          class="h-8 gap-2 text-destructive transition-transform active:scale-[0.96]"
          @click="cancelGeneration"
        >
          <Square class="h-3.5 w-3.5" />
          停止生成
        </Button>
      </div>

      <!-- Story bible setup is completed in the new-project dialog. -->
      <section
        v-if="activeView === 'bible' && !studio.storyBible"
        class="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-5 text-center sm:p-6"
      >
        <div class="max-w-xl">
          <h2 class="text-xl font-semibold tracking-tight">等待生成故事圣经</h2>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            项目基础信息已在新建时保存。确认无误后，即可生成故事圣经并进入后续创作。
          </p>
          <p v-if="!studio.brief.idea.trim()" class="mt-3 text-sm text-destructive">
            当前项目缺少核心创意，请返回项目总览后新建项目。
          </p>
        </div>
        <Button
          class="gap-2"
          :disabled="isBusy || !studio.brief.idea.trim()"
          @click="createBible"
        >
          <Loader2 v-if="activeAction === 'story_bible'" class="h-4 w-4 animate-spin" />
          <Sparkles v-else class="h-4 w-4" />
          生成故事圣经
        </Button>
      </section>

      <!-- Story bible editor -->
      <section
        v-else-if="activeView === 'bible'"
        class="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain p-5 sm:p-6"
      >
        <header class="flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-xl font-semibold tracking-tight">故事圣经</h2>
            <p
              v-if="freshness.storyBibleStale"
              class="mt-1 text-xs text-amber-700 dark:text-amber-300"
            >
              项目基础信息已变更，请重新生成或确认当前故事圣经。
            </p>
            <p v-else class="mt-1 text-sm text-muted-foreground">
              锁定关键设定后，重新生成会尽量保留这些内容。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="freshness.storyBibleStale"
              variant="outline"
              @click="confirmStoryBibleCurrent"
            >
              确认已调整
            </Button>
            <Button
              variant="outline"
              class="gap-2"
              :disabled="isBusy"
              @click="createBible"
            >
              <Loader2 v-if="activeAction === 'story_bible'" class="h-4 w-4 animate-spin" />
              <Sparkles v-else class="h-4 w-4" />
              重新生成
            </Button>
            <Button
              class="gap-2"
              :disabled="isBusy"
              @click="createOutline"
            >
              <Loader2 v-if="activeAction === 'outline'" class="h-4 w-4 animate-spin" />
              <ListTree v-else class="h-4 w-4" />
              生成分集大纲
            </Button>
          </div>
        </header>

        <div class="mt-5 shrink-0 rounded-2xl bg-muted/20 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span class="font-medium text-foreground">项目简报</span>
                <span>类型：{{ studio.brief.genre || '未设置' }}</span>
                <span>受众：{{ studio.brief.audience || '未设置' }}</span>
                <span class="tabular-nums">{{ studio.brief.episodeCount }} 集 · {{ studio.brief.episodeDuration }} 秒/集</span>
              </div>
              <p class="mt-2 line-clamp-2 text-sm text-foreground">
                {{ studio.brief.idea || '尚未填写核心创意' }}
              </p>
            </div>
          </div>
        </div>

        <template v-if="studio.storyBible">
          <div class="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div
              v-for="field in ([['premise', '核心命题'], ['theme', '主题'], ['world', '世界设定'], ['tone', '基调']] as const)"
              :key="field[0]"
              class="space-y-2 rounded-2xl bg-muted/25 p-4"
            >
              <div class="flex items-center justify-between gap-2">
                <label class="text-sm font-medium">{{ field[1] }}</label>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-7 w-7"
                  :title="storyBibleFieldLocked(field[0]) ? '解除锁定' : '锁定该内容'"
                  @click="toggleStoryBibleLock(field[0])"
                >
                  <Lock v-if="storyBibleFieldLocked(field[0])" class="h-3.5 w-3.5 text-primary" />
                  <Unlock v-else class="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
              <Textarea
                v-model="studio.storyBible[field[0]]"
                class="min-h-24 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 [field-sizing:content]"
              />
            </div>
          </div>

          <div class="mt-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold">角色</h3>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-7 w-7"
                  :title="storyBibleFieldLocked('characters') ? '解除角色锁定' : '锁定全部角色'"
                  @click="toggleStoryBibleLock('characters')"
                >
                  <Lock v-if="storyBibleFieldLocked('characters')" class="h-3.5 w-3.5 text-primary" />
                  <Unlock v-else class="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs tabular-nums text-muted-foreground">
                  {{ studio.storyBible.characters.length }} 位
                </span>
                <Button size="sm" variant="outline" class="h-8 gap-1.5" @click="addCharacter">
                  <Plus class="h-3.5 w-3.5" />
                  新增角色
                </Button>
              </div>
            </div>

            <div class="mt-3 space-y-3">
              <div
                v-for="(character, index) in studio.storyBible.characters"
                :key="character.id || `character_${index}`"
                class="rounded-2xl bg-muted/25 p-4"
              >
                <div class="mb-3 flex items-center justify-between gap-2">
                  <p class="text-xs font-medium tabular-nums text-muted-foreground">
                    角色 {{ index + 1 }}
                  </p>
                  <div class="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      class="h-7 w-7"
                      :disabled="index === 0"
                      title="上移角色"
                      @click="moveCharacter(index, -1)"
                    >
                      <ChevronUp class="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      class="h-7 w-7"
                      :disabled="index === studio.storyBible.characters.length - 1"
                      title="下移角色"
                      @click="moveCharacter(index, 1)"
                    >
                      <ChevronDown class="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      class="h-7 w-7 text-destructive"
                      title="删除角色"
                      @click="removeCharacter(index)"
                    >
                      <Trash2 class="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">角色名</label>
                    <Input v-model="character.name" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">角色定位</label>
                    <Textarea v-model="character.role" class="min-h-9 [field-sizing:content]" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">角色小传</label>
                    <Textarea v-model="character.profile" class="min-h-24 [field-sizing:content]" />
                  </div>
                  <div class="space-y-2">
                    <label class="text-xs font-medium text-muted-foreground">核心动机</label>
                    <Textarea v-model="character.motivation" class="min-h-24 [field-sizing:content]" />
                  </div>
                  <div class="space-y-2 xl:col-span-2">
                    <label class="text-xs font-medium text-muted-foreground">人物成长弧</label>
                    <Textarea v-model="character.arc" class="min-h-20 [field-sizing:content]" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-6 space-y-2 rounded-2xl bg-muted/25 p-4">
            <div class="flex items-center justify-between">
              <label class="text-sm font-semibold">创作规则</label>
              <Button
                size="icon"
                variant="ghost"
                class="h-7 w-7"
                :title="storyBibleFieldLocked('rules') ? '解除规则锁定' : '锁定创作规则'"
                @click="toggleStoryBibleLock('rules')"
              >
                <Lock v-if="storyBibleFieldLocked('rules')" class="h-3.5 w-3.5 text-primary" />
                <Unlock v-else class="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
            <Textarea
              v-model="storyRulesText"
              class="min-h-28 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 [field-sizing:content]"
              placeholder="每行一条规则"
            />
          </div>

          <div class="mt-6 space-y-2">
            <label class="text-sm font-semibold">
              本次大纲要求
              <span class="font-normal text-muted-foreground">可选</span>
            </label>
            <Textarea
              v-model="outlineInstruction"
              rows="2"
              placeholder="例如：第 3 集提前揭露假线索，第 6 集完成第一次反转"
            />
          </div>

        </template>
      </section>

      <!-- Episodes -->
      <section
        v-else-if="activeView === 'episodes'"
        class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1"
      >
        <div class="flex min-h-0 flex-col bg-muted/10">
          <div class="flex h-10 shrink-0 items-center justify-between px-2.5">
            <span class="text-xs font-medium text-muted-foreground">分集</span>
            <Button size="icon" variant="ghost" class="h-7 w-7" title="新增分集" @click="addEpisode">
              <Plus class="h-3.5 w-3.5" />
            </Button>
          </div>
          <div class="flex min-h-0 gap-1 overflow-x-auto p-1.5 overscroll-contain lg:block lg:overflow-x-hidden lg:overflow-y-auto">
            <div
              v-for="(episode, episodeIndex) in studio.episodes"
              :key="episode.id"
              class="group mb-0.5 flex w-52 shrink-0 items-center rounded-lg transition-colors lg:w-full"
              :class="selectedEpisode?.id === episode.id
                ? 'bg-background shadow-sm'
                : 'hover:bg-background/70'"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
                @click="selectedEpisodeId = episode.id"
              >
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="episode.draft.trim() ? 'bg-emerald-500' : 'bg-muted-foreground/30'"
                />
                <span class="w-4 shrink-0 text-[11px] tabular-nums text-muted-foreground">{{ episode.index }}</span>
                <span
                  class="min-w-0 truncate text-sm"
                  :class="selectedEpisode?.id === episode.id ? 'font-medium text-foreground' : 'text-foreground/80'"
                >
                  {{ episode.title }}
                </span>
                <CircleAlert
                  v-if="freshness.staleDraftIds.includes(episode.id)"
                  class="h-3.5 w-3.5 shrink-0 text-amber-600"
                />
              </button>
              <div class="mr-0.5 hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-7 w-7"
                  :disabled="episodeIndex === 0"
                  title="上移分集"
                  @click="moveEpisode(episodeIndex, -1)"
                >
                  <ChevronUp class="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-7 w-7"
                  :disabled="episodeIndex === studio.episodes.length - 1"
                  title="下移分集"
                  @click="moveEpisode(episodeIndex, 1)"
                >
                  <ChevronDown class="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  class="h-7 w-7 text-destructive"
                  title="删除分集"
                  @click="removeEpisode(episodeIndex)"
                >
                  <Trash2 class="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="selectedEpisode"
          class="flex min-h-0 min-w-0 flex-col overflow-hidden"
        >
          <header class="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-1">
            <h2 class="min-w-0 truncate text-sm font-semibold tracking-tight">
              <span class="font-normal text-muted-foreground">第 {{ selectedEpisode.index }} 集</span>
              {{ selectedEpisode.title }}
            </h2>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                class="h-8 gap-1.5 px-2"
                :class="episodeMetaOpen ? 'bg-muted text-foreground' : 'text-muted-foreground'"
                @click="episodeMetaOpen = !episodeMetaOpen"
              >
                <ListTree class="h-3.5 w-3.5" />
                大纲
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-8 gap-1.5 px-2"
                :class="episodeInstructionOpen || episodeInstruction.trim() ? 'bg-muted text-foreground' : 'text-muted-foreground'"
                @click="episodeInstructionOpen = !episodeInstructionOpen"
              >
                要求
                <span
                  v-if="episodeInstruction.trim()"
                  class="h-1.5 w-1.5 rounded-full bg-primary"
                />
              </Button>
              <template v-if="isBatchGenerating">
                <Button size="sm" variant="outline" class="h-8 gap-1.5" @click="pauseBatchGeneration">
                  <Pause class="h-3.5 w-3.5" />暂停
                </Button>
                <Button size="sm" variant="outline" class="h-8 gap-1.5 text-destructive" @click="cancelGeneration">
                  <Square class="h-3.5 w-3.5" />停止
                </Button>
              </template>
              <Button
                v-else
                size="sm"
                variant="outline"
                class="h-8 gap-1.5 transition-transform active:scale-[0.96]"
                :disabled="isBusy || (remainingDraftCount === 0 && !isBatchPaused)"
                :title="remainingDraftCount > 0 ? `将发起 ${remainingDraftCount} 次请求，参考耗时${formatEta(estimatedBatchSeconds)}` : undefined"
                @click="startBatchGeneration"
              >
                <Play v-if="isBatchPaused" class="h-3.5 w-3.5" />
                <ListPlus v-else class="h-3.5 w-3.5" />
                {{ isBatchPaused ? `继续 ${batchCompleted}/${batchTotal}` : `批量（${remainingDraftCount}）` }}
              </Button>
              <Button
                size="sm"
                class="h-8 gap-1.5 transition-transform active:scale-[0.96]"
                :disabled="isBusy"
                @click="regenerateEpisode"
              >
                <Loader2 v-if="activeEpisodeId === selectedEpisode.id" class="h-3.5 w-3.5 animate-spin" />
                <Sparkles v-else class="h-3.5 w-3.5" />
                {{ selectedEpisode.draft.trim() ? '重新生成' : '生成本集' }}
              </Button>
            </div>
          </header>

          <div
            v-if="freshness.outlineStale"
            class="flex shrink-0 items-center justify-between gap-3 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
          >
            <span>故事圣经已变更，请逐集调整大纲或重新生成。</span>
            <Button size="sm" variant="outline" class="h-7 shrink-0" @click="confirmOutlineCurrent">
              确认大纲已调整
            </Button>
          </div>

          <div v-if="isBatchGenerating" class="shrink-0 space-y-1.5 px-3 py-2" aria-live="polite">
            <div class="flex justify-between text-xs text-muted-foreground">
              <span>剩余 {{ batchTotal - batchCompleted }} 次模型请求</span>
              <span>{{ formatEta(batchEtaSeconds) }}</span>
            </div>
            <Progress :model-value="batchTotal ? (batchCompleted / batchTotal) * 100 : 0" class="h-1.5" />
          </div>

          <div
            v-if="selectedEpisode.review"
            class="shrink-0 bg-muted/40 px-3 py-2 text-sm"
          >
            <p class="mb-0.5 text-xs text-muted-foreground">本集审校意见</p>
            {{ selectedEpisode.review }}
          </div>

          <div
            v-if="freshness.staleDraftIds.includes(selectedEpisode.id)"
            class="flex shrink-0 flex-col gap-2 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>本集正文基于旧的大纲或故事设定。人工修改不会自动解除该状态。</span>
            <Button size="sm" variant="outline" class="h-7 shrink-0" @click="confirmSelectedEpisodeCurrent">
              确认已适配当前大纲
            </Button>
          </div>

          <div
            v-if="episodeMetaOpen"
            class="shrink-0 max-h-[42%] overflow-y-auto bg-muted/15 px-3 py-3"
          >
            <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">标题</label>
                <Input v-model="selectedEpisode.title" />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-muted-foreground">结尾钩子</label>
                <Textarea v-model="selectedEpisode.hook" class="min-h-9 [field-sizing:content]" />
              </div>
              <div class="space-y-1.5 sm:col-span-2">
                <label class="text-xs font-medium text-muted-foreground">本集梗概</label>
                <Textarea v-model="selectedEpisode.summary" class="min-h-16 [field-sizing:content]" />
              </div>
              <div class="space-y-1.5 sm:col-span-2">
                <label class="text-xs font-medium text-muted-foreground">剧情节拍</label>
                <Textarea
                  :model-value="beatsText(selectedEpisode.id)"
                  class="min-h-16 [field-sizing:content]"
                  placeholder="每行一个可拍摄事件"
                  @update:model-value="updateBeats(selectedEpisode.id, String($event))"
                />
              </div>
              <div class="space-y-1.5 sm:col-span-2">
                <label class="text-xs font-medium text-muted-foreground">连续性账本</label>
                <Textarea
                  v-model="selectedEpisode.continuityNotes"
                  rows="2"
                  placeholder="记录本集结束时的人物状态、时间地点、关键道具和未回收伏笔"
                />
              </div>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="flex shrink-0 items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/30"
            @click="episodeMetaOpen = true"
          >
            <ListTree class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ selectedEpisodeOutlineSummary }}</span>
          </button>

          <div v-if="episodeInstructionOpen" class="shrink-0 px-3 pb-2">
            <Textarea
              v-model="episodeInstruction"
              rows="2"
              placeholder="例如：保留前三场，只压缩对白并强化结尾反转"
            />
          </div>

          <div
            v-if="searchPanelOpen"
            class="grid shrink-0 grid-cols-1 gap-2 px-3 pb-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Input v-model="draftSearchText" placeholder="查找内容" />
            <Input v-model="draftReplaceText" placeholder="替换为" />
            <div class="flex items-center justify-end gap-1">
              <span class="mr-1 whitespace-nowrap text-xs text-muted-foreground">
                {{ draftSearchMatchCount }} 处
              </span>
              <Button size="sm" variant="outline" :disabled="!draftSearchMatchCount" @click="replaceNextInSelectedDraft">
                替换下一处
              </Button>
              <Button size="sm" variant="outline" :disabled="!draftSearchMatchCount" @click="replaceAllInSelectedDraft">
                全部替换
              </Button>
              <Button
                v-if="replaceUndo"
                size="icon"
                variant="ghost"
                title="撤销上次替换"
                @click="undoDraftReplace"
              >
                <Undo2 class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div class="relative min-h-0 flex-1 px-3 pb-1">
            <Textarea
              :model-value="selectedEpisode.draft"
              class="absolute inset-0 h-full min-h-0 resize-none border-0 bg-muted/25 font-mono leading-7 shadow-none focus-visible:ring-0"
              placeholder="生成或编辑本集剧本"
              @update:model-value="updateEpisodeDraft(selectedEpisode.id, String($event))"
            />
          </div>

          <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs text-muted-foreground">
            <span class="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
              <span>{{ selectedEpisodeStats.characters }} 字</span>
              <span v-if="selectedEpisodeStats.characters">
                预计 {{ formatEta(selectedEpisodeStats.estimatedSeconds) }} / 目标 {{ formatEta(studio.brief.episodeDuration) }}
              </span>
              <span v-else>尚无正文</span>
              <span v-if="selectedEpisodeStats.sceneCount">{{ selectedEpisodeStats.sceneCount }} 场</span>
            </span>
            <span class="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                class="h-7 gap-1.5 px-2 text-xs"
                title="查找替换"
                @click="searchPanelOpen = !searchPanelOpen"
              >
                <Search class="h-3.5 w-3.5" />
                查找替换
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-7 gap-1.5 px-2 text-xs"
                :title="focusMode ? '退出专注模式' : '进入专注模式'"
                @click="focusMode = !focusMode"
              >
                <Shrink v-if="focusMode" class="h-3.5 w-3.5" />
                <Focus v-else class="h-3.5 w-3.5" />
                {{ focusMode ? '退出专注' : '专注写作' }}
              </Button>
            </span>
          </div>
        </div>

        <div
          v-else
          class="flex min-h-64 flex-col items-center justify-center text-muted-foreground lg:col-span-2"
        >
          <FileText class="mb-3 h-8 w-8" :stroke-width="1.5" />
          <p class="mb-3 text-sm">还没有分集大纲</p>
          <Button variant="outline" @click="activeView = 'bible'">创建分集大纲</Button>
        </div>
      </section>

      <!-- Review -->
      <section
        v-else-if="activeView === 'review'"
        class="mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-5 overflow-y-auto p-5 sm:p-6"
      >
        <header class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold tracking-tight">全剧审校</h2>
            <p class="mt-1.5 text-sm leading-6 text-muted-foreground">
              全部分集须成稿且基于当前设定；长剧会额外复核跨批连续性。
            </p>
          </div>
          <Button
            class="shrink-0 gap-2"
            :disabled="isBusy || !isComplete || freshness.outlineStale || hasStaleDrafts"
            @click="reviewDrafts(reviewInstruction)"
          >
            <Loader2 v-if="activeAction === 'review'" class="h-4 w-4 animate-spin" />
            <CheckCircle2 v-else class="h-4 w-4" />
            开始审校
          </Button>
        </header>

        <div class="space-y-2">
          <label class="text-sm font-medium">
            本次审校重点
            <span class="font-normal text-muted-foreground">可选</span>
          </label>
          <Textarea
            v-model="reviewInstruction"
            rows="2"
            placeholder="例如：重点检查第 4-6 集时间线和母亲遗物的流转"
          />
        </div>

        <template v-if="studio.review">
          <div class="rounded-2xl bg-muted/25 p-5">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div class="flex items-end gap-2">
                <span class="text-5xl font-semibold tracking-tight tabular-nums">{{ studio.review.score }}</span>
                <span class="pb-1 text-sm text-muted-foreground">/ 100</span>
              </div>
              <div class="min-w-0 flex-1 pb-1">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge
                    :variant="reviewProgress.passed ? 'success' : 'warning'"
                    class="rounded-md"
                  >
                    {{ reviewProgress.passed ? '质检通过' : '待整改' }}
                  </Badge>
                  <span class="text-xs tabular-nums text-muted-foreground">
                    整改 {{ reviewProgress.completed }}/{{ reviewProgress.tasks.length }} · 通过线 {{ SCRIPT_WRITING_REVIEW_PASS_SCORE }} 分
                  </span>
                </div>
                <p class="mt-2 text-sm leading-6">{{ studio.review.summary }}</p>
              </div>
            </div>
          </div>

          <div
            v-if="studio.review.issues.length || studio.review.suggestions.length"
            class="rounded-2xl bg-muted/20 p-4"
          >
            <h3 class="text-sm font-semibold">审校摘要</h3>
            <ul class="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li v-for="issue in studio.review.issues" :key="issue">问题：{{ issue }}</li>
              <li v-for="suggestion in studio.review.suggestions" :key="suggestion">建议：{{ suggestion }}</li>
            </ul>
          </div>

          <div v-if="studio.review.episodeNotes.length">
            <h3 class="mb-2 text-sm font-semibold">分集意见</h3>
            <div class="divide-y divide-border/20 overflow-hidden rounded-2xl bg-muted/15">
              <button
                v-for="note in studio.review.episodeNotes"
                :key="note.episodeId"
                type="button"
                class="flex w-full items-center gap-3 bg-card/40 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
                @click="openEpisodeFromReview(note.episodeId)"
              >
                <span class="min-w-0 flex-1">{{ note.notes }}</span>
                <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div v-if="reviewProgress.tasks.length">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold">整改任务</h3>
              <span class="text-xs tabular-nums text-muted-foreground">剩余 {{ reviewProgress.remaining }} 项</span>
            </div>
            <div class="space-y-3">
              <article
                v-for="task in reviewProgress.tasks"
                :key="task.id"
                class="flex items-start gap-3 rounded-2xl bg-muted/20 p-4"
              >
                <Checkbox
                  :model-value="reviewTaskResolved(task)"
                  class="mt-1"
                  @update:model-value="toggleReviewTask(task)"
                />
                <div class="min-w-0 flex-1" :class="reviewTaskResolved(task) ? 'opacity-60' : ''">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge
                      :variant="task.severity === 'high' ? 'destructive' : task.severity === 'medium' ? 'warning' : 'outline'"
                      class="rounded-md"
                    >
                      {{ task.severity === 'high' ? '严重' : task.severity === 'medium' ? '一般' : '轻微' }}
                    </Badge>
                    <Badge variant="outline" class="rounded-md">{{ task.category }}</Badge>
                    <span v-if="task.location" class="text-xs text-muted-foreground">{{ task.location }}</span>
                  </div>
                  <p class="mt-2 text-sm font-medium">{{ task.issue }}</p>
                  <p class="mt-1 text-sm text-muted-foreground">{{ task.suggestion }}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  class="shrink-0 gap-1.5 transition-transform active:scale-[0.96]"
                  :disabled="isBusy || !task.episodeId"
                  @click="fixReviewTask(task)"
                >
                  <Sparkles class="h-3.5 w-3.5" />
                  AI 修订
                </Button>
              </article>
            </div>
          </div>

          <div
            v-if="reviewProgress.remaining === 0 && studio.review.score < SCRIPT_WRITING_REVIEW_PASS_SCORE"
            class="flex flex-col gap-3 rounded-xl border-l-2 border-amber-500/50 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>整改已标记完成，但当前分数仍未达到通过线，请重新审校确认结果。</span>
            <Button size="sm" variant="outline" :disabled="isBusy" @click="reviewDrafts(reviewInstruction)">
              重新审校
            </Button>
          </div>
        </template>

        <div
          v-else
          class="flex min-h-56 flex-col items-center justify-center rounded-2xl bg-muted/15 px-6 text-center text-muted-foreground"
        >
          <CheckCircle2 class="mb-3 h-8 w-8" :stroke-width="1.5" />
          <p class="text-sm font-medium text-foreground">尚未执行全剧审校</p>
          <p class="mt-1 max-w-sm text-sm leading-6">
            完成全部 {{ studio.episodes.length }} 集正文后，可检查人物、因果、伏笔和节奏。
          </p>
        </div>
      </section>

      <section v-else class="flex min-h-0 w-full flex-1 items-center justify-center">
        <p class="text-sm text-muted-foreground">请选择创作步骤</p>
      </section>
      <!-- History removed -->
      <!--
        <header class="flex shrink-0 flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 class="text-xl font-semibold tracking-tight">版本与恢复</h2>
            <p class="mt-1.5 text-sm text-muted-foreground">
              当前内容自动保存；关键操作前创建保护版本。固定版本不会被自动清理。
            </p>
          </div>
          <Button
            variant="outline"
            class="gap-2 transition-transform active:scale-[0.96]"
            :disabled="isBusy"
            @click="openMilestoneDialog"
          >
            <FileClock class="h-4 w-4" />
            创建里程碑
          </Button>
        </header>

        <div
          v-if="studio.versions.length"
          class="grid min-h-0 flex-1 md:grid-cols-[minmax(18rem,0.9fr)_minmax(22rem,1.1fr)]"
        >
          <div class="min-h-0 space-y-1 overflow-y-auto p-3 ">
            <article
              v-for="version in studio.versions"
              :key="version.id"
              class="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/50"
              :class="selectedVersionId === version.id ? 'bg-primary/8' : ''"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-start gap-3 text-left"
                @click="selectedVersionId = version.id"
              >
                <ShieldCheck
                  v-if="version.kind === 'protection'"
                  class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  :stroke-width="1.75"
                />
                <FileClock
                  v-else
                  class="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  :stroke-width="1.75"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-1.5">
                    <span class="truncate text-sm font-medium">{{ version.label }}</span>
                    <Badge variant="outline" class="rounded-md px-1.5 py-0 text-[10px] font-medium">
                      {{ version.kind === 'milestone' ? '里程碑' : '保护版本' }}
                    </Badge>
                    <Pin v-if="version.pinned" class="h-3 w-3 text-primary" fill="currentColor" />
                  </span>
                  <span v-if="version.note" class="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                    {{ version.note }}
                  </span>
                  <span class="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{{ versionSourceLabel(version.source) }}</span>
                    <span class="tabular-nums">{{ formatVersionTime(version.createdAt) }}</span>
                  </span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-7 w-7 shrink-0 opacity-70 transition-opacity active:scale-[0.96] sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    :aria-label="`${version.label}操作`"
                  >
                    <Ellipsis class="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @select="toggleVersionPinned(version.id, !version.pinned)">
                    <PinOff v-if="version.pinned" />
                    <Pin v-else />
                    {{ version.pinned ? '取消固定' : '固定版本' }}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive @select="removeVersion(version.id)">
                    <Trash2 />删除版本
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </article>
          </div>

          <aside v-if="selectedVersion" class="min-h-0 overflow-y-auto p-5 text-sm">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs text-muted-foreground">{{ versionSourceLabel(selectedVersion.source) }}</p>
                <h3 class="mt-1 truncate font-semibold">{{ selectedVersion.label }}</h3>
                <p v-if="selectedVersion.note" class="mt-1 text-sm text-muted-foreground">
                  {{ selectedVersion.note }}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                class="h-8 w-8 shrink-0 transition-transform active:scale-[0.96]"
                title="复制版本内容"
                @click="copySelectedVersion"
              >
                <Copy class="h-4 w-4" />
              </Button>
            </div>

            <dl class="mt-5 grid grid-cols-3 gap-3 rounded-2xl bg-muted/20 px-4 py-4 text-muted-foreground">
              <div>
                <dt class="text-xs">角色</dt>
                <dd class="mt-1 font-medium tabular-nums text-foreground">
                  {{ selectedVersion.snapshot.storyBible?.characters.length || 0 }} 位
                </dd>
              </div>
              <div>
                <dt class="text-xs">分集</dt>
                <dd class="mt-1 font-medium tabular-nums text-foreground">
                  {{ selectedVersion.snapshot.episodes.length }} 集
                </dd>
              </div>
              <div>
                <dt class="text-xs">已成稿</dt>
                <dd class="mt-1 font-medium tabular-nums text-foreground">
                  {{ selectedVersion.snapshot.episodes.filter(item => item.draft.trim()).length }} 集
                </dd>
              </div>
            </dl>

            <div class="mt-4">
              <p class="text-xs font-medium text-muted-foreground">版本内容预览</p>
              <div class="mt-2 space-y-3 rounded-2xl bg-muted/35 p-4">
                <div>
                  <p class="text-[11px] text-muted-foreground">核心创意</p>
                  <p class="mt-0.5 line-clamp-3 text-sm">
                    {{ selectedVersion.snapshot.brief?.idea || '未记录' }}
                  </p>
                </div>
                <div v-if="selectedVersion.snapshot.storyBible">
                  <p class="text-[11px] text-muted-foreground">核心命题</p>
                  <p class="mt-0.5 line-clamp-3 text-sm">
                    {{ selectedVersion.snapshot.storyBible.premise || '未记录' }}
                  </p>
                </div>
                <div v-if="selectedVersion.snapshot.episodes.length">
                  <p class="text-[11px] text-muted-foreground">分集</p>
                  <p class="mt-0.5 line-clamp-3 text-sm">
                    {{ selectedVersion.snapshot.episodes.slice(0, 5).map(item => `${item.index}. ${item.title}`).join('；') }}{{ selectedVersion.snapshot.episodes.length > 5 ? '…' : '' }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-4">
              <p class="text-xs font-medium text-muted-foreground">相对当前内容</p>
              <p v-if="!hasSelectedVersionChanges" class="mt-2 text-sm text-foreground">内容一致</p>
              <div v-else class="mt-2 space-y-2 text-sm">
                <p v-if="selectedVersionChanges.brief.length">
                  <span class="text-muted-foreground">项目基础信息：</span>{{ selectedVersionChanges.brief.join('、') }}
                </p>
                <p v-if="selectedVersionChanges.characters.length">
                  <span class="text-muted-foreground">故事圣经：</span>{{ selectedVersionChanges.characters.join('、') }}
                </p>
                <div v-if="selectedVersionChanges.episodes.length">
                  <p class="text-muted-foreground">分集变化：</p>
                  <ul class="mt-1 space-y-1">
                    <li v-for="change in selectedVersionChanges.episodes" :key="change">{{ change }}</li>
                  </ul>
                </div>
                <p v-if="selectedVersionChanges.review">
                  <span class="text-muted-foreground">审校：</span>{{ selectedVersionChanges.review }}
                </p>
              </div>
            </div>

            <div class="mt-5 pt-4">
              <p class="mb-2 text-xs font-medium text-muted-foreground">恢复范围</p>
              <div class="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-start gap-2 transition-transform active:scale-[0.96]"
                  :disabled="!selectedVersion.snapshot.brief || isBusy"
                  @click="applyVersion('brief')"
                >
                  <RotateCcw class="h-3.5 w-3.5" />项目基础信息
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-start gap-2 transition-transform active:scale-[0.96]"
                  :disabled="isBusy"
                  @click="applyVersion('story_bible')"
                >
                  <RotateCcw class="h-3.5 w-3.5" />故事圣经
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-start gap-2 transition-transform active:scale-[0.96]"
                  :disabled="!selectedVersion.snapshot.episodes.length || isBusy"
                  @click="applyVersion('outline')"
                >
                  <RotateCcw class="h-3.5 w-3.5" />分集大纲
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-start gap-2 transition-transform active:scale-[0.96]"
                  :disabled="!selectedEpisode || !selectedVersion.snapshot.episodes.some(item => item.id === selectedEpisode?.id) || isBusy"
                  @click="applyVersion('episode')"
                >
                  <RotateCcw class="h-3.5 w-3.5" />当前第 {{ selectedEpisode?.index || '-' }} 集
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="justify-start gap-2 transition-transform active:scale-[0.96]"
                  :disabled="!selectedVersion.snapshot.review || isBusy"
                  @click="applyVersion('review')"
                >
                  <RotateCcw class="h-3.5 w-3.5" />审校结果
                </Button>
                <Button
                  size="sm"
                  class="justify-start gap-2 transition-transform active:scale-[0.96]"
                  :disabled="isBusy"
                  @click="applyVersion('all')"
                >
                  <History class="h-3.5 w-3.5" />恢复全部
                </Button>
              </div>
              <p class="mt-2 text-xs text-muted-foreground">
                局部恢复只替换所选内容；每次恢复前都会创建保护版本。
              </p>
            </div>
          </aside>
        </div>

        <div
          v-else
          class="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground"
        >
          <History class="mb-3 h-8 w-8" :stroke-width="1.5" />
          <p class="text-sm font-medium text-foreground">还没有历史版本</p>
          <p class="mt-1 max-w-sm text-sm leading-6">
            关键生成和恢复操作前会自动出现保护版本，也可以创建带名称和备注的里程碑。
          </p>
          <Button
            variant="outline"
            class="mt-4 gap-2 transition-transform active:scale-[0.96]"
            @click="openMilestoneDialog"
          >
            <FileClock class="h-4 w-4" />
            创建首个里程碑
          </Button>
        </div>
      </section>-->
    </main>

    <Dialog :open="!!pendingGeneration" @update:open="open => { if (!open) discardCandidate() }">
      <DialogContent class="max-h-[90vh] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{{ pendingGenerationSummary?.title }}</DialogTitle>
          <DialogDescription>
            候选稿尚未写入项目。确认内容方向后再替换当前内容。
          </DialogDescription>
        </DialogHeader>
        <div v-if="pendingGenerationChanges.length" class="flex flex-wrap gap-2">
          <Badge
            v-for="change in pendingGenerationChanges"
            :key="change"
            variant="outline"
            class="rounded-md bg-muted/30"
          >
            {{ change }}
          </Badge>
        </div>
        <section
          v-if="pendingGeneration?.kind === 'episode_draft'"
          class="min-h-0 rounded-xl bg-muted/20 p-4"
        >
          <h3 class="text-xs font-medium text-muted-foreground">行级差异</h3>
          <pre class="mt-3 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-sm leading-6"><span
            v-for="(part, index) in pendingDraftDiff"
            :key="index"
            :class="part.added
              ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
              : part.removed
                ? 'bg-destructive/10 text-destructive line-through'
                : 'text-muted-foreground'"
          >{{ part.added ? '+ ' : part.removed ? '- ' : '  ' }}{{ part.value }}</span></pre>
        </section>
        <div class="grid min-h-0 gap-3 md:grid-cols-2">
          <section class="flex min-h-0 flex-col rounded-xl bg-muted/40 p-4">
            <h3 class="text-xs font-medium text-muted-foreground">当前内容</h3>
            <pre class="mt-3 max-h-[55vh] min-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6">{{ pendingCurrentContent }}</pre>
          </section>
          <section class="flex min-h-0 flex-col rounded-xl bg-primary/5 p-4 ring-1 ring-inset ring-primary/15">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-xs font-medium text-primary">候选内容</h3>
              <span class="text-xs text-muted-foreground">可编辑后采纳</span>
            </div>
            <Textarea
              v-if="pendingGeneration?.kind === 'episode_draft'"
              v-model="pendingCandidateContent"
              class="mt-3 min-h-64 max-h-[55vh] flex-1 resize-none overflow-auto font-mono leading-6"
            />
            <div
              v-else-if="pendingGeneration?.kind === 'story_bible'"
              class="mt-3 max-h-[55vh] min-h-64 space-y-3 overflow-auto pr-1"
            >
              <div
                v-for="field in ([['premise', '核心命题'], ['theme', '主题'], ['world', '世界设定'], ['tone', '基调']] as const)"
                :key="field[0]"
                class="space-y-1.5"
              >
                <label class="text-xs text-muted-foreground">{{ field[1] }}</label>
                <Textarea
                  :model-value="pendingGeneration.storyBible[field[0]]"
                  rows="2"
                  @update:model-value="updatePendingStoryBibleField(field[0], String($event))"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs text-muted-foreground">角色</label>
                <div class="space-y-2">
                  <div
                    v-for="character in pendingGeneration.storyBible.characters"
                    :key="character.id"
                    class="rounded-xl bg-background/70 p-3"
                  >
                    <div class="flex items-center gap-2">
                      <Input v-model="character.name" placeholder="角色名" />
                      <Button
                        size="icon"
                        variant="ghost"
                        class="h-8 w-8 shrink-0 text-destructive"
                        title="不采纳该角色"
                        @click="removePendingCharacter(character.id)"
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Input v-model="character.role" class="mt-2" placeholder="角色定位" />
                    <Textarea v-model="character.profile" class="mt-2" rows="2" placeholder="角色小传" />
                    <Textarea v-model="character.motivation" class="mt-2" rows="2" placeholder="核心动机" />
                    <Textarea v-model="character.arc" class="mt-2" rows="2" placeholder="人物成长弧" />
                  </div>
                </div>
              </div>
              <div class="space-y-1.5">
                <label class="text-xs text-muted-foreground">创作规则</label>
                <Textarea
                  :model-value="pendingGeneration.storyBible.rules.join('\n')"
                  rows="4"
                  @update:model-value="updatePendingStoryRules(String($event))"
                />
              </div>
            </div>
            <div
              v-else-if="pendingGeneration?.kind === 'outline'"
              class="mt-3 max-h-[55vh] min-h-64 space-y-3 overflow-auto pr-1"
            >
              <section
                v-for="episode in pendingGeneration.episodes"
                :key="episode.id"
                class="space-y-2 pb-3"
              >
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">{{ episode.index }}</span>
                  <Input
                    :model-value="episode.title"
                    @update:model-value="updatePendingEpisodeField(episode.id, 'title', String($event))"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    class="h-8 w-8 shrink-0 text-destructive"
                    title="不采纳该分集"
                    @click="removePendingEpisode(episode.id)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  :model-value="episode.summary"
                  rows="2"
                  @update:model-value="updatePendingEpisodeField(episode.id, 'summary', String($event))"
                />
                <Textarea
                  :model-value="episode.hook"
                  rows="2"
                  placeholder="结尾钩子"
                  @update:model-value="updatePendingEpisodeField(episode.id, 'hook', String($event))"
                />
                <Textarea
                  :model-value="episode.beats.join('\n')"
                  rows="4"
                  placeholder="每行一个剧情节拍"
                  @update:model-value="updatePendingEpisodeField(episode.id, 'beats', String($event))"
                />
              </section>
            </div>
          </section>
        </div>
        <DialogFooter class="gap-2 sm:gap-2">
          <Button variant="outline" @click="discardCandidate">保留当前内容</Button>
          <Button :disabled="!pendingCandidateContent.trim()" @click="acceptPendingGeneration">
            采用候选稿
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Milestone dialog removed -->
    <!-- <Dialog v-model:open="milestoneDialogOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>创建里程碑</DialogTitle>
          <DialogDescription>
            里程碑保存当前项目的完整内容，并默认固定，不受保护版本轮换影响。
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-1">
          <div class="space-y-2">
            <label for="milestone-name" class="text-sm font-medium">名称</label>
            <Input
              id="milestone-name"
              v-model="milestoneName"
              maxlength="80"
              placeholder="例如：人物关系定稿"
              @keydown.enter.prevent="submitMilestone"
            />
          </div>
          <div class="space-y-2">
            <label for="milestone-note" class="text-sm font-medium">
              备注
              <span class="font-normal text-muted-foreground">可选</span>
            </label>
            <Textarea
              id="milestone-note"
              v-model="milestoneNote"
              rows="3"
              maxlength="300"
              placeholder="记录这版完成了什么，或后续需要注意的事项"
            />
          </div>
        </div>
        <DialogFooter class="gap-2 sm:gap-2">
          <Button variant="outline" @click="milestoneDialogOpen = false">取消</Button>
          <Button
            class="transition-transform active:scale-[0.96]"
            :disabled="!milestoneName.trim() || isBusy"
            @click="submitMilestone"
          >
            创建里程碑
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog> -->
    </div>
  </div>
</template>
