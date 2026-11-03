<script setup lang="ts">
import AssetWorkbenchParseProgress from './ParseProgress.vue'
import { onActivated, onDeactivated, toRefs } from 'vue'
import { useIntervalFn, useStorage } from '@vueuse/core'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { Check, ChevronLeft, ChevronRight, Clapperboard, Download, Ellipsis, Eraser, FileDown, FolderOpen, Loader2, Play } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { isSelectedEpisodeParsing, shouldShowEpisodeParseProgress } from '~/lib/asset-workbench-parse-progress'
import type { SceneData } from '~/composables/useAssetWorkbench'
import { prepareSubtitleErasureSource } from '~/lib/subtitle-erasure-source'
import { useSubtitleErasureSettings } from '~/composables/useSubtitleErasureSettings'
import { ensureVideoHistoryEntry } from '~/lib/asset-history'
import { resolveVideoPreviewAspectRatio } from '~/lib/video-preview-aspect-ratio'
import { vReadOnlyFence } from '~/lib/read-only-fence'
import { useVideosStageContext, type EpisodePlanItemForVideoStage } from '~/lib/asset-workbench-videos-stage-context'
import {
  buildQueueProgressSegments,
  matchesSceneListFilter,
  resolveSceneListStatus,
  type SceneListFilter,
  type SceneListStatus
} from '~/lib/asset-workbench-progress'

interface SceneEpisodeGroup {
  id: string
  title: string
  index: number
  scenes: SceneData[]
  duration: number
}

interface EpisodeDirectoryItem {
  id: string
  title: string
  index: number
  sceneCount: number
  doneCount: number
  duration: number
  startOffset: number | null
  endOffset: number | null
  charCount: number | null
  assetSummary: string
  overview: string
}

const componentActive = ref(true)
const episodeDirectoryContainer = ref<HTMLElement | null>(null)
const sceneListContainer = ref<HTMLElement | null>(null)

// KeepAlive detaches the DOM while another stage is shown, which resets
// scrollTop. Track offsets on scroll (by deactivation the DOM is already
// detached and reads 0) and restore them once the stage is re-inserted.
const savedListScroll = { episodeDirectory: 0, sceneList: 0 }
function rememberListScroll(key: keyof typeof savedListScroll, event: Event) {
  if (!componentActive.value) return
  savedListScroll[key] = (event.target as HTMLElement).scrollTop
}
function restoreListScroll() {
  if (episodeDirectoryContainer.value) episodeDirectoryContainer.value.scrollTop = savedListScroll.episodeDirectory
  if (sceneListContainer.value) sceneListContainer.value.scrollTop = savedListScroll.sceneList
}

onActivated(() => {
  componentActive.value = true
  restoreListScroll()
  requestAnimationFrame(restoreListScroll)
})
onDeactivated(() => { componentActive.value = false })

// State and actions come from the workbench page (see asset-workbench-videos-stage-context).
const { state, actions } = useVideosStageContext()
const {
  toolbarActive,
  canExport,
  scenes,
  selectedSceneId,
  selectedScene,
  queueSummary,
  parsing,
  parseProgress,
  sceneChatOpenSceneId,
  sceneChatCurrentMessages,
  sceneChatComposerAssets,
  sceneChatComposerText,
  sceneChatMentionOpen,
  sceneChatMentionCandidates,
  sceneChatMentionActiveIndex,
  sceneChatUploading,
  sceneChatApplying,
  sceneChatError,
  sceneChatCanSubmit,
  resolveScenePreviousLastFrameReferenceEnabled,
  resolveSceneContinuityLinkReason,
  canUsePreviousLastFrameReference,
  exportingScriptDocx,
  resolveSceneVideoBadge,
  resolveSceneVoiceReferenceSummary,
  resolveSceneDescriptionRenderSegments,
  resolveSceneDescriptionSecondaryMentionItems,
  resolveSceneReferenceImage,
  resolveSceneEnvironmentReferenceImageForMode,
  sceneEnvironmentAssetOptions,
  resolveSceneEnvironmentReferenceAssetSelection,
  resolveSceneNarrationVoiceOptions,
  resolveSceneNarrationVoiceReferenceSelection,
  supportsNarrationVoiceReference,
  isSceneBusy,
  isScenePreparing,
  canMergeSceneByIndex,
  normalizeWorkflowText,
  resolveDisplayAssetById,
  resolveDisplayAssetTypeLabel,
  setSceneChatInputRef,
  setSceneChatMentionListRef,
  setSceneChatComposerText
} = toRefs(state)

const previewAspectRatio = computed(() => resolveVideoPreviewAspectRatio(state.projectAspectRatio))

const readySceneCount = computed(() => {
  return state.scenes.filter(scene => scene.referenceStatus === 'done').length
})

const normalizedEpisodePlan = computed(() => {
  return (state.episodePlan || [])
    .slice()
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index
      return a.id.localeCompare(b.id, 'zh-CN')
    })
})

function resolveSceneEpisodeMeta(scene: SceneData): { id: string, title: string, index: number } {
  const normalizedEpisodeIndex = typeof scene.episodeIndex === 'number' && Number.isFinite(scene.episodeIndex)
    ? Math.max(1, Math.round(scene.episodeIndex))
    : 1
  return {
    id: scene.episodeId?.trim() || `episode_${String(normalizedEpisodeIndex).padStart(3, '0')}`,
    title: scene.episodeTitle?.trim() || `第${normalizedEpisodeIndex}集`,
    index: normalizedEpisodeIndex
  }
}

const downloadingVideo = ref(false)
const downloadedVideos = useStorage<Record<string, string>>('project-downloaded-videos', {})
const selectedVideoDownloaded = computed(() => {
  const scene = state.selectedScene
  return Boolean(scene?.videoUrl && downloadedVideos.value[scene.id] === scene.videoUrl)
})
const { toast } = useToast()
const desktopRuntime = isTauri()
const openingDownloadDirectory = ref(false)

