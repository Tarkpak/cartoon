<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import {
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

const props = defineProps<{
  testResults: Record<ModelTestTab, TestResult>
  currentImageModelSupportsReference: boolean
  currentImageModelRequiresReference: boolean
  currentImageModelAspectRatioOptions: string[]
  canRunImageTest: boolean
  referenceImages: string[]
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
  triggerFileInput: () => void
  openReferenceImagePreview: (image: string, index: number) => void
  testModel: (modelType: ModelTestTab) => Promise<void>
}>()

const currentTestStatus = computed(() => props.testResults[activeTab.value].status)

function formatAspectRatioLabel(value: string): string {
  return value === 'auto' ? '自动 (auto)' : value
}
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
          v-if="activeTab === 'image'"
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
      </div>
      <div class="flex items-center gap-2">
        <span
          v-if="activeTab === 'image' && props.currentImageModelRequiresReference && props.referenceImages.length === 0"
          class="text-xs text-amber-600 dark:text-amber-400"
        >需要参考图</span>
        <Button
          size="sm"
          :disabled="currentTestStatus === 'testing' || !props.canRunImageTest"
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
        <div class="relative min-h-[80px] rounded-lg border border-input bg-muted/20 px-3 py-2 text-sm transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
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
        class="mt-1 text-[11px] text-muted-foreground/70"
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
        参考图片 (可选，最多 4 张)
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
          <span class="absolute left-0.5 top-0.5 rounded bg-black/60 px-1 py-0.5 text-[10px] leading-none text-white">
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
          v-if="props.referenceImages.length < 4"
          type="button"
          variant="ghost"
          class="h-14 w-14 rounded-lg border-2 border-dashed border-muted-foreground/20 p-0 text-muted-foreground/50 transition-colors hover:border-primary/50 hover:text-primary"
          @click="props.triggerFileInput"
        >
          <ImagePlus class="h-4 w-4" />
        </Button>
      </div>

      <input
        :ref="props.setFileInputRef"
        accept="image/*"
        class="hidden"
        multiple
        type="file"
        @change="props.handleReferenceImageUpload"
      >
    </div>
  </div>
</template>
