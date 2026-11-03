<script setup lang="ts">
import { AlertCircle, Ban, CheckCircle2, FolderOpen, Info, Loader2, RotateCcw, Wand2 } from 'lucide-vue-next'
import {
  friendlyVideoImportError,
  videoImportStepLabel,
  type VideoImportActions
} from '~/lib/video-import-workflow'
import type { VideoImportTask } from '@/composables/useVideoImport'

const props = defineProps<{
  task: VideoImportTask
  actions: VideoImportActions
  scriptLabel: string
  scriptOutdated?: boolean
  episodeStats?: { total: number, running: number, failed: number, ready: number } | null
  acting?: boolean
}>()

const emit = defineEmits<{
  cancel: []
  recover: []
  openProject: []
  regenerate: []
}>()

const runningText = computed(() => {
  const { task, episodeStats } = props
  if (task.isSeriesGroup && episodeStats && ['pending', 'extracting', 'transcribing'].includes(task.status)) {
    return `正在识别字幕：已完成 ${episodeStats.ready}/${episodeStats.total} 集`
  }
  const map: Record<string, string> = {
    pending: '排队中，前面的任务完成后自动开始',
    extracting: task.currentStep === 'copy_source' ? '正在准备源视频' : '正在提取音频',
    transcribing: '正在识别字幕',
    generating_script: `正在生成${props.scriptLabel}，内容较长时需要几分钟`,
    importing: '正在解析剧本并创建项目'
  }
  return map[task.status] || '处理中'
})

const tone = computed(() => {
  const { task, actions } = props
  if (actions.running) return 'running'
  if (task.status === 'failed') return 'failed'
  if (task.status === 'cancelled') return 'cancelled'
  if (task.status === 'imported') return 'done'
  if (task.status === 'script_ready' && props.scriptOutdated) return 'outdated'
  return 'waiting'
})

const waitingText = computed(() => {
  if (props.task.status === 'subtitle_ready') {
    return `字幕已识别。校对识别错误（人名、专有名词）后生成${props.scriptLabel}，修改越准确，生成的${props.scriptLabel}越好。`
  }
  if (props.task.status === 'script_ready') {
    return `${props.scriptLabel}已生成。确认角色名称和分场后创建项目，之后在资产工作台继续生成角色和分镜。`
  }
  return ''
})
</script>

<template>
  <div
    v-if="tone === 'running'"
    class="flex flex-col gap-3 rounded-xl bg-primary/5 px-4 py-3 sm:flex-row sm:items-center"
    role="status"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3">
      <Loader2 class="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-foreground">{{ runningText }}</div>
        <div class="mt-1.5 flex items-center gap-2">
          <Progress :model-value="task.progress" class="h-1.5 max-w-md" />
          <span class="w-10 text-right text-xs tabular-nums text-muted-foreground">{{ task.progress }}%</span>
        </div>
        <div class="mt-1 text-xs text-muted-foreground">可以离开此页面，任务会在后台继续，完成后回来校对即可。</div>
      </div>
    </div>
    <Button
      v-if="actions.canCancel"
      variant="outline"
      size="sm"
      class="shrink-0 gap-2"
      :disabled="acting"
      @click="emit('cancel')"
    >
      <Ban class="h-4 w-4" aria-hidden="true" />
      取消
    </Button>
  </div>

  <div
    v-else-if="tone === 'failed' || tone === 'cancelled'"
    class="flex flex-col gap-3 rounded-xl px-4 py-3 sm:flex-row sm:items-center"
    :class="tone === 'failed' ? 'bg-destructive/10' : 'bg-muted/40'"
    role="alert"
  >
    <div class="flex min-w-0 flex-1 items-start gap-3">
      <AlertCircle
        class="mt-0.5 h-4 w-4 shrink-0"
        :class="tone === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
        aria-hidden="true"
      />
      <div class="min-w-0 text-sm">
        <div class="font-medium" :class="tone === 'failed' ? 'text-destructive' : 'text-foreground'">
          {{ tone === 'failed' ? `「${videoImportStepLabel(task.currentStep)}」失败` : `已在「${videoImportStepLabel(task.currentStep)}」步骤取消` }}
        </div>
        <div v-if="task.errorMessage" class="mt-0.5 break-words text-muted-foreground">
          {{ friendlyVideoImportError(task.errorMessage) }}
        </div>
        <div v-else-if="tone === 'cancelled'" class="mt-0.5 text-muted-foreground">
          已完成的步骤结果都保留着，可以从中断的步骤继续。
        </div>
      </div>
    </div>
    <Button
      v-if="actions.recovery"
      size="sm"
      class="shrink-0 gap-2"
      :variant="tone === 'failed' ? 'default' : 'outline'"
      :disabled="acting"
      @click="emit('recover')"
    >
      <RotateCcw class="h-4 w-4" aria-hidden="true" />
      {{ actions.recovery.label }}
    </Button>
  </div>

  <div
    v-else-if="tone === 'done'"
    class="flex flex-col gap-3 rounded-xl bg-success/10 px-4 py-3 sm:flex-row sm:items-center"
  >
    <div class="flex min-w-0 flex-1 items-center gap-3 text-sm text-success">
      <CheckCircle2 class="h-4 w-4 shrink-0" aria-hidden="true" />
      项目已创建，可以在资产工作台继续生成角色、场景和分镜视频。
    </div>
    <Button size="sm" class="shrink-0 gap-2" @click="emit('openProject')">
      <FolderOpen class="h-4 w-4" aria-hidden="true" />
      打开项目
    </Button>
  </div>

  <div
    v-else-if="tone === 'outdated'"
    class="flex flex-col gap-3 rounded-xl bg-warning/10 px-4 py-3 sm:flex-row sm:items-center"
  >
    <div class="flex min-w-0 flex-1 items-start gap-3 text-sm">
      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span class="text-foreground">字幕在{{ scriptLabel }}生成之后有修改，当前{{ scriptLabel }}没有包含这些修改。</span>
    </div>
    <Button
      v-if="actions.canGenerateScript"
      variant="outline"
      size="sm"
      class="shrink-0 gap-2"
      :disabled="acting"
      @click="emit('regenerate')"
    >
      <Wand2 class="h-4 w-4" aria-hidden="true" />
      重新生成{{ scriptLabel }}
    </Button>
  </div>

  <div
    v-else-if="waitingText"
    class="flex items-start gap-3 rounded-xl bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
  >
    <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <span>{{ waitingText }}</span>
  </div>
</template>