// Keep submitted tasks across navigation and desktop restarts.
const { getOptions: getErasureOptions } = useSubtitleErasureSettings()
const erasureTasks = useStorage<Record<string, { taskId: string, sourceUrl: string }>>('scene-subtitle-erasure-tasks', {})
const submittingErasure = ref<string[]>([])
const checkingErasure = new Set<string>()
const erasureErrors = new Set<string>()
const selectedSceneErasing = computed(() => !!state.selectedScene && (
  submittingErasure.value.includes(state.selectedScene.id) || !!erasureTasks.value[state.selectedScene.id]
))

async function eraseSelectedVideo() {
  const scene = state.selectedScene
  if (!scene?.videoUrl || selectedSceneErasing.value || state.isSceneBusy(scene)) return
  const sourceUrl = scene.videoUrl
  submittingErasure.value.push(scene.id)
  try {
    const erasureOptions = getErasureOptions()
    const upload = await prepareSubtitleErasureSource(
      sourceUrl,
      `${scene.title || scene.id}.mp4`,
      window.location.href,
      form => $fetch('/api/tools/subtitle-erasure/upload-source', { method: 'POST', body: form })
    )
    const task = await $fetch<{ taskId: string }>('/api/tools/subtitle-erasure', {
      method: 'POST',
      body: { ...erasureOptions, videoUrl: upload.videoUrl, sourceObjectKey: upload.sourceObjectKey, sourceFileName: `${scene.title}.mp4` }
    })
    erasureTasks.value = { ...erasureTasks.value, [scene.id]: { taskId: task.taskId, sourceUrl } }
    toast.success('已开始去字幕，完成后自动更新分镜视频')
  } catch (error) {
    toast.error('提交去字幕失败', { description: error instanceof Error ? error.message : '请稍后重试' })
  } finally {
    submittingErasure.value = submittingErasure.value.filter(id => id !== scene.id)
  }
}

async function checkErasureTasks() {
  for (const scene of state.scenes) {
    const task = erasureTasks.value[scene.id]
    if (!task || checkingErasure.has(scene.id)) continue
    checkingErasure.add(scene.id)
    try {
      const status = await $fetch<{ status: string, errorMessage?: string }>(
        `/api/tools/subtitle-erasure/status/${encodeURIComponent(task.taskId)}`
      )
      if (status.status === 'failed') {
        delete erasureTasks.value[scene.id]
        toast.error(`${scene.title} 去字幕失败`, { description: status.errorMessage || '请重试' })
      } else if (status.status === 'completed') {
        const latest = state.scenes.find(item => item.id === scene.id)
        if (latest?.videoUrl === task.sourceUrl && state.isSceneBusy(latest)) continue
        const result = await $fetch<{ videoUrl: string }>('/api/tools/subtitle-erasure/save', {
          method: 'POST', body: { taskId: task.taskId }
        })
        // A new generation may have replaced this scene while erasure was running.
        const current = state.scenes.find(item => item.id === scene.id)
        if (current?.videoUrl === task.sourceUrl && !state.isSceneBusy(current)) {
          await actions.applySubtitleErasure({
            id: scene.id,
            videoUrl: result.videoUrl,
            videoHistory: ensureVideoHistoryEntry(current.videoHistory, task.sourceUrl, { source: 'legacy' }),
            lastFrame: undefined
          })
          toast.success(`${scene.title} 去字幕完成`)
        } else {
          toast.success('去字幕已完成，可在字幕擦除任务中查看结果')
        }
        delete erasureTasks.value[scene.id]
      }
    } catch (error) {
      // Keep the task recoverable, but surface failures instead of silently appearing stuck.
      if (!erasureErrors.has(task.taskId)) {
        erasureErrors.add(task.taskId)
        toast.error(`${scene.title} 去字幕结果同步失败，将自动重试`, {
          description: error instanceof Error ? error.message : '请检查网络或在字幕擦除任务中查看结果'
        })
      }
    } finally {
      checkingErasure.delete(scene.id)
    }
  }
}

useIntervalFn(checkErasureTasks, 5000, { immediateCallback: true })

async function openDownloadDirectory() {
  if (openingDownloadDirectory.value) return
  openingDownloadDirectory.value = true
  try {
    const path = await invoke<string>('get_download_directory')
    await invoke('open_local_directory', { path })
  } catch (error) {
    toast.error('无法打开下载目录', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    openingDownloadDirectory.value = false
  }
}

async function downloadSelectedVideo() {
  const scene = state.selectedScene
  if (!scene?.videoUrl || downloadingVideo.value) return
  const videoUrl = scene.videoUrl
  const episode = resolveSceneEpisodeMeta(scene)
  const sceneNumber = resolveSceneGlobalIndex(scene.id) + 1
  const sceneName = (scene.title?.trim() || `场景${sceneNumber}`)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '') || '场景'
  const fileName = `第${episode.index}集-分镜${sceneNumber}-${sceneName}.mp4`
  downloadingVideo.value = true
  try {
    if (isTauri()) {
      const source = new URL(videoUrl, window.location.href)
      const url = source.origin === window.location.origin && source.pathname.startsWith('/api/video/file/')
        ? `http://127.0.0.1:43127${source.pathname}`
        : `http://127.0.0.1:43127/api/video/download?${new URLSearchParams({ url: source.href })}`
      const savedPath = await invoke<string>('save_project_video', { url, fileName, projectName: state.projectName })
      downloadedVideos.value = { ...downloadedVideos.value, [scene.id]: videoUrl }
      toast.success('视频已保存到项目文件夹', { description: savedPath })
      return
    }
    const source = new URL(videoUrl, window.location.href)
    const downloadUrl = source.origin === window.location.origin || !['http:', 'https:'].includes(source.protocol)
      ? videoUrl
      : `/api/video/download?${new URLSearchParams({ url: source.href })}`
    const response = await fetch(downloadUrl)
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.message || `下载失败（${response.status}）`)
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    toast.success('已交给浏览器下载', {
      description: `${fileName} · 保存位置请查看浏览器下载列表`,
      duration: 8000
    })
  } catch (error) {
    toast.error('视频下载失败', {
      description: error instanceof Error ? error.message : String(error || '请稍后重试')
    })
  } finally {
    downloadingVideo.value = false
  }
}

