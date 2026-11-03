<script setup lang="ts">
import type { LibraryAsset } from '#shared/types/library'
import { AudioLines, Download, Film, Link2, Loader2, Plus, Trash2 } from 'lucide-vue-next'
import type {
  AutoStageKey,
  FinalMergeOptions,
  FinalMergeTransitionType
} from '~/lib/asset-workbench-types'
import Timeline from '~/components/video/Timeline.vue'
import { markLibraryAssetUsed } from '~/lib/library-api'
import { resolveVideoPreviewAspectRatio } from '~/lib/video-preview-aspect-ratio'
import { moveListItem, resolveTimelineSegment } from '~/lib/asset-workbench-final-timeline'
import { vReadOnlyFence } from '~/lib/read-only-fence'

interface FinalStageSceneItem {
  id: string
  title: string
  duration: number
  videoUrl?: string
  thumbnail?: string
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
}

const props = defineProps<{
  hint: string
  projectAspectRatio: string
  queueDone: number
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
  mergeRunning: boolean
  exportingJianyingProject: boolean
  finalVideoUrl?: string
  scenes: FinalStageSceneItem[]
  sceneOrder: string[]
  mergeOptions: FinalMergeOptions
  /** Read-only projects can still preview and, with export permission, export. */
  readOnly?: boolean
  canExport?: boolean
}>()

const fenceOptions = computed(() => ({
  readOnly: !!props.readOnly,
  conditional: [{ selector: '[data-export]', enabled: props.canExport !== false }]
}))

const previewAspectRatio = computed(() => resolveVideoPreviewAspectRatio(props.projectAspectRatio))

const emit = defineEmits<{
  (e: 'run-final', payload?: FinalMergeOptions): void
  (e: 'export-jianying-project'): void
  (e: 'update-scene-order', sceneIds: string[]): void
  (e: 'update-merge-options', payload: Partial<FinalMergeOptions>): void
}>()

const transitionOptions: Array<{ label: string, value: FinalMergeTransitionType }> = [
  { label: '无', value: 'none' },
  { label: '淡入淡出', value: 'fade' },
  { label: '叠化', value: 'dissolve' },
  { label: '擦除', value: 'wipe' }
]

const orderedScenes = computed(() => {
  if (props.scenes.length === 0) return []

  const sceneMap = new Map(props.scenes.map(scene => [scene.id, scene] as const))
  const ordered: FinalStageSceneItem[] = []
  const used = new Set<string>()

  for (const sceneId of props.sceneOrder) {
    const scene = sceneMap.get(sceneId)
    if (!scene || used.has(sceneId)) continue
    ordered.push(scene)
    used.add(sceneId)
  }

  for (const scene of props.scenes) {
    if (used.has(scene.id)) continue
    ordered.push(scene)
  }

  return ordered
})

const timelineScenes = computed(() => {
  let offset = 0
  return orderedScenes.value.map((scene) => {
    const status = scene.videoStatus === 'done'
      ? 'completed'
      : scene.videoStatus === 'generating'
        ? 'processing'
        : scene.videoStatus === 'error'
          ? 'failed'
          : 'pending'

    const item = {
      id: scene.id,
      title: scene.title,
      duration: Math.max(0.5, Number(scene.duration) || 0),
      startTime: offset,
      status,
      thumbnail: scene.thumbnail
    } as const
    offset += item.duration
    return item
  })
})

const timelineTotalDuration = computed(() => {
  return timelineScenes.value.reduce((sum, scene) => sum + scene.duration, 0)
})

function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ---- Preview: plays the scene videos in timeline order ----
type PreviewMode = 'sequence' | 'final'
const previewMode = ref<PreviewMode>(props.finalVideoUrl ? 'final' : 'sequence')
const timelineCurrentTime = ref(0)
const timelinePlaying = ref(false)
const sequenceVideo = ref<HTMLVideoElement | null>(null)
const audioPickerOpen = ref(false)

const currentSegment = computed(() => resolveTimelineSegment(timelineScenes.value, timelineCurrentTime.value))
const currentPreviewScene = computed(() => {
  const segment = currentSegment.value
  return segment ? orderedScenes.value[segment.index] : undefined
})

