<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import {
  AudioLines,
  Film,
  ImagePlus,
  Loader2,
  Play,
  X
} from 'lucide-vue-next'
import type { ImageMentionCandidate } from '@/lib/image-prompt-reference-editor'
import {
  SETTINGS_MODEL_TEST_PLACEHOLDERS,
  type ModelTestTab,
  type TestResult
} from '@/lib/settings-models'

const activeTab = defineModel<ModelTestTab>('activeTab', { required: true })
const customPrompts = defineModel<Record<ModelTestTab, string>>('customPrompts', { required: true })
const imageAspectRatio = defineModel<string>('imageAspectRatio', { required: true })
const imageSize = defineModel<string>('imageSize', { required: true })
const imageQuality = defineModel<string>('imageQuality', { required: true })

const props = defineProps<{
  testResults: Record<ModelTestTab, TestResult>
  currentImageModelSupportsReference: boolean
  currentImageModelRequiresReference: boolean
  currentImageModelMaxReferenceImages: number
  currentImageModelAspectRatioOptions: string[]
  currentImageModelSizeOptions: string[]
  currentImageModelSizeSelectionMode: 'fixed' | 'preset' | 'constraint'
  currentImageModelSizeHelp: string
  currentImageModelQualityOptions: string[]
  canRunImageTest: boolean
  canRunVideoTest: boolean
  referenceImages: string[]
  videoReferenceImages: string[]
  videoReferenceVideos: string[]
  videoReferenceVideoNames: string[]
  videoFirstFrame: string | null
  videoLastFrame: string | null
  videoAudioReferences: string[]
  videoAudioReferenceNames: string[]
  currentVideoModelSupportsImageReference: boolean
  currentVideoModelSupportsReference: boolean
  currentVideoModelSupportsVideoReference: boolean
  currentVideoModelSupportsFirstLastFrame: boolean
  currentVideoModelSupportsAudioReference: boolean
  currentVideoModelRequiresReference: boolean
  currentVideoModelMaxReferenceImages: number
  currentVideoModelMaxReferenceVideos: number
  currentVideoModelMaxReferenceAudios: number
  currentVideoModelSupportsBothImageModes: boolean
  videoImageInputMode: 'firstLastFrame' | 'referenceImages'
  setFileInputRef: (element: Element | ComponentPublicInstance | null) => void
  setPromptEditorRef: (element: Element | ComponentPublicInstance | null) => void
  imagePromptIsEmpty: boolean
  imageMentionOpen: boolean
  imageMentionCandidates: ImageMentionCandidate[]
  imageMentionActiveIndex: number
  insertImageMention: (index: number) => void
  handlePromptTextareaInput: (event: Event) => void
  handlePromptTextareaCursorChange: () => void
  handlePromptTextareaFocus: () => void
  handlePromptTextareaCompositionStart: () => void
  handlePromptTextareaCompositionEnd: () => void
  handlePromptTextareaBlur: () => void
  handlePromptTextareaKeydown: (event: KeyboardEvent) => void
  handleReferenceImageUpload: (event: Event) => void
  removeReferenceImage: (index: number) => void
  handleVideoReferenceImageUpload: (event: Event) => void
  handleVideoReferenceVideoUpload: (event: Event) => void
  handleVideoFirstFrameUpload: (event: Event) => void
  handleVideoLastFrameUpload: (event: Event) => void
  removeVideoReferenceImage: (index: number) => void
  removeVideoReferenceVideo: (index: number) => void
  clearVideoFirstFrame: () => void
  clearVideoLastFrame: () => void
  handleVideoAudioReferenceUpload: (event: Event) => void
  removeVideoAudioReference: (index: number) => void
  clearVideoAudioReference: () => void
  triggerFileInput: () => void
  openReferenceImagePreview: (image: string, index: number) => void
  testModel: (modelType: ModelTestTab) => Promise<void>
}>()

