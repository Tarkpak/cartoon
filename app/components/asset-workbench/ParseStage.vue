<script setup lang="ts">
import { BookOpen, Loader2 } from 'lucide-vue-next'

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
    title="步骤一：剧本解析"
    :icon="BookOpen"
    :hint="hint"
    header-class="pb-2"
    content-class="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden"
  >
    <Textarea
      v-model="novelText"
      class="flex-1 min-h-[280px] resize-none overflow-y-auto"
      placeholder="粘贴完整剧本原文..."
    />
    <div
      v-if="parsedTimelineText.trim()"
      class="shrink-0 rounded-md border bg-muted/20 p-3 space-y-2"
    >
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-medium">
          标准时间轴文案（含图片标记）
        </p>
        <Button
          size="sm"
          variant="outline"
          class="h-7 px-2 text-xs"
          @click="emit('copy-timeline')"
        >
          复制文案
        </Button>
      </div>
      <pre class="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border bg-background px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">{{ parsedTimelineText }}</pre>
    </div>
    <div class="shrink-0 flex flex-wrap items-center gap-2">
      <Button
        :disabled="parsing || !novelText.trim()"
        @click="emit('parse')"
      >
        <Loader2
          v-if="parsing"
          class="h-4 w-4 mr-2 animate-spin"
        />
        解析并自动准备资产
      </Button>
      <span class="text-xs text-muted-foreground">
        已解析场景 {{ scenesCount }} 个，角色 {{ charactersCount }} 个
      </span>
    </div>
  </AssetWorkbenchStagePanel>
</template>
