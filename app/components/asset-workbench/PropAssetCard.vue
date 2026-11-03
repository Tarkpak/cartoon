<script setup lang="ts">
import {
  AudioLines,
  Check,
  Clapperboard,
  Copy,
  History,
  ImageOff,
  ImageUp,
  Loader2,
  Lock,
  LockOpen,
  Maximize2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-vue-next'
import LazyImage from '~/components/LazyImage.vue'
import SaveToPersonalLibraryButton from './SaveToPersonalLibraryButton.vue'
import type { PropAsset, PropAssetMediaType } from '~/composables/useAssetWorkflowMeta'

type EditableField = 'name' | 'description'

const props = withDefaults(defineProps<{
  asset: PropAsset
  mediaType: PropAssetMediaType
  usageCount: number
  mentionToken: string
  assetLabel: string
  autoRunning: boolean
  uploading: boolean
  /** 同类上传正在进行（任一资产），用于禁用上传入口 */
  uploadBusy: boolean
  generating: boolean
  generateBusy: boolean
  historyCount: number
  libraryAssetKey: string
  savingLibraryAssetKey?: string | null
}>(), {
  savingLibraryAssetKey: null
})

const emit = defineEmits<{
  'update-field': [payload: { field: EditableField, value: string }]
  'upload': [event: Event]
  'generate': []
  'remove': []
  'open-history': []
  'save-to-library': []
  'preview-image': [payload: { src: string | undefined, alt: string }]
  'update-voice-lock': [locked: boolean]
}>()

const MEDIA_ACCEPT: Record<PropAssetMediaType, string> = {
  image: 'image/*',
  voice: 'audio/*,.mp3,.wav,.m4a,.aac,.flac',
  video: 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v'
}

const MEDIA_UPLOAD_COPY: Record<PropAssetMediaType, { title: string, hint: string, replace: string }> = {
  image: { title: '上传参考图', hint: '点击或拖拽图片，也可 AI 生成', replace: '更换图片' },
  voice: { title: '上传参考音频', hint: '点击或拖拽 mp3 / wav / m4a', replace: '替换音频' },
  video: { title: '上传参考视频', hint: '点击或拖拽 mp4 / mov / webm，≤ 50MB', replace: '替换视频' }
}

const fileInput = ref<HTMLInputElement | null>(null)
const infoSection = ref<HTMLElement | null>(null)
const videoElement = ref<HTMLVideoElement | null>(null)
const editingField = ref<EditableField | null>(null)
const editDraft = ref('')
const dragActive = ref(false)
const imageLoadFailed = ref(false)
const videoDuration = ref<number | null>(null)
const videoDialogOpen = ref(false)
const mentionCopied = ref(false)

const uploadCopy = computed(() => MEDIA_UPLOAD_COPY[props.mediaType])
const imageUrl = computed(() => props.asset.referenceImage?.trim() || '')
const audioUrl = computed(() => props.asset.voiceAsset?.audioUrl?.trim() || '')
const videoUrl = computed(() => props.asset.videoAsset?.videoUrl?.trim() || '')
const mediaUrl = computed(() => {
  if (props.mediaType === 'voice') return audioUrl.value
  if (props.mediaType === 'video') return videoUrl.value
  return imageUrl.value
})
const hasMedia = computed(() => !!mediaUrl.value)
const uploadDisabled = computed(() => props.autoRunning || props.uploadBusy)
const showLibraryButton = computed(() => props.mediaType !== 'video')
const usageText = computed(() => props.usageCount > 0 ? `${props.usageCount} 个场景引用` : '未被引用')
const voiceSourceText = computed(() => {
  const voiceAsset = props.asset.voiceAsset
  if (!voiceAsset?.audioUrl) return ''
  return voiceAsset.sourceSceneId || voiceAsset.sourceTaskId ? '自动提取' : '手动上传'
})
const durationText = computed(() => {
  const seconds = videoDuration.value
  if (seconds === null || !Number.isFinite(seconds)) return ''
  const total = Math.max(0, Math.round(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
})

watch(imageUrl, () => {
  imageLoadFailed.value = false
})

watch(videoUrl, () => {
  videoDuration.value = null
})

function triggerUpload() {
  if (uploadDisabled.value) return
  fileInput.value?.click()
}

function handleDragOver(event: DragEvent) {
  if (uploadDisabled.value || !event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragActive.value = true
}

function handleDrop(event: DragEvent) {
  dragActive.value = false
  const files = event.dataTransfer?.files
  const input = fileInput.value
  if (uploadDisabled.value || !files?.length || !input || input.disabled) return
  event.preventDefault()
  // 复用 file input 的 change 流程，上传校验与重置逻辑保持一致
  input.files = files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function startEdit(field: EditableField) {
  if (props.autoRunning) return
  editingField.value = field
  editDraft.value = props.asset[field] || ''
  void nextTick(() => {
    const input = infoSection.value?.querySelector('input')
    input?.focus()
    input?.select()
  })
}

function commitEdit() {
  const field = editingField.value
  if (!field) return
  const value = editDraft.value.trim()
  editingField.value = null
  // 名称不能清空：清空视为放弃修改
  if (field === 'name' && !value) return
  if (value === (props.asset[field] || '').trim()) return
  emit('update-field', { field, value })
}

function cancelEdit() {
  editingField.value = null
}

async function copyMentionToken() {
  if (!props.mentionToken) return
  try {
    await navigator.clipboard.writeText(props.mentionToken)
    mentionCopied.value = true
    setTimeout(() => {
      mentionCopied.value = false
    }, 1500)
  } catch {
    useToast().toast.error('复制失败，请手动输入引用')
  }
}

function playVideoPreview() {
  const video = videoElement.value
  if (!video) return
  video.muted = true
  void video.play().catch(() => undefined)
}

function stopVideoPreview() {
  const video = videoElement.value
  if (!video) return
  video.pause()
  video.currentTime = 0
}

function handleVideoMetadata() {
  const duration = videoElement.value?.duration
  videoDuration.value = typeof duration === 'number' && Number.isFinite(duration) ? duration : null
}

function openImagePreview() {
  if (!imageUrl.value || imageLoadFailed.value) return
  emit('preview-image', { src: imageUrl.value, alt: `${props.asset.name} 参考图` })
}
</script>

<template>
  <article class="group flex flex-col overflow-hidden rounded-xl bg-muted/25 transition-colors hover:bg-muted/35">
    <!-- Cover：媒体本身就是卡片主体 -->
    <div
      class="relative aspect-video overflow-hidden"
      :class="[
        mediaType === 'video' && hasMedia ? 'bg-black' : 'bg-muted/40',
        dragActive ? 'ring-2 ring-inset ring-primary' : ''
      ]"
      @dragover="handleDragOver"
      @dragleave="dragActive = false"
      @drop="handleDrop"
    >
      <!-- 空状态：上传区 -->
      <button
        v-if="!hasMedia"
        type="button"
        class="absolute inset-2 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/25 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="uploadDisabled || generating"
        @click="triggerUpload"
      >
        <Loader2
          v-if="uploading || generating"
          class="h-5 w-5 animate-spin text-primary"
        />
        <Upload
          v-else
          class="h-5 w-5"
        />
        <span class="text-xs font-medium">
          {{ uploading ? '上传中…' : generating ? '生成中…' : uploadCopy.title }}
        </span>
        <span
          v-if="!uploading && !generating"
          class="px-3 text-center text-[11px] leading-tight text-muted-foreground/80"
        >
          {{ uploadCopy.hint }}
        </span>
      </button>

      <!-- 图片 -->
      <template v-else-if="mediaType === 'image'">
        <button
          v-if="!imageLoadFailed"
          type="button"
          class="h-full w-full cursor-zoom-in"
          :aria-label="`预览 ${asset.name} 参考图`"
          data-readonly-allowed
          @click="openImagePreview"
        >
          <LazyImage
            :image="imageUrl"
            :alt="`${asset.name} 参考图`"
            class="h-full w-full object-cover"
            @error="imageLoadFailed = true"
          />
        </button>
        <div
          v-else
          class="flex h-full w-full flex-col items-center justify-center gap-1 text-destructive/80"
        >
          <ImageOff class="h-5 w-5" />
          <span class="text-xs">图片加载失败</span>
        </div>
      </template>

      <!-- 声音 -->
      <div
        v-else-if="mediaType === 'voice'"
        class="flex h-full w-full flex-col justify-between bg-gradient-to-br from-primary/10 via-muted/30 to-muted/10 p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
            <AudioLines class="h-4 w-4" />
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60"
            :class="asset.voiceAsset?.locked
              ? 'bg-primary/15 text-primary hover:bg-primary/20'
              : 'bg-background/70 text-muted-foreground hover:text-foreground'"
            :aria-pressed="!!asset.voiceAsset?.locked"
            :disabled="autoRunning || uploading"
            :title="asset.voiceAsset?.locked ? '已锁定：含旁白的镜头优先复用该音色，点击取消' : '点击锁定为旁白参考音色'"
            @click="emit('update-voice-lock', !asset.voiceAsset?.locked)"
          >
            <Lock
              v-if="asset.voiceAsset?.locked"
              class="h-3 w-3"
            />
            <LockOpen
              v-else
              class="h-3 w-3"
            />
            {{ asset.voiceAsset?.locked ? '已锁定' : '未锁定' }}
          </button>
        </div>
        <audio
          :src="audioUrl"
          class="h-8 w-full"
          controls
          preload="none"
          data-readonly-allowed
        />
      </div>

      <!-- 视频：悬停静音预览，点击放大播放 -->
      <template v-else>
        <video
          ref="videoElement"
          :src="videoUrl"
          class="h-full w-full object-contain"
          muted
          loop
          playsinline
          preload="metadata"
          @loadedmetadata="handleVideoMetadata"
          @mouseenter="playVideoPreview"
          @mouseleave="stopVideoPreview"
        />
        <button
          type="button"
          class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label="放大播放"
          data-readonly-allowed
          @click="videoDialogOpen = true"
        >
          <Maximize2 class="h-3.5 w-3.5" />
        </button>
        <span
          v-if="durationText"
          class="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white"
        >
          {{ durationText }}
        </span>
      </template>

      <!-- 已有媒体时的上传/生成遮罩 -->
      <div
        v-if="hasMedia && (uploading || generating)"
        class="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs font-medium"
      >
        <Loader2 class="h-4 w-4 animate-spin text-primary" />
        {{ uploading ? '上传中…' : '生成中…' }}
      </div>

      <input
        ref="fileInput"
        type="file"
        :accept="MEDIA_ACCEPT[mediaType]"
        class="hidden"
        @change="emit('upload', $event)"
      >
    </div>

    <!-- Info -->
    <div
      ref="infoSection"
      class="flex flex-1 flex-col gap-1 px-3 pb-2 pt-2.5"
    >
      <Input
        v-if="editingField === 'name'"
        v-model="editDraft"
        class="h-7 text-sm font-medium"
        :placeholder="`${assetLabel}名称`"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @blur="commitEdit"
      />
      <button
        v-else
        type="button"
        class="group/name flex min-w-0 items-center gap-1 text-left"
        :disabled="autoRunning"
        :title="`编辑${assetLabel}名称`"
        @click="startEdit('name')"
      >
        <span class="truncate text-sm font-medium">{{ asset.name || `未命名${assetLabel}` }}</span>
        <Pencil class="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/name:opacity-100" />
      </button>

      <Input
        v-if="editingField === 'description'"
        v-model="editDraft"
        class="h-7 text-xs"
        placeholder="描述（可选）"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @blur="commitEdit"
      />
      <button
        v-else
        type="button"
        class="line-clamp-2 min-h-[1rem] text-left text-xs"
        :class="asset.description ? 'text-muted-foreground' : 'text-muted-foreground/50 hover:text-muted-foreground'"
        :disabled="autoRunning"
        title="编辑描述"
        @click="startEdit('description')"
      >
        {{ asset.description || '添加描述…' }}
      </button>

      <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <button
          v-if="mentionToken"
          type="button"
          class="inline-flex max-w-full items-center gap-1 rounded-md bg-background/70 px-1.5 py-0.5 font-mono transition-colors hover:text-foreground"
          :title="`在分镜描述中输入 ${mentionToken} 引用该资产，点击复制`"
          data-readonly-allowed
          @click="copyMentionToken"
        >
          <span class="truncate">{{ mentionToken }}</span>
          <Check
            v-if="mentionCopied"
            class="h-3 w-3 shrink-0 text-success"
          />
          <Copy
            v-else
            class="h-3 w-3 shrink-0"
          />
        </button>
        <span v-if="mediaType === 'voice' && voiceSourceText">{{ voiceSourceText }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center justify-between gap-1 border-t border-border/50 px-3 py-1.5">
      <span
        class="text-xs"
        :class="usageCount > 0 ? 'text-muted-foreground' : 'text-muted-foreground/60'"
      >
        {{ usageText }}
      </span>
      <div class="flex items-center gap-0.5">
        <Button
          v-if="mediaType === 'image'"
          type="button"
          size="sm"
          :variant="imageUrl ? 'ghost' : 'default'"
          class="h-7 gap-1 px-2 text-xs"
          :disabled="autoRunning || uploading || generateBusy || !asset.name.trim()"
          @click="emit('generate')"
        >
          <Loader2
            v-if="generating"
            class="h-3 w-3 animate-spin"
          />
          <Sparkles
            v-else
            class="h-3 w-3"
          />
          {{ generating ? '生成中' : imageUrl ? '重新生成' : 'AI 生成' }}
        </Button>
        <IconActionButton
          v-if="hasMedia"
          :label="uploadCopy.replace"
          :disabled="uploadDisabled || generating"
          :loading="uploading"
          @click="triggerUpload"
        >
          <ImageUp
            v-if="mediaType === 'image'"
            class="h-3.5 w-3.5"
          />
          <RefreshCw
            v-else
            class="h-3.5 w-3.5"
          />
        </IconActionButton>
        <IconActionButton
          v-if="historyCount > 1"
          :label="`历史版本（${historyCount}）`"
          :badge="historyCount"
          @click="emit('open-history')"
        >
          <History class="h-3.5 w-3.5" />
        </IconActionButton>
        <SaveToPersonalLibraryButton
          v-if="showLibraryButton"
          icon-only
          :asset-key="libraryAssetKey"
          :available="hasMedia"
          :busy="!!savingLibraryAssetKey"
          :saving="savingLibraryAssetKey === libraryAssetKey"
          @save="emit('save-to-library')"
        />
        <IconActionButton
          :label="`删除${assetLabel}`"
          destructive
          @click="emit('remove')"
        >
          <Trash2 class="h-3.5 w-3.5" />
        </IconActionButton>
      </div>
    </div>

    <Dialog
      v-if="mediaType === 'video' && videoUrl"
      :open="videoDialogOpen"
      @update:open="videoDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <Clapperboard class="h-4 w-4 text-primary" />
            {{ asset.name || '参考视频' }}
          </DialogTitle>
          <DialogDescription>
            {{ asset.description || '在分镜描述中引用后，生成视频时作为参考视频提交。' }}
          </DialogDescription>
        </DialogHeader>
        <video
          :src="videoUrl"
          class="max-h-[70vh] w-full rounded-md bg-black"
          controls
          autoplay
          playsinline
        />
      </DialogContent>
    </Dialog>
  </article>
</template>
