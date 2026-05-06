<script setup lang="ts">
import { ChevronLeft, ChevronRight, FileDown, Loader2, Play } from 'lucide-vue-next'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  AutoStageKey,
  DisplayAsset,
  QueueSummary,
  SceneChatMentionCandidate,
  SceneChatMessage,
  SceneDescriptionMentionItem,
  SceneDescriptionRenderSegment,
  SceneVideoBadge,
  SceneVoiceReferenceSummary
} from '~/lib/asset-workbench-types'

interface SceneEpisodeGroup {
  id: string
  title: string
  index: number
  scenes: SceneData[]
}

interface EpisodePlanItemForVideoStage {
  id: string
  title: string
  index: number
  startOffset: number
  endOffset: number
  charCount: number
  episodeAssets?: {
    characters?: Array<{ name: string }>
    props?: Array<{ name: string }>
    environments?: Array<{ location: string }>
  }
}

interface EpisodeDirectoryItem {
  id: string
  title: string
  index: number
  sceneCount: number
  doneCount: number
  startOffset: number | null
  endOffset: number | null
  charCount: number | null
  assetSummary: string
  overview: string
}

const props = defineProps<{
  scenes: SceneData[]
  episodePlan: EpisodePlanItemForVideoStage[]
  episodeOverviews?: Record<string, string>
  selectedSceneId: string
  selectedScene: SceneData | null
  queueSummary: QueueSummary
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
  parsing: boolean
  sceneChatOpenSceneId: string | null
  sceneChatCurrentMessages: SceneChatMessage[]
  sceneChatComposerAssets: DisplayAsset[]
  sceneChatComposerText: string
  sceneChatMentionOpen: boolean
  sceneChatMentionCandidates: SceneChatMentionCandidate[]
  sceneChatMentionActiveIndex: number
  sceneChatUploading: boolean
  sceneChatApplying: boolean
  sceneChatError: string | null
  sceneChatCanSubmit: boolean
  resolveScenePreviousLastFrameReferenceEnabled: (sceneId: string) => boolean
  resolveSceneContinuityLinkReason: (sceneId: string) => string
  canUsePreviousLastFrameReference: (sceneId: string) => boolean
  exportingScriptDocx: boolean
  resolveSceneVideoBadge: (scene: SceneData) => SceneVideoBadge
  resolveSceneVoiceReferenceSummary: (scene: SceneData) => SceneVoiceReferenceSummary
  resolveSceneDescriptionRenderSegments: (scene: SceneData) => SceneDescriptionRenderSegment[]
  resolveSceneDescriptionSecondaryMentionItems: (scene: SceneData) => SceneDescriptionMentionItem[]
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  isSceneBusy: (scene: SceneData) => boolean
  isScenePreparing: (scene: SceneData) => boolean
  canMergeSceneByIndex: (index: number) => boolean
  normalizeWorkflowText: (value: string) => string
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  setSceneChatInputRef: (element: unknown) => void
  setSceneChatMentionListRef: (element: unknown) => void
  setSceneChatComposerText: (value: string) => void
  onRunVideosStep: () => void
  onRunEpisodeVideosStep: (episodeId: string) => void
  onExportFormattedScriptDocx: () => void
  onRetryFailedQueueItems: () => void
  onParseEpisode: (episodeId: string) => void
  onSelectScene: (sceneId: string) => void
  onOpenSceneEdit: (scene: SceneData) => void
  onToggleSceneChat: (scene: SceneData) => void
  onHandleSplitScene: (sceneId: string) => void
  onHandleMergeWithNextScene: (sceneId: string) => void
  onHandleDeleteScene: (scene: SceneData) => void
  onGenerateSceneBaseline: (sceneId: string) => void
  onRetryScene: (sceneId: string) => void
  onOpenSceneVideoHistory: (sceneId: string) => void
  onSetScenePreviousLastFrameReference: (sceneId: string, enabled: boolean) => void
  onPreviewImage: (src: string | undefined, alt: string) => void
  onCloseSceneChat: () => void
  onHandleSceneChatComposerInput: () => void
  onHandleSceneChatComposerCursor: () => void
  onHandleSceneChatComposerKeydown: (event: KeyboardEvent) => void
  onApplySceneChatMention: (candidate: SceneChatMentionCandidate) => void
  onRemoveSceneChatComposerAsset: (assetId: string) => void
  onHandleSceneChatImageUpload: (event: Event) => void
  onSubmitSceneChat: (sceneId: string) => void
}>()

