<script setup lang="ts">
import {
  SCRIPT_PARSE_MODE_LABELS,
  type ScriptParseMode
} from '#shared/types/script'
import { Loader2, Sparkles } from 'lucide-vue-next'

const novelText = defineModel<string>('novelText', { required: true })

const props = defineProps<{
  scriptParseMode: ScriptParseMode
  parsing: boolean
  scenesCount: number
  charactersCount: number
  hint: string
}>()

const scriptParseModeLabel = computed(() => SCRIPT_PARSE_MODE_LABELS[props.scriptParseMode] || '短剧')

const emit = defineEmits<{
  (e: 'parse'): void
}>()
</script>

<template>
  <AssetWorkbenchStagePanel
    content-class="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden"
  >
    <div class="shrink-0 space-y-2">
      <p class="text-xs text-muted-foreground">
        当前剧本类型
      </p>
      <p class="inline-flex items-center rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground">
        {{ scriptParseModeLabel }}
      </p>
      <p class="text-xs text-muted-foreground/80">
        剧本类型由项目信息统一控制，如需修改请返回项目信息调整。
      </p>
    </div>

    <Textarea
      v-model="novelText"
      class="flex-1 min-h-[280px] resize-none overflow-y-auto rounded-lg border-muted-foreground/20 bg-muted/30 placeholder:text-muted-foreground/50 focus:bg-background transition-colors"
      placeholder="粘贴完整剧本原文..."
    />

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
        解析剧本
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