watch(() => props.finalVideoUrl, (url, previous) => {
  // A freshly merged video is what the user wants to see next.
  if (url && url !== previous) previewMode.value = 'final'
})

watch(previewMode, (mode) => {
  if (mode === 'final') timelinePlaying.value = false
})

watch(timelineTotalDuration, (duration) => {
  if (timelineCurrentTime.value > duration) timelineCurrentTime.value = duration
})

// Times written by the video itself must not seek it back.
let lastVideoReportedTime = -1

function handleSequenceTimeUpdate() {
  const video = sequenceVideo.value
  const segment = currentSegment.value
  if (!video || !segment) return
  const time = segment.startTime + Math.min(video.currentTime, segment.duration)
  lastVideoReportedTime = time
  timelineCurrentTime.value = time
}

function handleSequenceEnded() {
  const segment = currentSegment.value
  if (!segment) return
  const next = timelineScenes.value[segment.index + 1]
  if (!next) {
    timelinePlaying.value = false
    return
  }
  lastVideoReportedTime = -1
  timelineCurrentTime.value = next.startTime
}

function syncVideoToTimeline() {
  const video = sequenceVideo.value
  const segment = currentSegment.value
  if (!video || !segment) return
  if (Math.abs(timelineCurrentTime.value - lastVideoReportedTime) < 0.05) return
  const offset = Math.max(0, timelineCurrentTime.value - segment.startTime)
  if (Number.isFinite(video.duration) && offset >= video.duration) return
  video.currentTime = offset
}

watch(timelineCurrentTime, () => {
  syncVideoToTimeline()
})

watch(() => currentPreviewScene.value?.videoUrl, async () => {
  await nextTick()
  if (timelinePlaying.value) playSequenceVideo()
})

watch(timelinePlaying, async (playing) => {
  if (playing) {
    previewMode.value = 'sequence'
    if (timelineCurrentTime.value >= timelineTotalDuration.value) timelineCurrentTime.value = 0
    await nextTick()
    playSequenceVideo()
  } else {
    sequenceVideo.value?.pause()
  }
})

function handleSequenceLoaded() {
  lastVideoReportedTime = -1
  syncVideoToTimeline()
}

function seekTimeline(time: number) {
  lastVideoReportedTime = -1
  timelineCurrentTime.value = time
}

function handleSceneClick(scene: { startTime: number }) {
  previewMode.value = 'sequence'
  seekTimeline(scene.startTime)
}

// Switching to the next clip aborts the previous play() call; only a blocked
// autoplay should stop playback.
function playSequenceVideo() {
  void sequenceVideo.value?.play().catch((error: unknown) => {
    if ((error as { name?: string })?.name === 'NotAllowedError') timelinePlaying.value = false
  })
}

function handleSceneReorder(fromIndex: number, toIndex: number) {
  timelinePlaying.value = false
  emit('update-scene-order', moveListItem(orderedScenes.value.map(scene => scene.id), fromIndex, toIndex))
}

// ---- Merge options ----
function updateTransitionType(value: string) {
  const selected = transitionOptions.find(option => option.value === value)?.value || 'none'
  emit('update-merge-options', { transitionType: selected })
}

function updateTransitionDuration(value: string) {
  const parsed = Number(value)
  const duration = Number.isFinite(parsed) ? Math.max(0.1, Math.min(2, parsed)) : 0.5
  emit('update-merge-options', { transitionDuration: duration })
}

function updateSubtitleEnabled(value: boolean) {
  emit('update-merge-options', { addSubtitles: value })
}

// Older projects may still carry a BGM link instead of a BGM track.
const hasBgmTrack = computed(() => (props.mergeOptions.audioTracks || []).some(track => track.kind === 'bgm'))
const legacyBgmUrl = computed(() => (props.mergeOptions.bgmUrl || '').trim())

function updateBgmVolume(value: string) {
  const parsed = Number(value)
  const volume = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.3
  emit('update-merge-options', { bgmVolume: volume })
}

function removeLegacyBgm() {
  emit('update-merge-options', { bgmUrl: '' })
}