const readySceneCount = computed(() => {
  return props.scenes.filter(scene => scene.referenceStatus === 'done').length
})

const normalizedEpisodePlan = computed(() => {
  return (props.episodePlan || [])
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

const sceneEpisodeGroups = computed<SceneEpisodeGroup[]>(() => {
  const groups: SceneEpisodeGroup[] = []
  const groupMap = new Map<string, SceneEpisodeGroup>()

  for (const scene of props.scenes) {
    const episodeMeta = resolveSceneEpisodeMeta(scene)
    const episodeId = episodeMeta.id
    const episodeTitle = episodeMeta.title
    let group = groupMap.get(episodeId)
    if (!group) {
      group = {
        id: episodeId,
        title: episodeTitle,
        index: episodeMeta.index,
        scenes: []
      }
      groups.push(group)
      groupMap.set(episodeId, group)
    }
    group.scenes.push(scene)
  }

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
  if (episodeCount.value <= 0) return 'xl:grid-cols-2 xl:gap-x-4'
  if (episodeDirectoryCollapsed.value) return 'xl:grid-cols-[0px_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-0'
  return 'xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1fr)] xl:gap-x-4'
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
      startOffset: episode.startOffset,
      endOffset: episode.endOffset,
      charCount: episode.charCount,
      assetSummary: resolveEpisodeAssetSummaryText(episode),
      overview: props.episodeOverviews?.[episode.id] || ''
    }))
  }

  return sceneEpisodeGroups.value.map(group => ({
    id: group.id,
    title: group.title,
    index: group.index,
    sceneCount: group.scenes.length,
    doneCount: group.scenes.filter(scene => scene.videoStatus === 'done').length,
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
  [episodeDirectoryIds, () => props.selectedSceneId],
  () => {
    const directoryIds = episodeDirectoryIds.value
    if (directoryIds.length === 0) {
      activeEpisodeId.value = ''
      return
    }

    const selectedSceneEpisodeId = props.selectedScene
      ? resolveSceneEpisodeMeta(props.selectedScene).id
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

const selectedEpisodeTitle = computed(() => {
  return episodeDirectoryMap.value.get(selectedEpisodeId.value)?.title || '当前集'
})

const selectedEpisodeDirectoryItem = computed(() => {
  return episodeDirectoryMap.value.get(selectedEpisodeId.value) || null
})

const sceneListHeaderLabel = computed(() => {
  if (episodeCount.value <= 0) return '场景列表'

  const episodeIndex = selectedEpisodeDirectoryItem.value?.index
  if (typeof episodeIndex === 'number' && Number.isFinite(episodeIndex) && episodeIndex > 0) {
    return `当前分集场景列表（第${episodeIndex}集）`
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

const selectedEpisodeHasParsedScenes = computed(() => {
  return selectedEpisodeScenes.value.length > 0
})

const parseSelectedEpisodeButtonLabel = computed(() => {
  return selectedEpisodeHasParsedScenes.value ? '重新解析本集' : '解析本集'
})

function resolveEpisodeSceneCountById(episodeId: string): number {
  return sceneEpisodeGroupMap.value.get(episodeId)?.scenes.length || 0
}

function resolveEpisodeDoneCountById(episodeId: string): number {
  return sceneEpisodeGroupMap.value.get(episodeId)?.scenes.filter(scene => scene.videoStatus === 'done').length || 0
}

const sceneIndexMap = computed(() => {
  const indexMap = new Map<string, number>()
  props.scenes.forEach((scene, index) => {
    indexMap.set(scene.id, index)
  })
  return indexMap
})

function resolveSceneGlobalIndex(sceneId: string): number {
  return sceneIndexMap.value.get(sceneId) ?? -1
}

function handleRunCurrentEpisodeVideos() {
  if (!selectedEpisodeId.value) return
  props.onRunEpisodeVideosStep(selectedEpisodeId.value)
}

function handleSelectEpisode(groupId: string) {
  if (!groupId.trim()) return
  activeEpisodeId.value = groupId
  const targetScenes = sceneEpisodeGroupMap.value.get(groupId)?.scenes || []
  if (!props.selectedScene || resolveSceneEpisodeMeta(props.selectedScene).id !== groupId) {
    const firstScene = targetScenes[0]
    if (firstScene) {
      props.onSelectScene(firstScene.id)
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

function handleParseSelectedEpisode() {
  const episode = selectedEpisodePlanItem.value
  if (!episode) return

  if (selectedEpisodeHasParsedScenes.value) {
    const confirmed = window.confirm(
      `当前分集已存在 ${selectedEpisodeScenes.value.length} 个场景。\n`
      + '重新解析将覆盖本集场景并重置本集视频状态，是否继续？'
    )
    if (!confirmed) return
  }

  props.onParseEpisode(episode.id)
}

function toggleEpisodeDirectoryCollapsed() {
  if (episodeCount.value <= 0) return
  episodeDirectoryCollapsed.value = !episodeDirectoryCollapsed.value
}

const selectedSceneVoiceReferenceSummary = computed(() => {
  if (!props.selectedScene) return null
  return props.resolveSceneVoiceReferenceSummary(props.selectedScene)
})

onMounted(() => {
  if (typeof window === 'undefined') return

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
  <div
    v-if="scenes.length === 0 && episodeCount === 0"
    class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
  >
    <p class="text-sm">
      请先在“剧本解析”步骤生成分集目录
    </p>
  </div>
  <template v-else>
    <!-- Stats & actions -->
    <div class="shrink-0 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-blue-500" />
          场景 {{ scenes.length }}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-amber-500" />
          分集 {{ episodeCount }}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          环境图就绪 {{ readySceneCount }}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-violet-500" />
          视频完成 {{ queueSummary.done }}
        </div>
        <div
          v-if="queueSummary.error > 0"
          class="flex items-center gap-1.5 text-xs text-destructive"
        >
          <span class="inline-block h-2 w-2 rounded-full bg-destructive" />
          失败 {{ queueSummary.error }}
        </div>
        <div
          v-if="queueSummary.running > 0"
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Loader2 class="h-3 w-3 animate-spin text-primary" />
          运行中 {{ queueSummary.running }}
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Button
          size="sm"
          :disabled="autoRunning"
          class="gap-2"
          @click="onRunVideosStep()"
        >
          <Loader2
            v-if="autoRunning && autoRunCurrentStage === 'videos'"
            class="h-3.5 w-3.5 animate-spin"
          />
          批量生成分镜视频
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="autoRunning || !selectedEpisodeId || selectedEpisodeScenes.length === 0"
          @click="handleRunCurrentEpisodeVideos()"
        >
          仅生成{{ selectedEpisodeTitle }}
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="autoRunning || queueSummary.error === 0"
          @click="onRetryFailedQueueItems()"
        >
          重试失败场景
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="gap-2"
          :disabled="exportingScriptDocx || scenes.length === 0"
          @click="onExportFormattedScriptDocx()"
        >
          <Loader2
            v-if="exportingScriptDocx"
            class="h-3.5 w-3.5 animate-spin"
          />
          <FileDown
            v-else
            class="h-3.5 w-3.5"
          />
          导出格式化 DOCX
        </Button>
      </div>
    </div>

    <!-- Scene grid -->
    <div
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
            class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-muted/10"
          >
            <div class="shrink-0 border-b border-border/60 px-2 py-2">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-xs font-medium text-foreground">
                    分集目录
                  </div>
                  <div class="mt-0.5 text-[11px] text-muted-foreground">
                    共 {{ episodeCount }} 集
                  </div>
                </div>
              </div>
            </div>

            <div class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              <Button
                v-for="episode in episodeDirectoryItems"
                :key="episode.id"
                type="button"
                variant="ghost"
                class="h-auto w-full justify-start rounded-md border px-2 py-1.5 text-left text-xs transition-colors"
                :class="selectedEpisodeId === episode.id
                  ? 'border-foreground bg-muted text-foreground shadow-sm'
                  : 'border-border/70 bg-background text-foreground/80 hover:border-foreground/30 hover:bg-muted/60'"
                @click="handleSelectEpisode(episode.id)"
              >
                <div class="truncate font-medium">
                  第{{ episode.index }}集：{{ episode.title.replace(/^第\d+集[：:]\s*/u, '') }}
                </div>
                <div class="mt-0.5 text-[11px] text-muted-foreground">
                  场景 {{ episode.sceneCount }} · 完成 {{ episode.doneCount }}
                </div>
              </Button>
            </div>
            <div
              v-if="selectedEpisodeDirectoryItem"
              class="space-y-2 border-t border-border/60 px-3 py-2"
            >
              <div class="space-y-1">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
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
                  class="line-clamp-2 text-[11px] text-foreground/75"
                >
                  概览：{{ selectedEpisodeDirectoryItem.overview }}
                </p>
              </div>
              <Button
                v-if="selectedEpisodePlanItem"
                size="sm"
                class="h-8 w-full gap-1.5"
                :disabled="parsing"
                @click="handleParseSelectedEpisode()"
              >
                <Loader2
                  v-if="parsing"
                  class="h-3.5 w-3.5 animate-spin"
                />
                <Play
                  v-else
                  class="h-3.5 w-3.5"
                />
                {{ parseSelectedEpisodeButtonLabel }}
              </Button>
            </div>
          </aside>
        </div>
      </div>

      <div class="order-2 relative min-h-0 space-y-2 overflow-y-auto pr-1">
        <div
          class="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          <Button
            v-if="episodeCount > 0"
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
          <span>{{ sceneListHeaderLabel }}</span>
        </div>
        <div
          v-if="selectedEpisodeScenes.length === 0"
          class="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-xs text-muted-foreground"
        >
          {{ selectedEpisodePlanItem ? '当前分集暂无场景，请先点击“解析本集”。' : '当前分集暂无场景。' }}
        </div>
        <AssetWorkbenchSceneVideoCard
          v-for="scene in selectedEpisodeScenes"
          :key="scene.id"
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
          :is-scene-busy="isSceneBusy"
          :is-scene-preparing="isScenePreparing"
          :normalize-workflow-text="normalizeWorkflowText"
          :resolve-display-asset-by-id="resolveDisplayAssetById"
          :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
          :set-scene-chat-input-ref="setSceneChatInputRef"
          :set-scene-chat-mention-list-ref="setSceneChatMentionListRef"
          :set-scene-chat-composer-text="setSceneChatComposerText"
          :on-select-scene="onSelectScene"
          :on-open-scene-edit="onOpenSceneEdit"
          :on-toggle-scene-chat="onToggleSceneChat"
          :on-handle-split-scene="onHandleSplitScene"
          :on-handle-merge-with-next-scene="onHandleMergeWithNextScene"
          :on-handle-delete-scene="onHandleDeleteScene"
          :on-generate-scene-baseline="onGenerateSceneBaseline"
          :on-retry-scene="onRetryScene"
          :on-open-scene-video-history="onOpenSceneVideoHistory"
          :on-set-scene-previous-last-frame-reference="onSetScenePreviousLastFrameReference"
          :on-preview-image="onPreviewImage"
          :on-close-scene-chat="onCloseSceneChat"
          :on-handle-scene-chat-composer-input="onHandleSceneChatComposerInput"
          :on-handle-scene-chat-composer-cursor="onHandleSceneChatComposerCursor"
          :on-handle-scene-chat-composer-keydown="onHandleSceneChatComposerKeydown"
          :on-apply-scene-chat-mention="onApplySceneChatMention"
          :on-remove-scene-chat-composer-asset="onRemoveSceneChatComposerAsset"
          :on-handle-scene-chat-image-upload="onHandleSceneChatImageUpload"
          :on-submit-scene-chat="onSubmitSceneChat"
        />
      </div>

      <!-- Video preview panel -->
      <div class="order-3 min-h-0 flex flex-col rounded-lg border bg-muted/5">
        <template v-if="selectedScene">
          <div class="space-y-2 border-b px-4 py-3">
            <div class="text-xs font-medium text-muted-foreground">
              视频预览
            </div>
            <div class="text-sm font-medium">
              {{ selectedScene.title }}
            </div>
            <div
              v-if="selectedSceneVoiceReferenceSummary?.hasDialogue"
              class="flex flex-wrap items-center gap-1.5"
            >
              <AssetWorkbenchSceneVoiceReferenceSummary :summary="selectedSceneVoiceReferenceSummary" />
            </div>
          </div>
          <div class="flex-1 flex items-center justify-center p-4">
            <div class="w-full aspect-video overflow-hidden rounded-lg bg-black/90">
              <video
                v-if="selectedScene.videoUrl"
                :src="selectedScene.videoUrl"
                controls
                class="h-full w-full"
              />
              <div
                v-else
                class="flex h-full w-full items-center justify-center"
              >
                <span class="text-xs text-gray-400">等待生成视频</span>
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