function resolveSceneDuration(scene: SceneData): number {
  const duration = Number(scene.duration)
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function resolveScenesDuration(scenes: SceneData[]): number {
  return scenes.reduce((sum, scene) => {
    return sum + resolveSceneDuration(scene)
  }, 0)
}

const sceneEpisodeGroups = computed<SceneEpisodeGroup[]>(() => {
  const groups: SceneEpisodeGroup[] = []
  const groupMap = new Map<string, SceneEpisodeGroup>()

  for (const scene of state.scenes) {
    const episodeMeta = resolveSceneEpisodeMeta(scene)
    const episodeId = episodeMeta.id
    const episodeTitle = episodeMeta.title
    let group = groupMap.get(episodeId)
    if (!group) {
      group = {
        id: episodeId,
        title: episodeTitle,
        index: episodeMeta.index,
        scenes: [],
        duration: 0
      }
      groups.push(group)
      groupMap.set(episodeId, group)
    }
    group.scenes.push(scene)
  }
  groups.forEach((group) => {
    group.duration = resolveScenesDuration(group.scenes)
  })

  return groups.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    return a.title.localeCompare(b.title, 'zh-CN')
  })
})

const activeEpisodeId = ref('')
const EPISODE_DIRECTORY_COLLAPSE_STORAGE_KEY = 'asset-workbench:videos:episode-directory-collapsed'
const episodeDirectoryCollapsed = ref(false)

const episodeCount = computed(() => {
  if (normalizedEpisodePlan.value.length > 0) return normalizedEpisodePlan.value.length
  return sceneEpisodeGroups.value.length
})

const sceneGridClass = computed(() => {
  if (episodeCount.value <= 0) {
    return previewAspectRatio.value.portrait
      ? 'xl:grid-cols-[minmax(0,1fr)_clamp(340px,30vw,520px)] xl:gap-x-4'
      : 'xl:grid-cols-2 xl:gap-x-4'
  }

  if (episodeDirectoryCollapsed.value) {
    return previewAspectRatio.value.portrait
      ? 'xl:grid-cols-[0px_minmax(0,1fr)_clamp(340px,30vw,520px)] xl:gap-x-0'
      : 'xl:grid-cols-[0px_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-0'
  }

  return previewAspectRatio.value.portrait
    ? 'xl:grid-cols-[300px_minmax(0,1fr)_clamp(340px,30vw,520px)] xl:gap-x-4'
    : 'xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-4'
})

const sceneEpisodeGroupMap = computed(() => {
  return new Map(sceneEpisodeGroups.value.map(group => [group.id, group] as const))
})

const episodeDirectoryItems = computed<EpisodeDirectoryItem[]>(() => {
  if (normalizedEpisodePlan.value.length > 0) {
    return normalizedEpisodePlan.value.map(episode => ({
      id: episode.id,
      title: episode.title,
      index: episode.index,
      sceneCount: resolveEpisodeSceneCountById(episode.id),
      doneCount: resolveEpisodeDoneCountById(episode.id),
      duration: resolveEpisodeDurationById(episode.id),
      startOffset: episode.startOffset,
      endOffset: episode.endOffset,
      charCount: episode.charCount,
      assetSummary: resolveEpisodeAssetSummaryText(episode),
      overview: state.episodeOverviews?.[episode.id] || ''
    }))
  }

  return sceneEpisodeGroups.value.map(group => ({
    id: group.id,
    title: group.title,
    index: group.index,
    sceneCount: group.scenes.length,
    doneCount: group.scenes.filter(scene => scene.videoStatus === 'done').length,
    duration: group.duration,
    startOffset: null,
    endOffset: null,
    charCount: null,
    assetSummary: '',
    overview: ''
  }))
})

const episodeDirectoryMap = computed(() => {
  return new Map(episodeDirectoryItems.value.map(item => [item.id, item] as const))
})

const episodeDirectoryIds = computed(() => {
  return episodeDirectoryItems.value.map(item => item.id)
})

watch(
  [episodeDirectoryIds, () => state.selectedSceneId],
  () => {
    const directoryIds = episodeDirectoryIds.value
    if (directoryIds.length === 0) {
      activeEpisodeId.value = ''
      return
    }

    const selectedSceneEpisodeId = state.selectedScene
      ? resolveSceneEpisodeMeta(state.selectedScene).id
      : ''

    if (selectedSceneEpisodeId && directoryIds.includes(selectedSceneEpisodeId)) {
      activeEpisodeId.value = selectedSceneEpisodeId
      return
    }

    if (activeEpisodeId.value && directoryIds.includes(activeEpisodeId.value)) {
      return
    }

    activeEpisodeId.value = directoryIds[0] || ''
  },
  { immediate: true }
)

const selectedEpisodeId = computed(() => {
  if (activeEpisodeId.value) return activeEpisodeId.value
  return episodeDirectoryIds.value[0] || ''
})

watch(selectedEpisodeId, () => {
  parseEpisodeError.value = ''
})

const selectedEpisodeDirectoryItem = computed(() => {
  return episodeDirectoryMap.value.get(selectedEpisodeId.value) || null
})

const sceneListHeaderLabel = computed(() => {
  if (episodeCount.value <= 0) return '场景列表'

  const episodeIndex = selectedEpisodeDirectoryItem.value?.index
  if (typeof episodeIndex === 'number' && Number.isFinite(episodeIndex) && episodeIndex > 0) {
    return `当前分集场景列表（第${episodeIndex}集，${selectedEpisodeSceneStatsText.value}）`
  }

  if (selectedEpisodeDirectoryItem.value) {
    return `当前分集场景列表（${selectedEpisodeSceneStatsText.value}）`
  }

  return '当前分集场景列表'
})

