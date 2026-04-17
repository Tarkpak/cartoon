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
const imageResultUrl = computed(() => {
  const result = props.testResults.image.result as { imageUrl?: string } | undefined
  return result?.imageUrl
})
const videoResultUrl = computed(() => {
  const result = props.testResults.video.result as { videoUrl?: string } | undefined
  return result?.videoUrl
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4">
    <div
      v-if="activeResult.status === 'idle'"
      class="flex h-full flex-col items-center justify-center text-muted-foreground"
    >
      <component
        :is="activeTabIcon"
        class="mb-3 h-12 w-12 opacity-20"
      />
      <p class="text-sm">
        点击"运行测试"查看结果
      </p>
    </div>

    <div
      v-else-if="activeResult.status === 'testing'"
      class="flex h-full flex-col items-center justify-center"
    >
      <Loader2 class="mb-3 h-10 w-10 animate-spin text-primary" />
      <p class="text-sm text-muted-foreground">
        正在测试模型...
      </p>
    </div>

    <div
      v-else-if="activeResult.status === 'success'"
      class="space-y-4"
    >
      <div class="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle2 class="h-5 w-5" />
        <span class="font-medium">{{ activeResult.message }}</span>
      </div>

      <div
        v-if="props.activeTab === 'text' && props.testResults.text.result"
        class="rounded-lg border bg-muted/50 p-4"
      >
        <p class="whitespace-pre-wrap text-sm">
          {{ props.testResults.text.result }}
        </p>
      </div>

      <img
        v-if="props.activeTab === 'image' && imageResultUrl"
        :src="imageResultUrl"
        class="max-h-[400px] max-w-full rounded-lg border shadow-sm"
      >

      <video
        v-if="props.activeTab === 'video' && videoResultUrl"
        :src="videoResultUrl"
        class="max-h-[400px] max-w-full rounded-lg border shadow-sm"
        controls
      />

      <audio
        v-if="props.activeTab === 'tts' && props.currentTtsAudioUrl"
        :src="props.currentTtsAudioUrl"
        class="w-full max-w-xl"
        controls
      />

      <div
        v-else-if="props.activeTab === 'tts'"
        class="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
      >
        测试成功，但未获取到可预览的音频地址
      </div>
    </div>

    <div
      v-else-if="activeResult.status === 'error'"
      class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950"
    >
      <div class="flex items-start gap-2">
        <XCircle class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
        <div>
          <p class="font-medium text-red-700 dark:text-red-300">
            测试失败
          </p>
          <p class="mt-1 text-sm text-red-600 dark:text-red-400">
            {{ activeResult.message }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