const videoImageInputModeModel = defineModel<'firstLastFrame' | 'referenceImages'>('videoImageInputMode', { default: 'firstLastFrame' })

const currentTestStatus = computed(() => props.testResults[activeTab.value].status)
const videoReferenceInputRef = ref<HTMLInputElement | null>(null)
const videoReferenceVideoInputRef = ref<HTMLInputElement | null>(null)
const videoFirstFrameInputRef = ref<HTMLInputElement | null>(null)
const videoLastFrameInputRef = ref<HTMLInputElement | null>(null)
const videoAudioInputRef = ref<HTMLInputElement | null>(null)

function formatAspectRatioLabel(value: string): string {
  return value === 'auto' ? '自动 (auto)' : value
}

function formatImageQualityLabel(value: string): string {
  return value.toUpperCase()
}

function formatImageSizeLabel(value: string): string {
  return value.toUpperCase()
}

function triggerVideoReferenceInput() {
  videoReferenceInputRef.value?.click()
}

function triggerVideoReferenceVideoInput() {
  videoReferenceVideoInputRef.value?.click()
}

function triggerVideoFirstFrameInput() {
  videoFirstFrameInputRef.value?.click()
}

function triggerVideoLastFrameInput() {
  videoLastFrameInputRef.value?.click()
}

function triggerVideoAudioInput() {
  videoAudioInputRef.value?.click()
}

const canRunCurrentTabTest = computed(() => {
  if (activeTab.value === 'image') return props.canRunImageTest
  if (activeTab.value === 'video') return props.canRunVideoTest
  return true
})

const videoReferenceMaterialReady = computed(() => {
  if (props.currentVideoModelSupportsFirstLastFrame && props.videoFirstFrame) return true
  if (props.currentVideoModelSupportsImageReference && props.videoReferenceImages.length > 0) return true
  if (props.currentVideoModelSupportsVideoReference && props.videoReferenceVideos.length > 0) return true
  if (props.currentVideoModelSupportsAudioReference && props.videoAudioReferences.length > 0) return true
  return false
})
</script>