const selectedEpisodePlanItem = computed(() => {
  if (normalizedEpisodePlan.value.length === 0) return null
  return normalizedEpisodePlan.value.find(item => item.id === selectedEpisodeId.value) || null
})

const selectedEpisodeScenes = computed(() => {
  return sceneEpisodeGroupMap.value.get(selectedEpisodeId.value)?.scenes || []
})

watch(
  [episodeCount, selectedEpisodeId, () => selectedEpisodeScenes.value.length],
  ([currentEpisodeCount, , sceneCount]) => {
    if (currentEpisodeCount > 0 && sceneCount === 0) {
      episodeDirectoryCollapsed.value = false
    }
  },
  { immediate: true }
)

const isOriginExplainer = computed(() => state.scriptParseMode === 'origin_explainer')

const emptyProjectMessage = computed(() => {
  return isOriginExplainer.value
    ? '请先在“镜头规划”步骤生成镜头规划入口'
    : '请先在“剧本解析”步骤生成分集目录'
})

const emptySelectedEpisodeMessage = computed(() => {
  if (isOriginExplainer.value) {
    return selectedEpisodePlanItem.value ? '当前镜头规划暂无场景，请先点击“解析本集”。' : '当前镜头规划暂无场景。'
  }
  return selectedEpisodePlanItem.value ? '当前分集暂无场景，请先点击“解析本集”。' : '当前分集暂无场景。'
})

const selectedEpisodeHasParsedScenes = computed(() => {
  return selectedEpisodeScenes.value.length > 0
})

const parsingEpisodeId = ref('')
const parseEpisodeError = ref('')

const selectedEpisodeParsing = computed(() => {
  return Boolean(parsingEpisodeId.value && parsingEpisodeId.value === selectedEpisodeId.value)
    || isSelectedEpisodeParsing(state.parseProgress, state.parsing, selectedEpisodeId.value)
})

const parseSelectedEpisodeButtonLabel = computed(() => {
  if (selectedEpisodeParsing.value) return '解析中'
  return selectedEpisodeHasParsedScenes.value ? '重新解析本集' : '解析本集'
})

function resolveEpisodeSceneCountById(episodeId: string): number {
  return sceneEpisodeGroupMap.value.get(episodeId)?.scenes.length || 0
}

function resolveEpisodeDoneCountById(episodeId: string): number {
  return sceneEpisodeGroupMap.value.get(episodeId)?.scenes.filter(scene => scene.videoStatus === 'done').length || 0
}

function resolveEpisodeDurationById(episodeId: string): number {
  return sceneEpisodeGroupMap.value.get(episodeId)?.duration || 0
}

function formatEpisodeDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds))
  const mins = Math.floor(safeSeconds / 60)
  const secs = safeSeconds % 60
  if (mins > 0) return `${mins}分${secs}秒`
  return `${secs}秒`
}

function resolveEpisodeStatsText(episode: Pick<EpisodeDirectoryItem, 'sceneCount' | 'doneCount' | 'duration'>): string {
  return `场景 ${episode.sceneCount} · 完成 ${episode.doneCount} · 时长 ${formatEpisodeDuration(episode.duration)}`
}

const selectedEpisodeSceneStatsText = computed(() => {
  const episode = selectedEpisodeDirectoryItem.value
  return episode ? `${episode.sceneCount}镜，${formatEpisodeDuration(episode.duration)}` : '0镜，0秒'
})

const sceneIndexMap = computed(() => {
  const indexMap = new Map<string, number>()
  state.scenes.forEach((scene, index) => {
    indexMap.set(scene.id, index)
  })
  return indexMap
})

function resolveSceneGlobalIndex(sceneId: string): number {
  return sceneIndexMap.value.get(sceneId) ?? -1
}

const fenceOptions = computed(() => ({
  readOnly: !!state.readOnly,
  conditional: [{ selector: '[data-export]', enabled: state.canExport !== false }]
}))

const SCENE_LIST_FILTERS: Array<{ key: SceneListFilter, label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unfinished', label: '未完成' },
  { key: 'error', label: '失败' }
]
const SCENE_STATUS_DOT_CLASS: Record<SceneListStatus, string> = {
  done: 'bg-success',
  running: 'bg-primary motion-safe:animate-pulse',
  error: 'bg-destructive',
  pending: 'bg-muted-foreground/30'
}
const SCENE_STATUS_LABEL: Record<SceneListStatus, string> = {
  done: '已出片',
  running: '生成中',
  error: '失败',
  pending: '待生成'
}

const sceneListFilter = ref<SceneListFilter>('all')

const selectedEpisodeSceneStatuses = computed(() => {
  return new Map(selectedEpisodeScenes.value.map(scene => [
    scene.id,
    resolveSceneListStatus(scene, state.isSceneBusy(scene))
  ] as const))
})

function resolveSceneStatus(sceneId: string): SceneListStatus {
  return selectedEpisodeSceneStatuses.value.get(sceneId) ?? 'pending'
}

const sceneFilterCounts = computed<Record<SceneListFilter, number>>(() => {
  const statuses = [...selectedEpisodeSceneStatuses.value.values()]
  return {
    all: statuses.length,
    unfinished: statuses.filter(status => matchesSceneListFilter(status, 'unfinished')).length,
    error: statuses.filter(status => status === 'error').length
  }
})

const visibleEpisodeScenes = computed(() => {
  return selectedEpisodeScenes.value.filter(scene => matchesSceneListFilter(resolveSceneStatus(scene.id), sceneListFilter.value))
})

watch(sceneListFilter, () => {
  sceneListContainer.value?.scrollTo({ top: 0 })
})

// A selection made elsewhere (task panel, preview) must stay visible in the list.
watch(() => state.selectedSceneId, (sceneId) => {
  if (!sceneId || sceneListFilter.value === 'all') return
  if (selectedEpisodeSceneStatuses.value.has(sceneId) && !visibleEpisodeScenes.value.some(scene => scene.id === sceneId)) {
    sceneListFilter.value = 'all'
  }
})

