<script setup lang="ts">
import type { LibraryAsset } from '#shared/types/library'
import { ArrowDown, ArrowUp, AudioLines, Download, Film, Loader2, Plus, Trash2 } from 'lucide-vue-next'
import type {
  AutoStageKey,
  FinalMergeOptions,
  FinalMergeTransitionType
} from '~/lib/asset-workbench-types'
import Timeline from '~/components/video/Timeline.vue'
import { markLibraryAssetUsed } from '~/lib/library-api'

interface FinalStageSceneItem {
  id: string
  title: string
  duration: number
  videoUrl?: string
  videoStatus: 'pending' | 'generating' | 'done' | 'error'
}

const props = defineProps<{
  hint: string
  queueDone: number
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
  mergeRunning: boolean
  exportingJianyingProject: boolean
  finalVideoUrl?: string
  scenes: FinalStageSceneItem[]
  sceneOrder: string[]
  mergeOptions: FinalMergeOptions
}>()

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
      thumbnail: undefined
    } as const
    offset += item.duration
    return item
  })
})

const timelineCurrentTime = ref(0)
const timelinePlaying = ref(false)
const audioPickerOpen = ref(false)
let timelineTimer: ReturnType<typeof setInterval> | null = null

const timelineTotalDuration = computed(() => {
  return timelineScenes.value.reduce((sum, scene) => sum + scene.duration, 0)
})

function stopTimelinePlayback() {
  if (!timelineTimer) return
  clearInterval(timelineTimer)
  timelineTimer = null
}

watch(
  () => timelinePlaying.value,
  (playing) => {
    stopTimelinePlayback()
    if (!playing) return

    timelineTimer = setInterval(() => {
      const next = timelineCurrentTime.value + 0.2
      if (next >= timelineTotalDuration.value) {
        timelineCurrentTime.value = timelineTotalDuration.value
        timelinePlaying.value = false
        return
      }
      timelineCurrentTime.value = next
    }, 200)
  }
)

watch(
  () => timelineTotalDuration.value,
  (duration) => {
    if (timelineCurrentTime.value > duration) {
      timelineCurrentTime.value = duration
    }
  }
)

onBeforeUnmount(() => {
  stopTimelinePlayback()
})

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

function updateBgmUrl(value: string) {
  emit('update-merge-options', { bgmUrl: value })
}

function updateBgmVolume(value: string) {
  const parsed = Number(value)
  const volume = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.3
  emit('update-merge-options', { bgmVolume: volume })
}

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

function audioTrackStyle(track: NonNullable<FinalMergeOptions['audioTracks']>[number]) {
  const total = Math.max(0.5, timelineTotalDuration.value)
  const left = Math.max(0, Math.min(100, (track.startTime / total) * 100))
  const duration = track.kind === 'bgm' ? total : Math.max(0.1, track.duration || 1)
  const width = Math.max(2, Math.min(100 - left, (duration / total) * 100))
  return { left: `${left}%`, width: `${width}%` }
}