<template>
  <div class="space-y-3 border-b px-4 py-3">
    <!-- Label + Run button -->
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-4">
        <label class="text-xs text-muted-foreground">
          {{ activeTab === 'tts' ? '测试文本' : '测试提示词' }}
        </label>
        <div
          v-if="activeTab === 'image' && props.currentImageModelAspectRatioOptions.length > 0"
          class="flex items-center gap-2"
        >
          <label class="text-xs text-muted-foreground/80">比例</label>
          <Select v-model="imageAspectRatio">
            <SelectTrigger class="h-7 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="ratio in props.currentImageModelAspectRatioOptions"
                :key="`image_aspect_ratio_${ratio}`"
                :value="ratio"
              >
                {{ formatAspectRatioLabel(ratio) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div
          v-if="activeTab === 'image' && props.currentImageModelSizeOptions.length > 0"
          class="flex items-center gap-2"
        >
          <label class="text-xs text-muted-foreground/80">
            {{ props.currentImageModelSizeSelectionMode === 'constraint' ? '常用尺寸' : '尺寸' }}
          </label>
          <Select v-model="imageSize">
            <SelectTrigger class="h-7 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="size in props.currentImageModelSizeOptions"
                :key="`image_size_${size}`"
                :value="size"
              >
                {{ formatImageSizeLabel(size) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <span
            v-if="props.currentImageModelSizeHelp"
            class="max-w-[260px] truncate text-xs text-muted-foreground/70"
            :title="props.currentImageModelSizeHelp"
          >{{ props.currentImageModelSizeHelp }}</span>
        </div>
        <div
          v-if="activeTab === 'image' && props.currentImageModelQualityOptions.length > 0"
          class="flex items-center gap-2"
        >
          <label class="text-xs text-muted-foreground/80">画质</label>
          <Select v-model="imageQuality">
            <SelectTrigger class="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="quality in props.currentImageModelQualityOptions"
                :key="`image_quality_${quality}`"
                :value="quality"
              >
                {{ formatImageQualityLabel(quality) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span
          v-if="activeTab === 'image' && props.currentImageModelRequiresReference && props.referenceImages.length === 0"
          class="text-xs text-amber-600 dark:text-amber-400"
        >需要参考图</span>
        <span
          v-if="activeTab === 'video'
            && props.currentVideoModelRequiresReference
            && !videoReferenceMaterialReady"
          class="text-xs text-amber-600 dark:text-amber-400"
        >需要视频参考素材</span>
        <Button
          size="sm"
          :disabled="currentTestStatus === 'testing' || !canRunCurrentTabTest"
          class="gap-1.5"
          @click="props.testModel(activeTab)"
        >
          <Loader2
            v-if="currentTestStatus === 'testing'"
            class="h-3.5 w-3.5 animate-spin"
          />
          <Play
            v-else
            class="h-3.5 w-3.5"
          />
          {{ currentTestStatus === 'testing' ? '测试中...' : '运行测试' }}
        </Button>
      </div>
    </div>

    <!-- Prompt input -->
    <div>
      <template v-if="activeTab === 'image'">
        <div class="relative min-h-[80px] rounded-lg border border-input bg-muted/20 px-3 py-2 text-sm transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring">
          <div
            :ref="props.setPromptEditorRef"
            contenteditable="true"
            class="min-h-[60px] whitespace-pre-wrap break-words outline-none"
            @blur="props.handlePromptTextareaBlur"
            @click="props.handlePromptTextareaCursorChange"
            @compositionend="props.handlePromptTextareaCompositionEnd"
            @compositionstart="props.handlePromptTextareaCompositionStart"
            @focus="props.handlePromptTextareaFocus"
            @input="props.handlePromptTextareaInput"
            @keydown="props.handlePromptTextareaKeydown"
            @keyup="props.handlePromptTextareaCursorChange"
          />
          <span
            v-if="props.imagePromptIsEmpty"
            class="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground/50"
          >
            {{ SETTINGS_MODEL_TEST_PLACEHOLDERS.image }}
          </span>
        </div>
      </template>

      <template v-else>
        <Textarea
          v-model="customPrompts[activeTab]"
          :placeholder="SETTINGS_MODEL_TEST_PLACEHOLDERS[activeTab]"
          class="resize-none bg-muted/20 text-sm transition-colors focus:bg-background"
          :rows="activeTab === 'video' ? 3 : 2"
        />
      </template>

      <p
        v-if="activeTab === 'image' && props.currentImageModelSupportsReference"
        class="mt-1 text-xs text-muted-foreground/70"
      >
        输入 `@` 可直接选择参考图
      </p>

      <div
        v-if="activeTab === 'image' && props.imageMentionOpen"
        class="mt-2 max-h-48 overflow-y-auto rounded-lg border bg-background shadow-md"
      >
        <Button
          v-for="(item, mentionIndex) in props.imageMentionCandidates"
          :key="`image_mention_${item.index}`"
          type="button"
          variant="ghost"
          class="h-auto w-full justify-start gap-2 rounded-none px-2 py-1.5 font-normal hover:bg-accent"
          :class="mentionIndex === props.imageMentionActiveIndex ? 'bg-accent' : ''"
          @mousedown.prevent="props.insertImageMention(item.index)"
        >
          <img
            :src="item.image"
            class="h-10 w-10 rounded border object-cover"
          >
          <span class="text-xs">{{ item.token }}</span>
        </Button>
        <div
          v-if="props.imageMentionCandidates.length === 0"
          class="px-3 py-2 text-xs text-muted-foreground"
        >
          没有匹配的参考图
        </div>
      </div>
    </div>

    <!-- Reference images -->
    <div
      v-if="activeTab === 'image' && props.currentImageModelSupportsReference"
      class="space-y-1.5"
    >
      <label class="flex items-center gap-1 text-xs text-muted-foreground/70">
        <ImagePlus class="h-3 w-3" />
        参考图片 (可选，最多 {{ props.currentImageModelMaxReferenceImages }} 张)
      </label>

      <div class="flex flex-wrap gap-2">
        <div
          v-for="(img, index) in props.referenceImages"
          :key="index"
          class="group relative h-14 w-14 cursor-zoom-in overflow-hidden rounded-lg border transition-colors hover:border-primary/50"
          @click="props.openReferenceImagePreview(img, index)"
        >
          <img
            :src="img"
            class="h-full w-full object-cover"
          >
          <span class="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-xs leading-none text-white">
            图{{ index + 1 }}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-black/60 p-0 text-white opacity-0 transition-opacity hover:bg-black/70 hover:text-white group-hover:opacity-100"
            @click.stop="props.removeReferenceImage(index)"
          >
            <X class="h-3 w-3" />
          </Button>
        </div>

        <Button
          v-if="props.referenceImages.length < props.currentImageModelMaxReferenceImages"
          type="button"
          variant="ghost"
          class="h-14 w-14 rounded-lg border-2 border-dashed border-muted-foreground/20 p-0 text-muted-foreground/50 transition-colors hover:border-primary/50 hover:text-primary"
          @click="props.triggerFileInput"
        >
          <ImagePlus class="h-4 w-4" />
        </Button>
      </div>

      <Input
        :ref="props.setFileInputRef"
        accept="image/*"
        class="hidden"
        multiple
        type="file"
        @change="props.handleReferenceImageUpload"
      />
    </div>

    <div
      v-if="activeTab === 'video' && (props.currentVideoModelSupportsReference || props.currentVideoModelSupportsFirstLastFrame || props.currentVideoModelSupportsAudioReference)"
      class="space-y-3"
    >
      <div
        v-if="props.currentVideoModelSupportsBothImageModes"
        class="flex items-center gap-2 rounded-lg border bg-muted/30 p-3"
      >
        <label class="text-xs font-medium text-muted-foreground">
          图片输入模式:
        </label>
        <div class="flex items-center gap-2">
          <label class="flex cursor-pointer items-center gap-1.5">
            <input
              v-model="videoImageInputModeModel"
              type="radio"
              value="firstLastFrame"
              class="h-3.5 w-3.5 cursor-pointer"
            >
            <span class="text-xs">首尾帧</span>
          </label>
          <label class="flex cursor-pointer items-center gap-1.5">
            <input
              v-model="videoImageInputModeModel"
              type="radio"
              value="referenceImages"
              class="h-3.5 w-3.5 cursor-pointer"
            >
            <span class="text-xs">参考图片 (最多 {{ props.currentVideoModelMaxReferenceImages }} 张)</span>
          </label>
        </div>
      </div>

      <div
        v-if="props.currentVideoModelSupportsFirstLastFrame && (!props.currentVideoModelSupportsBothImageModes || videoImageInputModeModel === 'firstLastFrame')"
        class="space-y-2"
      >
        <label class="flex items-center gap-1 text-xs text-muted-foreground/70">
          <ImagePlus class="h-3 w-3" />
          首尾帧参考 (分开上传)
        </label>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <p class="text-xs text-muted-foreground/70">
              首帧
            </p>
            <div
              v-if="props.videoFirstFrame"
              class="group relative h-24 cursor-zoom-in overflow-hidden rounded-lg border transition-colors hover:border-primary/50"
              @click="props.openReferenceImagePreview(props.videoFirstFrame, 0)"
            >
              <img
                :src="props.videoFirstFrame"
                class="h-full w-full object-cover"
              >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 p-0 text-white opacity-0 transition-opacity hover:bg-black/70 hover:text-white group-hover:opacity-100"
                @click.stop="props.clearVideoFirstFrame"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>
            <Button
              v-else
              type="button"
              variant="ghost"
              class="h-24 w-full rounded-lg border-2 border-dashed border-muted-foreground/20 text-muted-foreground/60 transition-colors hover:border-primary/50 hover:text-primary"
              @click="triggerVideoFirstFrameInput"
            >
              上传首帧
            </Button>
          </div>

          <div class="space-y-1.5">
            <p class="text-xs text-muted-foreground/70">
              尾帧
            </p>
            <div
              v-if="props.videoLastFrame"
              class="group relative h-24 cursor-zoom-in overflow-hidden rounded-lg border transition-colors hover:border-primary/50"
              @click="props.openReferenceImagePreview(props.videoLastFrame, 1)"
            >
              <img
                :src="props.videoLastFrame"
                class="h-full w-full object-cover"
              >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 p-0 text-white opacity-0 transition-opacity hover:bg-black/70 hover:text-white group-hover:opacity-100"
                @click.stop="props.clearVideoLastFrame"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>
            <Button
              v-else
              type="button"
              variant="ghost"
              class="h-24 w-full rounded-lg border-2 border-dashed border-muted-foreground/20 text-muted-foreground/60 transition-colors hover:border-primary/50 hover:text-primary"
              @click="triggerVideoLastFrameInput"
            >
              上传尾帧
            </Button>
          </div>
        </div>

        <input
          ref="videoFirstFrameInputRef"
          accept="image/*"
          class="hidden"
          type="file"
          @change="props.handleVideoFirstFrameUpload"
        >
        <input
          ref="videoLastFrameInputRef"
          accept="image/*"
          class="hidden"
          type="file"
          @change="props.handleVideoLastFrameUpload"
        >
      </div>

      <div
        v-if="props.currentVideoModelSupportsImageReference && (!props.currentVideoModelSupportsBothImageModes || videoImageInputModeModel === 'referenceImages')"
        class="space-y-1.5"
      >
        <label class="flex items-center gap-1 text-xs text-muted-foreground/70">
          <ImagePlus class="h-3 w-3" />
          {{
            props.currentVideoModelMaxReferenceImages <= 1
              ? '视频参考图 (单图)'
              : `视频参考图 (可选，最多 ${props.currentVideoModelMaxReferenceImages} 张)`
          }}
        </label>

        <div class="flex flex-wrap gap-2">
          <div
            v-for="(img, index) in props.videoReferenceImages"
            :key="`video_ref_${index}`"
            class="group relative h-14 w-14 cursor-zoom-in overflow-hidden rounded-lg border transition-colors hover:border-primary/50"
            @click="props.openReferenceImagePreview(img, index)"
          >
            <img
              :src="img"
              class="h-full w-full object-cover"
            >
            <span class="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-xs leading-none text-white">
              图{{ index + 1 }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-black/60 p-0 text-white opacity-0 transition-opacity hover:bg-black/70 hover:text-white group-hover:opacity-100"
              @click.stop="props.removeVideoReferenceImage(index)"
            >
              <X class="h-3 w-3" />
            </Button>
          </div>

          <Button
            v-if="props.videoReferenceImages.length < props.currentVideoModelMaxReferenceImages"
            type="button"
            variant="ghost"
            class="h-14 w-14 rounded-lg border-2 border-dashed border-muted-foreground/20 p-0 text-muted-foreground/50 transition-colors hover:border-primary/50 hover:text-primary"
            @click="triggerVideoReferenceInput"
          >
            <ImagePlus class="h-4 w-4" />
          </Button>
        </div>

        <input
          ref="videoReferenceInputRef"
          accept="image/*"
          class="hidden"
          :multiple="props.currentVideoModelMaxReferenceImages > 1"
          type="file"
          @change="props.handleVideoReferenceImageUpload"
        >
      </div>

      <div
        v-if="props.currentVideoModelSupportsVideoReference"
        class="space-y-1.5"
      >
        <label class="flex items-center gap-1 text-xs text-muted-foreground/70">
          <Film class="h-3 w-3" />
          {{
            props.currentVideoModelMaxReferenceVideos <= 1
              ? '视频参考片段 (单文件)'
              : `视频参考片段 (可选，最多 ${props.currentVideoModelMaxReferenceVideos} 个)`
          }}
        </label>

        <div class="space-y-2">
          <div
            v-for="(videoRef, index) in props.videoReferenceVideos"
            :key="`video_ref_clip_${index}`"
            class="group relative overflow-hidden rounded-lg border bg-muted/10"
          >
            <video
              :src="videoRef"
              class="h-24 w-full bg-black/80 object-contain"
              controls
              preload="metadata"
            />
            <div class="flex items-center justify-between gap-2 border-t px-2 py-1">
              <span
                class="truncate text-xs text-muted-foreground"
                :title="props.videoReferenceVideoNames[index] || `参考视频 ${index + 1}`"
              >
                {{ props.videoReferenceVideoNames[index] || `参考视频 ${index + 1}` }}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="h-5 w-5 text-muted-foreground hover:text-foreground"
                @click.stop="props.removeVideoReferenceVideo(index)"
              >
                <X class="h-3 w-3" />
              </Button>
            </div>
          </div>

          <Button
            v-if="props.videoReferenceVideos.length < props.currentVideoModelMaxReferenceVideos"
            type="button"
            variant="ghost"
            class="h-10 w-full rounded-lg border-2 border-dashed border-muted-foreground/20 text-muted-foreground/60 transition-colors hover:border-primary/50 hover:text-primary"
            @click="triggerVideoReferenceVideoInput"
          >
            上传参考视频
          </Button>
        </div>

        <input
          ref="videoReferenceVideoInputRef"
          accept="video/*"
          class="hidden"
          :multiple="props.currentVideoModelMaxReferenceVideos > 1"
          type="file"
          @change="props.handleVideoReferenceVideoUpload"
        >
      </div>

      <div
        v-if="props.currentVideoModelSupportsAudioReference"
        class="space-y-1.5"
      >
        <label class="flex items-center gap-1 text-xs text-muted-foreground/70">
          <AudioLines class="h-3 w-3" />
          {{
            props.currentVideoModelMaxReferenceAudios <= 1
              ? '音频参考 (可选，单文件)'
              : `音频参考 (可选，最多 ${props.currentVideoModelMaxReferenceAudios} 个)`
          }}
        </label>

        <div class="space-y-2">
          <div
            v-for="(audioRef, index) in props.videoAudioReferences"
            :key="`video_ref_audio_${index}`"
            class="flex items-center justify-between gap-2 rounded-lg border bg-muted/10 px-2 py-1.5"
          >
            <audio
              :src="audioRef"
              class="h-8 w-full min-w-0"
              controls
              preload="metadata"
            />
            <span
              class="max-w-[260px] truncate text-xs text-muted-foreground"
              :title="props.videoAudioReferenceNames[index] || `参考音频 ${index + 1}`"
            >
              {{ props.videoAudioReferenceNames[index] || `参考音频 ${index + 1}` }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="h-6 w-6 text-muted-foreground hover:text-foreground"
              @click="props.removeVideoAudioReference(index)"
            >
              <X class="h-3 w-3" />
            </Button>
          </div>

          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-8"
              @click="triggerVideoAudioInput"
            >
              上传音频
            </Button>
            <Button
              v-if="props.videoAudioReferences.length > 0"
              type="button"
              variant="ghost"
              size="sm"
              class="h-8 px-2 text-xs text-muted-foreground"
              @click="props.clearVideoAudioReference"
            >
              清空全部
            </Button>
          </div>
        </div>

        <input
          ref="videoAudioInputRef"
          accept="audio/*"
          class="hidden"
          :multiple="props.currentVideoModelMaxReferenceAudios > 1"
          type="file"
          @change="props.handleVideoAudioReferenceUpload"
        >
      </div>

    </div>
  </div>
</template>