const timelineAudioTracks = computed(() => {
  const tracks = (props.mergeOptions.audioTracks || []).map(track => ({
    id: track.id,
    name: track.name,
    kind: track.kind,
    startTime: track.startTime,
    duration: track.duration
  }))
  if (legacyBgmUrl.value && !hasBgmTrack.value) {
    tracks.unshift({ id: 'legacy-bgm', name: 'BGM 链接', kind: 'bgm', startTime: 0, duration: undefined })
  }
  return tracks
})

function addLibraryAudio(payload: { asset: LibraryAsset }) {
  const asset = payload.asset
  const kind = asset.category === 'bgm' ? 'bgm' as const : 'sfx' as const
  const existing = props.mergeOptions.audioTracks || []
  const withoutPreviousBgm = kind === 'bgm' ? existing.filter(track => track.kind !== 'bgm') : existing
  emit('update-merge-options', {
    audioTracks: [
      ...withoutPreviousBgm,
      {
        id: `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        assetId: asset.id,
        assetVersion: asset.version,
        name: asset.name,
        kind,
        url: asset.url,
        startTime: 0,
        duration: kind === 'sfx' && asset.durationMs ? asset.durationMs / 1000 : undefined,
        volume: kind === 'bgm' ? 0.3 : 0.6
      }
    ]
  })
  void markLibraryAssetUsed(asset.id).catch(() => undefined)
}

function updateAudioTrack(trackId: string, patch: Record<string, number>) {
  emit('update-merge-options', {
    audioTracks: (props.mergeOptions.audioTracks || []).map(track => track.id === trackId
      ? { ...track, ...patch }
      : track)
  })
}

function removeAudioTrack(trackId: string) {
  emit('update-merge-options', {
    audioTracks: (props.mergeOptions.audioTracks || []).filter(track => track.id !== trackId)
  })
}

function handleRunFinal() {
  emit('run-final', {
    ...props.mergeOptions,
    sceneOrder: orderedScenes.value.map(scene => scene.id)
  })
}
</script>

<template>
  <AssetWorkbenchStagePanel
    v-read-only-fence="fenceOptions"
    content-class="flex-1 min-h-0 space-y-3 overflow-y-auto"
  >
    <div class="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
      <!-- Preview -->
      <section
        class="flex min-w-0 flex-col rounded-xl bg-muted/10"
        aria-label="预览"
      >
        <div class="flex items-center justify-between gap-3 border-b px-4 py-2.5">
          <div
            class="flex items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 text-xs"
            role="group"
            aria-label="预览内容"
            data-readonly-allowed
          >
            <button
              type="button"
              class="rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="previewMode === 'sequence' ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="previewMode === 'sequence'"
              @click="previewMode = 'sequence'"
            >
              按顺序预览
            </button>
            <button
              type="button"
              class="rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              :class="previewMode === 'final' ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="previewMode === 'final'"
              :disabled="!finalVideoUrl"
              :title="finalVideoUrl ? undefined : '合成后可查看成片'"
              @click="previewMode = 'final'"
            >
              成片
            </button>
          </div>
          <p class="min-w-0 truncate text-xs text-muted-foreground">
            <template v-if="previewMode === 'final'">
              已合成的最终视频
            </template>
            <template v-else-if="currentPreviewScene && currentSegment">
              {{ currentSegment.index + 1 }} / {{ timelineScenes.length }} · {{ currentPreviewScene.title }}
            </template>
          </p>
        </div>
        <div class="flex min-h-[240px] flex-1 items-start justify-center p-4">
          <div
            class="max-h-[48vh] max-w-full overflow-hidden rounded-lg bg-black/90 outline outline-1 outline-white/10"
            :class="previewAspectRatio.portrait ? 'h-[48vh] w-auto' : 'h-auto w-full'"
            :style="{ aspectRatio: previewAspectRatio.cssValue }"
          >
            <video
              v-if="previewMode === 'final' && finalVideoUrl"
              :key="finalVideoUrl"
              :src="finalVideoUrl"
              controls
              class="h-full w-full object-contain"
              playsinline
            />
            <video
              v-else-if="currentPreviewScene?.videoUrl"
              ref="sequenceVideo"
              :src="currentPreviewScene.videoUrl"
              class="h-full w-full object-contain"
              playsinline
              preload="auto"
              @loadedmetadata="handleSequenceLoaded"
              @timeupdate="handleSequenceTimeUpdate"
              @ended="handleSequenceEnded"
            />
            <div
              v-else
              class="flex h-full w-full items-center justify-center px-6 text-center text-xs text-white/50"
            >
              还没有可合成的分镜视频，先在「分镜视频」中生成。
            </div>
          </div>
        </div>
      </section>

      <!-- Settings and actions -->
      <aside class="flex flex-col gap-3 rounded-xl bg-muted/25 p-3">
        <div class="flex items-baseline justify-between text-xs">
          <span class="font-medium text-foreground">合成设置</span>
          <span class="tabular-nums text-muted-foreground">
            {{ orderedScenes.length }} 段 · {{ formatDuration(timelineTotalDuration) }}
          </span>
        </div>

        <div class="space-y-1">
          <label
            for="final-transition-type"
            class="text-xs text-muted-foreground"
          >转场类型</label>
          <Select
            :model-value="mergeOptions.transitionType || 'none'"
            @update:model-value="updateTransitionType(String($event))"
          >
            <SelectTrigger
              id="final-transition-type"
              class="h-8 text-xs"
            >
              <SelectValue placeholder="选择转场" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="item in transitionOptions"
                :key="`final_transition_${item.value}`"
                :value="item.value"
              >
                {{ item.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          v-if="(mergeOptions.transitionType || 'none') !== 'none'"
          class="space-y-1"
        >
          <label
            for="final-transition-duration"
            class="text-xs text-muted-foreground"
          >转场时长（0.1 - 2 秒）</label>
          <Input
            id="final-transition-duration"
            type="number"
            min="0.1"
            max="2"
            step="0.1"
            class="h-8 text-xs"
            :model-value="String(mergeOptions.transitionDuration ?? 0.5)"
            @update:model-value="updateTransitionDuration(String($event))"
          />
        </div>

        <label class="flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-2">
          <span class="text-xs text-muted-foreground">合成时叠加字幕</span>
          <Switch
            :checked="mergeOptions.addSubtitles === true"
            @update:checked="updateSubtitleEnabled(!!$event)"
          />
        </label>

        <div class="mt-auto space-y-2 pt-1">
          <Button
            :disabled="autoRunning || mergeRunning || queueDone === 0"
            class="w-full gap-2"
            @click="handleRunFinal"
          >
            <Loader2
              v-if="mergeRunning || (autoRunning && autoRunCurrentStage === 'final')"
              class="h-4 w-4 animate-spin"
            />
            <Film
              v-else
              class="h-4 w-4"
            />
            {{ finalVideoUrl ? '重新合成成片' : '合成最终视频' }}
          </Button>
          <div class="grid grid-cols-2 gap-2">
            <Button
              data-export
              variant="outline"
              size="sm"
              class="gap-1.5 text-xs"
              :disabled="exportingJianyingProject || orderedScenes.length === 0"
              @click="emit('export-jianying-project')"
            >
              <Loader2
                v-if="exportingJianyingProject"
                class="h-3.5 w-3.5 animate-spin"
              />
              <Download
                v-else
                class="h-3.5 w-3.5"
              />
              导出剪映工程
            </Button>
            <a
              v-if="finalVideoUrl"
              data-export
              :href="finalVideoUrl"
              download="final-video.mp4"
              class="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-muted/50 px-3 text-xs font-semibold transition-colors hover:bg-muted/75"
            >
              <Download class="h-3.5 w-3.5" />
              下载成片
            </a>
          </div>
          <p
            v-if="queueDone === 0"
            class="text-xs text-muted-foreground"
          >
            还没有已生成的分镜视频，暂时无法合成。
          </p>
        </div>
      </aside>
    </div>

    <Timeline
      :scenes="timelineScenes"
      :current-time="timelineCurrentTime"
      :playing="timelinePlaying"
      :audio-tracks="timelineAudioTracks"
      :subtitles-enabled="mergeOptions.addSubtitles === true"
      :reorderable="!readOnly"
      @update:current-time="seekTimeline"
      @update:playing="timelinePlaying = $event"
      @scene-click="handleSceneClick"
      @scene-reorder="handleSceneReorder"
    />

    <!-- Audio -->
    <section class="rounded-xl bg-muted/25 p-3">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 class="text-xs font-medium">
            音频
          </h3>
          <p class="mt-0.5 text-xs text-muted-foreground">
            背景音乐覆盖全片，音效可设置开始时间和长度。音频从个人资源库中选择。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          class="gap-1.5"
          @click="audioPickerOpen = true"
        >
          <Plus class="h-3.5 w-3.5" />添加音频
        </Button>
      </div>

      <div
        v-if="!mergeOptions.audioTracks?.length && !(legacyBgmUrl && !hasBgmTrack)"
        class="rounded-xl bg-muted/15 px-3 py-5 text-center text-xs text-muted-foreground"
      >
        暂无 BGM 或音效
      </div>
      <div
        v-else
        class="space-y-2"
      >
        <div
          v-if="legacyBgmUrl && !hasBgmTrack"
          class="rounded-xl bg-muted/15 p-2.5"
        >
          <div class="flex items-center gap-2">
            <Link2 class="h-4 w-4 text-primary" />
            <span
              class="min-w-0 flex-1 truncate text-xs font-medium"
              :title="legacyBgmUrl"
            >BGM 链接 · {{ legacyBgmUrl }}</span>
            <span class="text-xs text-muted-foreground">BGM</span>
            <IconActionButton
              label="移除 BGM 链接"
              destructive
              @click="removeLegacyBgm"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </IconActionButton>
          </div>
          <label class="mt-2 block max-w-[200px] space-y-1">
            <span class="text-xs text-muted-foreground">音量</span>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.05"
              class="h-7 text-xs"
              :model-value="String(mergeOptions.bgmVolume ?? 0.3)"
              @update:model-value="updateBgmVolume(String($event))"
            />
          </label>
        </div>
        <div
          v-for="track in mergeOptions.audioTracks"
          :key="track.id"
          class="rounded-xl bg-muted/15 p-2.5"
        >
          <div class="flex items-center gap-2">
            <AudioLines class="h-4 w-4 text-primary" />
            <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ track.name }}</span>
            <span class="text-xs text-muted-foreground">{{ track.kind === 'bgm' ? 'BGM' : '音效' }}</span>
            <IconActionButton
              label="删除音轨"
              destructive
              @click="removeAudioTrack(track.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </IconActionButton>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label class="space-y-1"><span class="text-xs text-muted-foreground">开始秒数</span><Input
              type="number"
              min="0"
              step="0.1"
              class="h-7 text-xs"
              :disabled="track.kind === 'bgm'"
              :model-value="String(track.startTime)"
              @update:model-value="updateAudioTrack(track.id, { startTime: Math.max(0, Number($event) || 0) })"
            /></label>
            <label
              v-if="track.kind === 'sfx'"
              class="space-y-1"
            ><span class="text-xs text-muted-foreground">播放时长</span><Input
              type="number"
              min="0.1"
              step="0.1"
              class="h-7 text-xs"
              :model-value="String(track.duration || 1)"
              @update:model-value="updateAudioTrack(track.id, { duration: Math.max(0.1, Number($event) || 1) })"
            /></label>
            <label class="space-y-1"><span class="text-xs text-muted-foreground">音量</span><Input
              type="number"
              min="0"
              max="1"
              step="0.05"
              class="h-7 text-xs"
              :model-value="String(track.volume)"
              @update:model-value="updateAudioTrack(track.id, { volume: Math.max(0, Math.min(1, Number($event) || 0)) })"
            /></label>
          </div>
        </div>
      </div>
    </section>

    <LibraryAssetPickerDialog
      v-model:open="audioPickerOpen"
      :categories="['bgm', 'sfx']"
      :allow-create="false"
      title="选择 BGM 或音效"
      @select="addLibraryAudio"
    />
  </AssetWorkbenchStagePanel>
</template>
