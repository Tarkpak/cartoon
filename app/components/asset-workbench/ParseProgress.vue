<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ModelUsagePanel from '@/components/model-logs/ModelUsagePanel.vue'
import { useIntervalFn } from '@vueuse/core'
import { Check, ChevronRight, Circle, CircleAlert, Loader2 } from 'lucide-vue-next'
import {
  buildParseProgressPhases,
  formatParseElapsed,
  parseBatchSummary,
  type ParseProgressDisplayState
} from '~/lib/asset-workbench-parse-progress'

const props = withDefaults(defineProps<{
  state?: ParseProgressDisplayState
  running: boolean
  mode?: 'episode' | 'directory'
  title?: string
}>(), { mode: 'episode', title: '分集解析' })

const now = ref(Date.now())
const timer = useIntervalFn(() => { now.value = Date.now() }, 1000, { immediate: false })
watch(() => props.running, (running) => {
  now.value = Date.now()
  if (running) timer.resume()
  else timer.pause()
}, { immediate: true })
const phases = computed(() => buildParseProgressPhases(props.state || {}, props.mode))
const elapsed = computed(() => formatParseElapsed(props.state?.startedAt, props.state?.finishedAt ?? now.value))
const batchSummary = computed(() => parseBatchSummary(props.state || {}))
const logs = computed(() => (props.state?.logs || []).slice(-20).reverse())
const failed = computed(() => props.state?.step === 'error')
const duplicateReceivingMessage = computed(() => props.running
  && props.state?.streamState === 'receiving'
  && !!props.state.outputChars
  && /已接收\s*[\d,，]+\s*字/.test(props.state.message || ''))
const streamLabel = computed(() => ({
  connecting: '连接模型中',
  waiting: '等待模型输出',
  thinking: '模型思考中',
  receiving: '正在接收内容'
})[props.state?.streamState || 'waiting'])
const sinceLastOutput = computed(() => Math.max(0, Math.floor(
  (now.value - (props.state?.lastModelActivityAt ?? now.value)) / 1000
)))

</script>

<template>
  <section
    class="min-w-0 rounded-xl bg-muted/25 p-3 text-xs"
    :aria-label="`${title}进度`"
  >
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p class="min-w-0 break-words font-medium text-foreground">{{ title }}</p>
      <span v-if="state?.startedAt != null" class="shrink-0 tabular-nums text-muted-foreground">
        {{ running ? '已用时' : '耗时' }} {{ elapsed }}
      </span>
    </div>

    <ModelUsagePanel v-if="!running && state?.requestId" :request-id="state.requestId" compact class="mt-3" />
    <ol class="mt-3 space-y-2" aria-label="解析阶段">
      <li
        v-for="phase in phases"
        :key="phase.label"
        class="flex items-start gap-2"
        :class="phase.status === 'error' ? 'text-destructive' : phase.status === 'running' ? 'text-foreground' : 'text-muted-foreground'"
        :aria-current="phase.status === 'running' || phase.status === 'error' ? 'step' : undefined"
      >
        <Check v-if="phase.status === 'done'" class="mt-px size-3.5 shrink-0 text-primary" aria-label="已完成" />
        <CircleAlert v-else-if="phase.status === 'error'" class="mt-px size-3.5 shrink-0" aria-label="失败" />
        <Loader2 v-else-if="phase.status === 'running'" class="mt-px size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-label="进行中" />
        <Circle v-else class="mt-px size-3.5 shrink-0 opacity-50" aria-label="待处理" />
        <div class="min-w-0 flex-1">
          <span>{{ phase.label }}</span>
          <p v-if="phase.label === '生成详细分镜' && batchSummary" class="mt-0.5 tabular-nums text-muted-foreground">
            {{ batchSummary }}
          </p>
        </div>
      </li>
    </ol>

    <p
      v-if="!duplicateReceivingMessage"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      class="mt-3 break-words border-t border-border/60 pt-2.5 leading-relaxed"
      :class="failed ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ state?.message || '任务已创建，等待模型响应…' }}
    </p>

    <div v-if="running" class="mt-3 rounded-lg border border-primary/15 bg-primary/5 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex items-center gap-2 font-medium text-foreground">
          <span class="relative flex size-2" aria-hidden="true">
            <span class="absolute inline-flex size-full animate-ping rounded-full bg-primary/40 motion-reduce:animate-none" />
            <span class="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          {{ state?.streamState ? streamLabel : '任务进行中' }}
        </span>
        <span v-if="state?.streamState && state.outputChars" class="tabular-nums text-primary">
          已接收 {{ state.outputChars.toLocaleString() }} 字
        </span>
      </div>
      <p class="mt-1.5 leading-relaxed text-muted-foreground">
        {{ state?.streamState === 'receiving' ? '内容接收完成后将自动校验并保存。' : '长文本生成可能需要几分钟，请保持当前页面打开。' }}
        <span v-if="state?.streamState && sinceLastOutput >= 15">正在等待模型继续输出，距上次更新 {{ sinceLastOutput }} 秒。</span>
      </p>
    </div>

    <details v-if="logs.length" class="group mt-2">
      <summary class="flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight class="size-3.5 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        详细日志
      </summary>
      <ul class="mt-1 max-h-36 space-y-2 overflow-y-auto break-words pl-5 leading-relaxed text-muted-foreground" aria-label="解析日志">
        <li v-for="item in logs" :key="item.id">{{ item.message }}</li>
      </ul>
    </details>
  </section>
</template>
