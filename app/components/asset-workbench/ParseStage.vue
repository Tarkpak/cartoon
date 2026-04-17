<script setup lang="ts">
import { ClipboardCopy, Loader2, Sparkles } from 'lucide-vue-next'

const novelText = defineModel<string>('novelText', { required: true })

defineProps<{
  parsing: boolean
  parsedTimelineText: string
  scenesCount: number
  charactersCount: number
  hint: string
}>()

const emit = defineEmits<{
  (e: 'copy-timeline' | 'parse'): void
}>()
</script>

<template>
  <AssetWorkbenchStagePanel
    content-class="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden"
  >
    <Textarea
      v-model="novelText"
      class="flex-1 min-h-[280px] resize-none overflow-y-auto rounded-lg border-muted-foreground/20 bg-muted/30 placeholder:text-muted-foreground/50 focus:bg-background transition-colors"
      placeholder="粘贴完整剧本原文..."
    />

    <div
      v-if="parsedTimelineText.trim()"
      class="shrink-0 space-y-2"
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-medium text-muted-foreground">
          标准时间轴文案（含图片标记）
        </p>
        <Button
          size="sm"
          variant="ghost"
          class="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          @click="emit('copy-timeline')"
        >
          <ClipboardCopy class="h-3 w-3" />
          复制
        </Button>
      </div>
      <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{{ parsedTimelineText }}</pre>
    </div>

    <div class="shrink-0 flex items-center gap-3">
      <Button
        :disabled="parsing || !novelText.trim()"
        class="gap-2"
        @click="emit('parse')"
      >
        <Loader2
          v-if="parsing"
          class="h-4 w-4 animate-spin"
        />
        <Sparkles
          v-else
          class="h-4 w-4"
        />
        解析并自动准备资产
      </Button>
      <div
        v-if="scenesCount > 0 || charactersCount > 0"
        class="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <span class="inline-flex items-center gap-1">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {{ scenesCount }} 个场景
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-blue-500" />
          {{ charactersCount }} 个角色
        </span>
      </div>
    </div>
  </AssetWorkbenchStagePanel>
</template>