const queueProgress = computed(() => buildQueueProgressSegments(state.queueSummary, state.scenes.length))
const QUEUE_SEGMENT_CLASS: Record<string, string> = {
  done: 'bg-success',
  running: 'bg-primary motion-safe:animate-pulse',
  error: 'bg-destructive',
  pending: 'bg-muted-foreground/20'
}
const queueProgressTitle = computed(() => queueProgress.value.segments
  .filter(segment => segment.count > 0)
  .map(segment => `${segment.label} ${segment.count}`)
  .join(' · '))

// Jump to the first failed scene (switching episode if needed) with the list filtered to failures.
function showFailedScenes() {
  const failed = state.scenes.find(scene => resolveSceneListStatus(scene, state.isSceneBusy(scene)) === 'error')
  if (!failed) return
  const episodeId = resolveSceneEpisodeMeta(failed).id
  if (selectedEpisodeId.value !== episodeId) handleSelectEpisode(episodeId)
  void nextTick(() => {
    sceneListFilter.value = 'error'
    focusScene(failed.id)
  })
}

function resolveSceneThumbnail(scene: SceneData): string | undefined {
  return scene.firstFrame || state.resolveSceneReferenceImage(scene)
}

function focusScene(sceneId: string) {
  actions.selectScene(sceneId)
  void nextTick(() => {
    const card = sceneListContainer.value?.querySelector<HTMLElement>(`[data-scene-id="${CSS.escape(sceneId)}"]`)
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

function handleSelectEpisode(groupId: string) {
  if (!groupId.trim()) return
  activeEpisodeId.value = groupId
  const targetScenes = sceneEpisodeGroupMap.value.get(groupId)?.scenes || []
  if (!state.selectedScene || resolveSceneEpisodeMeta(state.selectedScene).id !== groupId) {
    const firstScene = targetScenes[0]
    if (firstScene) {
      actions.selectScene(firstScene.id)
    }
  }
}

function resolveEpisodeAssetSummaryText(episode: EpisodePlanItemForVideoStage): string {
  const characterCount = episode.episodeAssets?.characters?.length || 0
  const propCount = episode.episodeAssets?.props?.length || 0
  const environmentCount = episode.episodeAssets?.environments?.length || 0
  if (characterCount + propCount + environmentCount <= 0) return ''
  return `资产：角色 ${characterCount} · 道具 ${propCount} · 场景 ${environmentCount}`
}

function resolveEpisodeDisplayTitle(episode: { index: number, title: string }): string {
  const normalized = episode.title.replace(/^第\d+集[：:]\s*/u, '')
  return `第${episode.index}集：${normalized}`
}

async function handleParseSelectedEpisode() {
  const episode = selectedEpisodePlanItem.value
  if (!episode || selectedEpisodeParsing.value) return
  parseEpisodeError.value = ''

  if (selectedEpisodeHasParsedScenes.value) {
    const confirmed = await useConfirm().confirm({
      title: '重新解析本集',
      description: `当前分集已存在 ${selectedEpisodeScenes.value.length} 个场景。重新解析将覆盖本集场景并重置本集视频状态，是否继续？`,
      confirmText: '重新解析',
      variant: 'destructive'
    })
    if (!confirmed) return
  }

  parsingEpisodeId.value = episode.id
  try {
    await actions.parseEpisode(episode.id)
  } catch (error) {
    if (selectedEpisodeId.value === episode.id) {
      parseEpisodeError.value = error instanceof Error ? error.message : '本集解析失败，请稍后重试'
    }
  } finally {
    if (parsingEpisodeId.value === episode.id) {
      parsingEpisodeId.value = ''
    }
  }
}

function toggleEpisodeDirectoryCollapsed() {
  if (episodeCount.value <= 0) return
  episodeDirectoryCollapsed.value = !episodeDirectoryCollapsed.value
}

const selectedSceneVoiceReferenceSummary = computed(() => {
  if (!state.selectedScene) return null
  return state.resolveSceneVoiceReferenceSummary(state.selectedScene)
})

onMounted(() => {
  if (typeof window === 'undefined') return
  if (episodeCount.value > 0 && selectedEpisodeScenes.value.length === 0) {
    episodeDirectoryCollapsed.value = false
    return
  }

  const stored = window.localStorage.getItem(EPISODE_DIRECTORY_COLLAPSE_STORAGE_KEY)
  if (stored === '1' || stored === 'true') {
    episodeDirectoryCollapsed.value = true
  } else if (stored === '0' || stored === 'false') {
    episodeDirectoryCollapsed.value = false
  }
})

watch(episodeDirectoryCollapsed, (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(EPISODE_DIRECTORY_COLLAPSE_STORAGE_KEY, value ? '1' : '0')
})
</script>

<template>
  <EmptyState
    v-if="scenes.length === 0 && episodeCount === 0"
    :icon="Clapperboard"
    title="还没有可生成视频的场景"
    :description="emptyProjectMessage"
    :action-label="actions.goToParse ? (isOriginExplainer ? '去镜头规划' : '去解析剧本') : undefined"
    class="flex-1"
    @action="actions.goToParse?.()"
  />
  <template v-else>
    <Teleport to="#workbench-stage-toolbar">
      <div v-if="toolbarActive && componentActive" v-read-only-fence="fenceOptions" class="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <!-- Stacked progress: done / running / failed / not started -->
          <div
            class="flex h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-muted sm:w-56"
            role="img"
            :aria-label="`分镜视频进度：${queueProgressTitle || '暂无'}`"
            v-tooltip="queueProgressTitle"
          >
            <span
              v-for="segment in queueProgress.segments"
              v-show="segment.count > 0"
              :key="segment.key"
              class="h-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
              :class="QUEUE_SEGMENT_CLASS[segment.key]"
              :style="{ width: `${segment.percent}%` }"
            />
          </div>
          <div
            class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <span class="tabular-nums">
              <span class="font-medium text-foreground">{{ queueSummary.done }}</span> / {{ queueProgress.total }} 已出片
            </span>
            <span
              v-if="queueSummary.running > 0"
              class="inline-flex items-center gap-1 tabular-nums"
            >
              <Loader2 class="h-3 w-3 animate-spin text-primary" />
              {{ queueSummary.running }} 生成中
            </span>
            <button
              v-if="queueSummary.error > 0"
              type="button"
              data-readonly-allowed
              class="rounded px-1 tabular-nums text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="showFailedScenes"
            >
              {{ queueSummary.error }} 失败，查看
            </button>
            <span class="hidden tabular-nums lg:inline">
              {{ episodeCount }} 集 · {{ scenes.length }} 场景 · 环境图就绪 {{ readySceneCount }}
            </span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              data-export
              size="sm"
              variant="ghost"
              class="h-7 w-7 shrink-0 p-0 text-muted-foreground"
              aria-label="更多操作"
              v-tooltip="'更多操作'"
            >
              <Loader2
                v-if="exportingScriptDocx"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Ellipsis
                v-else
                class="h-4 w-4"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              :disabled="canExport === false || exportingScriptDocx || scenes.length === 0"
              @select="actions.exportFormattedScriptDocx()"
            >
              <FileDown class="mr-2 h-4 w-4" />
              导出格式化 DOCX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Teleport>

    <!-- Scene grid -->
    <div
      v-read-only-fence="fenceOptions"
      class="grid min-h-0 flex-1 grid-cols-1 gap-y-4 overflow-hidden xl:transition-[grid-template-columns,column-gap] xl:duration-300 xl:ease-in-out"
      :class="sceneGridClass"
    >
      <div
        v-if="episodeCount > 0"
        class="order-1 relative min-h-0 overflow-visible"
      >
        <div
          class="h-full min-h-0 transition-[opacity,transform] duration-300 ease-in-out"
          :class="episodeDirectoryCollapsed
            ? 'pointer-events-none -translate-x-2 opacity-0'
            : 'translate-x-0 opacity-100'"
        >
          <aside
            class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-muted/15"
          >
            <div class="shrink-0 px-2 py-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-xs font-medium text-foreground">
                    分集目录
                  </div>
                  <div class="mt-0.5 text-xs text-muted-foreground">
                    共 {{ episodeCount }} 集
                  </div>
                </div>
              </div>
            </div>

            <div
              ref="episodeDirectoryContainer"
              class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2"
              data-readonly-allowed
              @scroll.passive="rememberListScroll('episodeDirectory', $event)"
            >
              <div
                v-for="episode in episodeDirectoryItems"
                :key="episode.id"
                class="space-y-0.5"
              >
              <Button
                type="button"
                variant="ghost"
                class="h-auto w-full justify-start rounded-xl bg-muted/15 px-2 py-1.5 text-left text-xs transition-colors"
                :title="resolveEpisodeDisplayTitle(episode)"
                :class="selectedEpisodeId === episode.id
                  ? 'bg-background/90 text-foreground shadow-sm'
                  : 'border-border/70 bg-background text-foreground/80 hover:border-foreground/30 hover:bg-muted/60'"
                @click="handleSelectEpisode(episode.id)"
              >
                <div class="truncate font-medium">
                  {{ resolveEpisodeDisplayTitle(episode) }}
                </div>
                <div class="mt-0.5 text-xs text-muted-foreground">
                  {{ resolveEpisodeStatsText(episode) }}
                </div>
              </Button>
              <ul
                v-if="selectedEpisodeId === episode.id && selectedEpisodeScenes.length > 0"
                class="space-y-0.5 py-1 pl-1"
                :aria-label="`${resolveEpisodeDisplayTitle(episode)} 的场景`"
              >
                <li
                  v-for="scene in selectedEpisodeScenes"
                  :key="scene.id"
                >
                  <button
                    type="button"
                    class="grid w-full grid-cols-[48px_minmax(0,1fr)] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :class="selectedSceneId === scene.id ? 'bg-primary/10 text-foreground' : 'text-foreground/80 hover:bg-muted/60'"
                    :aria-current="selectedSceneId === scene.id ? 'true' : undefined"
                    :title="`场景 ${resolveSceneGlobalIndex(scene.id) + 1} · ${scene.title} · ${SCENE_STATUS_LABEL[resolveSceneStatus(scene.id)]}`"
                    @click="focusScene(scene.id)"
                  >
                    <LazyImage
                      :image="resolveSceneThumbnail(scene)"
                      :alt="scene.title"
                      class="aspect-video w-12 rounded object-cover"
                      placeholder-class="bg-muted"
                    />
                    <span class="min-w-0">
                      <span class="flex items-center gap-1.5">
                        <span
                          class="h-1.5 w-1.5 shrink-0 rounded-full"
                          :class="SCENE_STATUS_DOT_CLASS[resolveSceneStatus(scene.id)]"
                          aria-hidden="true"
                        />
                        <span class="truncate">{{ scene.title }}</span>
                      </span>
                      <span
                        class="mt-0.5 block truncate tabular-nums"
                        :class="resolveSceneStatus(scene.id) === 'error' ? 'text-destructive' : 'text-muted-foreground'"
                      >
                        {{ resolveSceneGlobalIndex(scene.id) + 1 }} · {{ resolveSceneDuration(scene) }}s · {{ SCENE_STATUS_LABEL[resolveSceneStatus(scene.id)] }}
                      </span>
                    </span>
                  </button>
                </li>
              </ul>
              </div>
            </div>
            <div
              v-if="selectedEpisodeDirectoryItem"
              class="space-y-2 border-t border-border/60 px-3 py-2"
            >
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span v-if="selectedEpisodeDirectoryItem.startOffset !== null && selectedEpisodeDirectoryItem.endOffset !== null">
                    范围 {{ selectedEpisodeDirectoryItem.startOffset }} - {{ selectedEpisodeDirectoryItem.endOffset }}
                  </span>
                  <span v-if="selectedEpisodeDirectoryItem.charCount !== null">
                    约 {{ selectedEpisodeDirectoryItem.charCount }} 字
                  </span>
                  <span v-if="selectedEpisodeDirectoryItem.assetSummary">
                    {{ selectedEpisodeDirectoryItem.assetSummary }}
                  </span>
                </div>
                <p
                  v-if="selectedEpisodeDirectoryItem.overview"
                  class="line-clamp-2 text-xs text-foreground/75"
                  :title="`概览：${selectedEpisodeDirectoryItem.overview}`"
                >
                  概览：{{ selectedEpisodeDirectoryItem.overview }}
                </p>
              </div>
              <Button
                v-if="selectedEpisodePlanItem"
                size="sm"
                class="h-8 w-full gap-1.5"
                :disabled="parsing || selectedEpisodeParsing"
                @click="handleParseSelectedEpisode()"
              >
                <Loader2
                  v-if="selectedEpisodeParsing"
                  class="h-3.5 w-3.5 animate-spin"
                />
                <Play
                  v-else
                  class="h-3.5 w-3.5"
                />
                {{ parseSelectedEpisodeButtonLabel }}
              </Button>
              <AssetWorkbenchParseProgress
                v-if="selectedEpisodeParsing || parseEpisodeError || shouldShowEpisodeParseProgress(parseProgress, parsing, selectedEpisodeId)"
                :state="parseEpisodeError ? { ...parseProgress, step: 'error', message: parseEpisodeError } : parseProgress"
                :running="selectedEpisodeParsing || (parsing && parseProgress?.kind === 'episode')"
                :title="parseProgress?.targetEpisodeTitle || selectedEpisodePlanItem?.title || '分集解析'"
              />
            </div>
          </aside>
        </div>
      </div>

      <div class="order-2 relative min-h-0 flex flex-col gap-2 overflow-hidden pr-1">
        <div
          class="flex shrink-0 items-center gap-2 rounded-xl bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
        >
          <Button
            v-if="episodeCount > 0"
            data-readonly-allowed
            size="icon"
            variant="outline"
            class="h-8 w-4 rounded-full border-border/60 bg-background/85 px-0 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground"
            :aria-label="episodeDirectoryCollapsed ? '展开分集目录' : '收起分集目录'"
            @click="toggleEpisodeDirectoryCollapsed()"
          >
            <ChevronRight
              v-if="episodeDirectoryCollapsed"
              class="h-3 w-3"
            />
            <ChevronLeft
              v-else
              class="h-3 w-3"
            />
          </Button>
          <span class="min-w-0 truncate">{{ sceneListHeaderLabel }}</span>
          <div
            v-if="selectedEpisodeScenes.length > 0"
            class="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg bg-background/60 p-0.5"
            data-readonly-allowed
            role="group"
            aria-label="按状态筛选场景"
          >
            <button
              v-for="option in SCENE_LIST_FILTERS"
              :key="option.key"
              type="button"
              class="rounded-md px-2 py-0.5 tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              :class="sceneListFilter === option.key
                ? 'bg-background font-medium text-foreground shadow-sm'
                : option.key === 'error' && sceneFilterCounts.error > 0
                  ? 'text-destructive hover:bg-background/70'
                  : 'hover:bg-background/70 hover:text-foreground'"
              :aria-pressed="sceneListFilter === option.key"
              :disabled="option.key !== 'all' && sceneFilterCounts[option.key] === 0"
              @click="sceneListFilter = option.key"
            >
              {{ option.label }} {{ sceneFilterCounts[option.key] }}
            </button>
          </div>
        </div>
        <div
          ref="sceneListContainer"
          class="min-h-0 flex-1 space-y-2 overflow-y-auto"
          @scroll.passive="rememberListScroll('sceneList', $event)"
        >
          <div
            v-if="selectedEpisodeScenes.length === 0"
            class="rounded-xl bg-muted/15 bg-muted/20 px-3 py-4 text-xs text-muted-foreground"
          >
            {{ emptySelectedEpisodeMessage }}
          </div>
          <div
            v-else-if="visibleEpisodeScenes.length === 0"
            class="rounded-xl bg-muted/20 px-3 py-4 text-xs text-muted-foreground"
          >
            本集没有符合筛选条件的场景。
            <button
              type="button"
              data-readonly-allowed
              class="text-primary hover:underline"
              @click="sceneListFilter = 'all'"
            >
              显示全部
            </button>
          </div>
          <AssetWorkbenchSceneVideoCard
            v-for="scene in visibleEpisodeScenes"
            :key="scene.id"
            :data-scene-id="scene.id"
            class="scroll-mt-2"
            :scene="scene"
            :index="resolveSceneGlobalIndex(scene.id)"
            :selected="selectedSceneId === scene.id"
            :can-merge-with-next="canMergeSceneByIndex(resolveSceneGlobalIndex(scene.id))"
            :chat-open="sceneChatOpenSceneId === scene.id"
            :chat-messages="sceneChatCurrentMessages"
            :chat-composer-assets="sceneChatComposerAssets"
            :chat-composer-text="sceneChatComposerText"
            :chat-mention-open="sceneChatMentionOpen"
            :chat-mention-candidates="sceneChatMentionCandidates"
            :chat-mention-active-index="sceneChatMentionActiveIndex"
            :chat-uploading="sceneChatUploading"
            :chat-applying="sceneChatApplying"
            :chat-error="sceneChatError"
            :chat-can-submit="sceneChatCanSubmit"
            :use-previous-last-frame-as-first-frame="resolveScenePreviousLastFrameReferenceEnabled(scene.id)"
            :continuity-link-reason="resolveSceneContinuityLinkReason(scene.id)"
            :can-use-previous-last-frame-reference="canUsePreviousLastFrameReference(scene.id)"
            :resolve-scene-video-badge="resolveSceneVideoBadge"
            :resolve-scene-voice-reference-summary="resolveSceneVoiceReferenceSummary"
            :resolve-scene-description-render-segments="resolveSceneDescriptionRenderSegments"
            :resolve-scene-description-secondary-mention-items="resolveSceneDescriptionSecondaryMentionItems"
            :resolve-scene-reference-image="resolveSceneReferenceImage"
            :resolve-scene-environment-reference-image-for-mode="resolveSceneEnvironmentReferenceImageForMode"
            :scene-environment-asset-options="sceneEnvironmentAssetOptions"
            :resolve-scene-environment-reference-asset-selection="resolveSceneEnvironmentReferenceAssetSelection"
            :resolve-scene-narration-voice-options="resolveSceneNarrationVoiceOptions"
            :resolve-scene-narration-voice-reference-selection="resolveSceneNarrationVoiceReferenceSelection"
            :supports-narration-voice-reference="supportsNarrationVoiceReference"
            :is-scene-busy="isSceneBusy"
            :is-scene-preparing="isScenePreparing"
            :normalize-workflow-text="normalizeWorkflowText"
            :resolve-display-asset-by-id="resolveDisplayAssetById"
            :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
            :set-scene-chat-input-ref="setSceneChatInputRef"
            :set-scene-chat-mention-list-ref="setSceneChatMentionListRef"
            :set-scene-chat-composer-text="setSceneChatComposerText"
            :on-select-scene="actions.selectScene"
            :on-open-scene-edit="actions.openSceneEdit"
            :on-toggle-scene-chat="actions.toggleSceneChat"
            :on-handle-split-scene="actions.handleSplitScene"
            :on-handle-merge-with-next-scene="actions.handleMergeWithNextScene"
            :on-handle-delete-scene="actions.handleDeleteScene"
            :on-generate-scene-baseline="actions.generateSceneBaseline"
            :on-retry-scene="actions.retryScene"
            :on-open-scene-video-history="actions.openSceneVideoHistory"
            :on-set-scene-previous-last-frame-reference="actions.setScenePreviousLastFrameReference"
            :on-set-scene-environment-capture-mode="actions.setSceneEnvironmentCaptureMode"
            :on-set-scene-environment-reference-asset="actions.setSceneEnvironmentReferenceAsset"
            :on-set-scene-narration-voice-reference="actions.setSceneNarrationVoiceReference"
            :on-preview-image="actions.previewImage"
            :on-close-scene-chat="actions.closeSceneChat"
            :on-handle-scene-chat-composer-input="actions.handleSceneChatComposerInput"
            :on-handle-scene-chat-composer-cursor="actions.handleSceneChatComposerCursor"
            :on-handle-scene-chat-composer-keydown="actions.handleSceneChatComposerKeydown"
            :on-apply-scene-chat-mention="actions.applySceneChatMention"
            :on-remove-scene-chat-composer-asset="actions.removeSceneChatComposerAsset"
            :on-handle-scene-chat-image-upload="actions.handleSceneChatImageUpload"
            :on-submit-scene-chat="actions.submitSceneChat"
            :on-select-scene-description-version="actions.selectSceneDescriptionVersion"
          />
        </div>
      </div>

      <!-- Video preview panel -->
      <div class="order-3 min-h-0 flex flex-col rounded-xl bg-muted/10">
        <template v-if="selectedScene">
          <div class="space-y-2 border-b border-border/60 px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <div class="text-xs text-muted-foreground">视频预览</div>
                <div class="truncate text-sm font-medium" :title="selectedScene.title">
                  {{ selectedScene.title }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-0.5">
                <IconActionButton
                  v-if="selectedScene.videoUrl"
                  :label="selectedSceneErasing ? '去字幕中…' : '去字幕'"
                  :disabled="isSceneBusy(selectedScene)"
                  :loading="selectedSceneErasing"
                  @click="eraseSelectedVideo"
                >
                  <Eraser class="h-3.5 w-3.5" />
                </IconActionButton>
                <span
                  v-if="selectedScene.videoUrl"
                  data-export
                  class="inline-flex"
                >
                <IconActionButton
                  :label="downloadingVideo ? '下载中…' : selectedVideoDownloaded ? '已下载，点击重新下载' : '下载视频'"
                  :loading="downloadingVideo"
                  :success="selectedVideoDownloaded"
                  @click="downloadSelectedVideo"
                >
                  <Check
                    v-if="selectedVideoDownloaded"
                    class="h-3.5 w-3.5"
                  />
                  <Download
                    v-else
                    class="h-3.5 w-3.5"
                  />
                </IconActionButton>
                </span>
                <IconActionButton
                  v-if="desktopRuntime"
                  readonly-allowed
                  label="打开下载目录"
                  :disabled="openingDownloadDirectory"
                  @click="openDownloadDirectory"
                >
                  <FolderOpen class="h-3.5 w-3.5" />
                </IconActionButton>
              </div>
            </div>
            <div
              v-if="selectedSceneVoiceReferenceSummary?.hasDialogue"
              class="flex flex-wrap items-center gap-1.5"
            >
              <AssetWorkbenchSceneVoiceReferenceSummary :summary="selectedSceneVoiceReferenceSummary" />
            </div>
          </div>
          <div class="min-h-0 flex flex-1 items-start justify-center p-4">
            <div
              class="max-h-full max-w-full overflow-hidden rounded-lg bg-black/90 outline outline-1 outline-white/10"
              :class="previewAspectRatio.portrait ? 'h-full w-auto' : 'h-auto w-full'"
              :style="{ aspectRatio: previewAspectRatio.cssValue }"
            >
              <video
                v-if="selectedScene.videoUrl"
                :src="selectedScene.videoUrl"
                controls
                controlslist="nodownload"
                class="h-full w-full object-contain"
                playsinline
              />
              <div
                v-else
                class="flex h-full w-full items-center justify-center"
              >
                <span class="text-xs text-white/50">等待生成视频</span>
              </div>
            </div>
          </div>
        </template>
        <div
          v-else
          class="flex flex-1 items-center justify-center"
        >
          <p class="text-sm text-muted-foreground/60">
            选择场景以预览视频
          </p>
        </div>
      </div>
    </div>
  </template>
</template>
