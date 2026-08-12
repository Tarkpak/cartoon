<script setup lang="ts">
import {
  CheckCircle2,
  Loader2,
  XCircle
} from 'lucide-vue-next'
import {
  SETTINGS_MODEL_TEST_TABS,
  type ModelTestTab,
  type TestResult
} from '@/lib/settings-models'

const props = defineProps<{
  activeTab: ModelTestTab
  testResults: Record<ModelTestTab, TestResult>
  currentTtsAudioUrl?: string
}>()

const activeResult = computed(() => props.testResults[props.activeTab])
const activeTabIcon = computed(() => {
  return SETTINGS_MODEL_TEST_TABS.find(tab => tab.key === props.activeTab)?.icon
})
const copyingErrorMessage = ref(false)
const copiedErrorMessage = ref(false)

async function copyErrorMessage() {
  if (!import.meta.client) return

  const message = activeResult.value?.message?.trim()
  if (!message || copyingErrorMessage.value) return

  copyingErrorMessage.value = true
  copiedErrorMessage.value = false

  try {
    await navigator.clipboard.writeText(message)
    copiedErrorMessage.value = true
    window.setTimeout(() => {
      copiedErrorMessage.value = false
    }, 1600)
  } catch (error) {
    console.warn('[SettingsModelTestResultPanel] 复制失败信息失败:', error)
  } finally {
    copyingErrorMessage.value = false
  }
}

const imageResultUrl = computed(() => {
  const result = props.testResults.image.result as { imageUrl?: string } | undefined
  return result?.imageUrl
})
const videoResultUrl = computed(() => {
  const result = props.testResults.video.result as { videoUrl?: string } | undefined
  return result?.videoUrl
})
const videoResultMeta = computed(() => {
  const result = props.testResults.video.result as {
    usedReferenceImageCount?: number
    usedReferenceVideoCount?: number
    usedReferenceAudioCount?: number
    hasAudioReference?: boolean
    hasFirstFrame?: boolean
    hasLastFrame?: boolean
  } | undefined
  return {
    usedReferenceImageCount: result?.usedReferenceImageCount || 0,
    usedReferenceVideoCount: result?.usedReferenceVideoCount || 0,
    usedReferenceAudioCount: result?.usedReferenceAudioCount || 0,
    hasAudioReference: result?.hasAudioReference === true,
    hasFirstFrame: result?.hasFirstFrame === true,
    hasLastFrame: result?.hasLastFrame === true
  }
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4">
    <!-- Idle state -->
    <div
      v-if="activeResult.status === 'idle'"
      class="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"
    >
      <component
        :is="activeTabIcon"
        class="h-10 w-10 opacity-15"
      />
      <p class="text-sm">
        选择模型并运行测试
      </p>
    </div>

    <!-- Testing state -->
    <div
      v-else-if="activeResult.status === 'testing'"
      class="flex h-full flex-col items-center justify-center gap-3"
    >
      <div class="relative">
        <Loader2 class="h-10 w-10 animate-spin text-primary/60" />
      </div>
      <p class="text-sm text-muted-foreground">
        模型测试中...
      </p>
    </div>

    <!-- Success state -->
    <div
      v-else-if="activeResult.status === 'success'"
      class="space-y-4"
    >
      <div class="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 class="h-4 w-4 shrink-0" />
        <span>{{ activeResult.message }}</span>
      </div>

      <!-- Text result -->
      <div
        v-if="props.activeTab === 'text' && props.testResults.text.result"
        class="rounded-xl bg-muted/20 p-4"
      >
        <p class="whitespace-pre-wrap text-sm leading-relaxed">
          {{ props.testResults.text.result }}
        </p>
      </div>

      <!-- Image result -->
      <div
        v-if="props.activeTab === 'image' && imageResultUrl"
        class="overflow-hidden rounded-lg border"
      >
        <img
          :src="imageResultUrl"
          class="max-h-[400px] max-w-full"
        >
      </div>

      <!-- Video result -->
      <div
        v-if="props.activeTab === 'video' && videoResultUrl"
        class="mx-auto aspect-video w-full max-w-5xl overflow-hidden rounded-xl bg-black/90"
      >
        <video
          :src="videoResultUrl"
          class="h-full w-full object-contain"
          controls
          playsinline
        />
      </div>
      <div
        v-if="props.activeTab === 'video' && videoResultUrl"
        class="rounded-xl bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      >
        参考图: {{ videoResultMeta.usedReferenceImageCount }} 项 · 参考视频: {{ videoResultMeta.usedReferenceVideoCount }} 项 · 音频参考: {{ videoResultMeta.usedReferenceAudioCount }} 项 · 首帧: {{ videoResultMeta.hasFirstFrame ? '有' : '无' }} · 尾帧: {{ videoResultMeta.hasLastFrame ? '有' : '无' }}
      </div>

      <!-- TTS result -->
      <div v-if="props.activeTab === 'tts'">
        <audio
          v-if="props.currentTtsAudioUrl"
          :src="props.currentTtsAudioUrl"
          class="w-full max-w-xl"
          controls
        />
        <div
          v-else
          class="rounded-xl bg-muted/20 p-3 text-sm text-muted-foreground"
        >
          测试成功，但未获取到可预览的音频地址
        </div>
      </div>
    </div>

    <!-- Error state -->
    <div
      v-else-if="activeResult.status === 'error'"
      class="rounded-xl bg-destructive/8 p-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-2">
          <XCircle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p class="text-sm font-medium text-destructive">
              测试失败
            </p>
            <pre class="mt-1 whitespace-pre-wrap break-all text-xs text-destructive/80 select-text">{{ activeResult.message }}</pre>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="h-7 px-2 text-xs"
          :disabled="copyingErrorMessage"
          @click="copyErrorMessage"
        >
          {{ copiedErrorMessage ? '已复制' : '复制错误' }}
        </Button>
      </div>
    </div>
  </div>
</template>