function moveScene(sceneId: string, direction: 'up' | 'down') {
  const current = orderedScenes.value.map(scene => scene.id)
  const index = current.findIndex(id => id === sceneId)
  if (index < 0) return

  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= current.length) return

  const next = current.slice()
  const temp = next[index]
  const target = next[swapIndex]
  if (!temp || !target) return

  next[index] = target
  next[swapIndex] = temp
  emit('update-scene-order', next)
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
    content-class="flex-1 min-h-0 space-y-4 overflow-y-auto"
  >
    <div class="flex flex-wrap items-center gap-4">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-violet-500" />
          可合成视频 {{ queueDone }} 个
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-blue-500" />
          时间线 {{ orderedScenes.length }} 段
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div class="space-y-3 rounded-xl bg-muted/25 p-3">
        <div class="text-xs font-medium text-muted-foreground">
          合成参数
        </div>

        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">
            转场类型
          </p>
          <Select
            :model-value="mergeOptions.transitionType || 'none'"
            @update:model-value="updateTransitionType(String($event))"
          >
            <SelectTrigger class="h-8 text-xs">
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

        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">
            转场时长（0.1 - 2 秒）
          </p>
          <Input
            type="number"
            min="0.1"
            max="2"
            step="0.1"
            class="h-8 text-xs"
            :model-value="String(mergeOptions.transitionDuration ?? 0.5)"
            @update:model-value="updateTransitionDuration(String($event))"
          />
        </div>

        <div class="flex items-center justify-between rounded-xl bg-muted/15 px-2.5 py-2">
          <p class="text-xs text-muted-foreground">
            合成时叠加字幕
          </p>
          <Switch
            :checked="mergeOptions.addSubtitles === true"
            @update:checked="updateSubtitleEnabled(!!$event)"
          />
        </div>

        <div class="space-y-1">
          <p class="text-xs text-muted-foreground">
            BGM 地址（可选）
          </p>
          <Input
            class="h-8 text-xs"
            placeholder="https://... 或 /audio/xxx.mp3"
            :model-value="mergeOptions.bgmUrl || ''"
            @update:model-value="updateBgmUrl(String($event))"
          />
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>BGM 音量</span>
            <span>{{ Number(mergeOptions.bgmVolume ?? 0.3).toFixed(2) }}</span>
          </div>
          <Input
            type="number"
            min="0"
            max="1"
            step="0.05"
            class="h-8 text-xs"
            :model-value="String(mergeOptions.bgmVolume ?? 0.3)"
            @update:model-value="updateBgmVolume(String($event))"
          />
        </div>
      </div>

      <div class="space-y-3">
        <div class="rounded-xl bg-muted/25 p-3">
          <div class="mb-2 text-xs font-medium text-muted-foreground">
            场景顺序（影响最终合成顺序）
          </div>

          <div
            v-if="orderedScenes.length === 0"
            class="rounded-xl bg-muted/15 px-3 py-4 text-xs text-muted-foreground"
          >
            暂无可合成场景
          </div>
          <div
            v-else
            class="max-h-56 space-y-1 overflow-y-auto"
          >
            <div
              v-for="(scene, index) in orderedScenes"
              :key="`final_scene_order_${scene.id}`"
              class="flex items-center gap-2 rounded-xl bg-muted/15 px-2 py-1.5"
            >
              <span class="w-5 text-xs text-muted-foreground">{{ index + 1 }}</span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-xs font-medium">
                  {{ scene.title }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ scene.duration }}s
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                class="h-7 w-7"
                :disabled="index === 0"
                @click="moveScene(scene.id, 'up')"
              >
                <ArrowUp class="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                class="h-7 w-7"
                :disabled="index === orderedScenes.length - 1"
                @click="moveScene(scene.id, 'down')"
              >
                <ArrowDown class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <Timeline
          :scenes="timelineScenes"
          :current-time="timelineCurrentTime"
          :playing="timelinePlaying"
          @update:current-time="timelineCurrentTime = $event"
          @update:playing="timelinePlaying = $event"
        />

        <div class="rounded-xl bg-muted/25 p-3">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 class="text-xs font-medium">音频时间线</h3>
              <p class="mt-0.5 text-xs text-muted-foreground">背景音乐覆盖全片，音效可设置开始时间和长度。</p>
            </div>
            <Button size="sm" variant="outline" class="gap-1.5" @click="audioPickerOpen = true"><Plus class="h-3.5 w-3.5" />添加音频</Button>
          </div>
          <div v-if="!mergeOptions.audioTracks?.length" class="rounded-xl bg-muted/15 px-3 py-5 text-center text-xs text-muted-foreground">暂无 BGM 或音效</div>
          <div v-else class="space-y-3">
            <div v-for="track in mergeOptions.audioTracks" :key="track.id" class="rounded-xl bg-muted/15 p-2.5">
              <div class="flex items-center gap-2">
                <AudioLines class="h-4 w-4 text-primary" />
                <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ track.name }}</span>
                <span class="text-xs text-muted-foreground">{{ track.kind === 'bgm' ? 'BGM' : '音效' }}</span>
                <Button size="icon" variant="ghost" class="h-7 w-7" title="删除音轨" @click="removeAudioTrack(track.id)"><Trash2 class="h-3.5 w-3.5" /></Button>
              </div>
              <div class="relative mt-2 h-6 overflow-hidden rounded bg-muted">
                <div class="absolute inset-y-1 rounded bg-primary/65" :style="audioTrackStyle(track)" />
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label class="space-y-1"><span class="text-[11px] text-muted-foreground">开始秒数</span><Input type="number" min="0" step="0.1" class="h-7 text-xs" :disabled="track.kind === 'bgm'" :model-value="String(track.startTime)" @update:model-value="updateAudioTrack(track.id, { startTime: Math.max(0, Number($event) || 0) })" /></label>
                <label v-if="track.kind === 'sfx'" class="space-y-1"><span class="text-[11px] text-muted-foreground">播放时长</span><Input type="number" min="0.1" step="0.1" class="h-7 text-xs" :model-value="String(track.duration || 1)" @update:model-value="updateAudioTrack(track.id, { duration: Math.max(0.1, Number($event) || 1) })" /></label>
                <label class="space-y-1"><span class="text-[11px] text-muted-foreground">音量</span><Input type="number" min="0" max="1" step="0.05" class="h-7 text-xs" :model-value="String(track.volume)" @update:model-value="updateAudioTrack(track.id, { volume: Math.max(0, Math.min(1, Number($event) || 0)) })" /></label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <LibraryAssetPickerDialog
      v-model:open="audioPickerOpen"
      :categories="['bgm', 'sfx']"
      :allow-create="false"
      title="选择 BGM 或音效"
      @select="addLibraryAudio"
    />

    <div class="flex items-center gap-3">
      <Button
        :disabled="autoRunning || mergeRunning || queueDone === 0"
        class="gap-2"
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
        合成最终视频
      </Button>
      <Button
        variant="outline"
        class="gap-2"
        :disabled="exportingJianyingProject || orderedScenes.length === 0"
        @click="emit('export-jianying-project')"
      >
        <Loader2
          v-if="exportingJianyingProject"
          class="h-4 w-4 animate-spin"
        />
        <Download
          v-else
          class="h-4 w-4"
        />
        导出剪映工程
      </Button>
      <a
        v-if="finalVideoUrl"
        :href="finalVideoUrl"
        download="final-video.mp4"
        class="inline-flex h-9 items-center gap-2 rounded-xl bg-muted/25 px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        <Download class="h-4 w-4" />
        下载成片
      </a>
    </div>

    <div
      v-if="finalVideoUrl"
      class="rounded-xl bg-muted/10"
    >
      <div class="px-4 py-3 border-b">
        <div class="text-xs font-medium text-muted-foreground">
          成片预览
        </div>
      </div>
      <div class="p-4">
        <div class="aspect-video overflow-hidden rounded-lg bg-black/90">
          <video
            :src="finalVideoUrl"
            controls
            class="h-full w-full"
          />
        </div>
      </div>
    </div>
  </AssetWorkbenchStagePanel>
</template>
