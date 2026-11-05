<script setup lang="ts">
import AssetWorkbenchParseProgress from './ParseProgress.vue'
import ScriptPolishPanel from './ScriptPolishPanel.vue'
import type { ParseProgressDisplayState } from '~/lib/asset-workbench-parse-progress'
import type { ScriptParseMode } from '#shared/types/script'
import { resolveVideoWorkflowPreset } from '#shared/types/video-workflow'
import { ArrowRight, Loader2, Sparkles } from 'lucide-vue-next'
import { generatedEpisodePlans } from '~/lib/asset-workbench-progress'

const novelText = defineModel<string>('novelText', { required: true })

const props = defineProps<{
  projectId?: string | null
  readOnly?: boolean
  scriptParseMode: ScriptParseMode
  parsing: boolean
  episodePlan?: Array<{
    id: string
    title: string
    index: number
    startOffset: number
    endOffset: number
    charCount: number
    episodeHook?: string
    humiliationOrThreat?: string
    reversalPoint?: string
    emotionalCurve?: string
    cliffhanger?: string
    payoffType?: string
    episodeAssets?: {
      characters?: Array<{ name: string }>
      props?: Array<{ name: string }>
      environments?: Array<{ location: string }>
    }
  }>
  parseProgress?: ParseProgressDisplayState
  environmentAssetsCount: number
  charactersCount: number
  hint: string
}>()

const textCount = computed(() => novelText.value.length)
const lineCount = computed(() => {
  if (!novelText.value) return 0
  return novelText.value.split(/\r?\n/).length
})
const isDraggingTextFile = ref(false)
const polishing = ref(false)
const polishDraft = ref<string | null>(null)
const originalPreview = ref<HTMLDivElement | null>(null)
const polishedPreview = ref<HTMLDivElement | null>(null)
const programmaticScroll = new WeakMap<HTMLTextAreaElement, { top: number, left: number }>()
const dragCounter = ref(0)
const plannedEpisodes = computed(() => generatedEpisodePlans(props.episodePlan))
const hasEpisodePlan = computed(() => plannedEpisodes.value.length > 0)
const workflowPreset = computed(() => resolveVideoWorkflowPreset(props.scriptParseMode))
const isOriginExplainer = computed(() => props.scriptParseMode === 'origin_explainer')
watch(isOriginExplainer, enabled => { if (enabled) polishDraft.value = null })
const progressIsDirectory = computed(() => props.parseProgress?.kind === 'directory'
  || [props.parseProgress?.step, props.parseProgress?.failedStep].some(step => step?.startsWith('episode-plan')))
const inputPlaceholder = computed(() => {
  return isOriginExplainer.value
    ? '输入科学原理、机械结构或工艺过程，例如：蒸汽机原理...'
    : '粘贴完整剧本原文...'
})
const textDropHint = computed(() => {
  return isOriginExplainer.value
    ? '支持粘贴文本 / 拖拽 .txt .md 生成镜头规划'
    : '支持粘贴文本 / 拖拽 .txt .md，可先润色再生成目录'
})
const planActionLabel = computed(() => {
  if (isOriginExplainer.value) return hasEpisodePlan.value ? '重新生成镜头规划入口' : '生成镜头规划入口'
  return hasEpisodePlan.value ? '重新生成目录与资产设定' : '生成目录与资产设定'
})
const planReadyMessage = computed(() => {
  if (isOriginExplainer.value) {
    return `已生成镜头规划入口。请到“分镜视频”步骤按主题拆解并生成 ${workflowPreset.value.name} 多镜头场景。`
  }
  return `分集目录共 ${plannedEpisodes.value.length} 集。先在“资产准备”检查统一设定并准备素材，再到“分镜视频”按集生成分镜。`
})

const emit = defineEmits<{
  (e: 'prepare-episodes'): void
  (e: 'go-to-videos'): void
}>()

const planActionDisabledReason = computed(() => {
  if (props.parsing) return ''
  if (props.readOnly) return '当前为只读模式，不能重新生成'
  if (polishDraft.value !== null) return '请先采用润色稿或保留原稿'
  if (!novelText.value.trim()) return '请先粘贴或拖入剧本原文'
  return ''
})

const { toast } = useToast()

function syncPreviewScroll(event: Event, side: 'original' | 'polished') {
  const source = event.target as HTMLTextAreaElement
  const expected = programmaticScroll.get(source)
  if (expected) {
    if (Math.abs(source.scrollTop - expected.top) < 2 && Math.abs(source.scrollLeft - expected.left) < 2) return
    programmaticScroll.delete(source)
  }
  const targetContainer = side === 'original' ? polishedPreview.value : originalPreview.value
  const target = targetContainer?.querySelector<HTMLTextAreaElement>('textarea')
  if (!target) return
  const sourceRange = Math.max(0, source.scrollHeight - source.clientHeight)
  const targetRange = Math.max(0, target.scrollHeight - target.clientHeight)
  const position = sourceRange ? source.scrollTop / sourceRange : 0
  const top = position * targetRange
  const left = source.scrollLeft
  if (Math.abs(target.scrollTop - top) < 1 && Math.abs(target.scrollLeft - left) < 1) return
  programmaticScroll.set(target, { top, left })
  target.scrollTop = top
  target.scrollLeft = left
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true

  const normalizedName = file.name.toLowerCase()
  return normalizedName.endsWith('.txt')
    || normalizedName.endsWith('.md')
    || normalizedName.endsWith('.markdown')
    || normalizedName.endsWith('.text')
}

function resetDragState() {
  dragCounter.value = 0
  isDraggingTextFile.value = false
}

function handleDragEnter(event: DragEvent) {
  event.preventDefault()
  if (props.parsing || props.readOnly || polishing.value || polishDraft.value !== null) return

  dragCounter.value += 1
  isDraggingTextFile.value = true
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  if (props.parsing || props.readOnly || polishing.value || polishDraft.value !== null) return

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  if (props.parsing || props.readOnly || polishing.value || polishDraft.value !== null) return

  dragCounter.value = Math.max(0, dragCounter.value - 1)
  if (dragCounter.value === 0) {
    isDraggingTextFile.value = false
  }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (props.parsing || props.readOnly || polishing.value || polishDraft.value !== null) return

  resetDragState()

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const fileList = Array.from(files)
  const textFile = fileList.find(isTextFile)
  if (!textFile) {
    toast.warning('请拖拽文本文件', { description: '仅支持 .txt / .md 文本文件。' })
    return
  }

  try {
    const fileText = (await textFile.text()).replace(/^\uFEFF/, '')
    if (!fileText.trim()) {
      toast.warning('文本文件内容为空，请检查后重试')
      return
    }

    novelText.value = fileText
    if (isOriginExplainer.value) emit('prepare-episodes')
  } catch (error) {
    console.error('[ParseStage] 读取文本文件失败:', error)
    toast.error('文本文件读取失败，请重试')
  }
}
</script>

<template>
  <AssetWorkbenchStagePanel
    content-class="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto"
  >
    <div
      class="relative flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl bg-muted/20 transition-colors"
      :class="isDraggingTextFile ? 'bg-primary/8 ring-2 ring-inset ring-primary/30' : 'bg-muted/20'"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div v-if="polishDraft !== null" class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-lg">
        <div ref="originalPreview" class="flex min-w-0 flex-col">
          <div class="shrink-0 border-b bg-muted/30 px-3 py-2 text-xs font-medium">原始剧本</div>
          <Textarea :model-value="novelText" readonly aria-label="原始剧本" class="min-h-0 flex-1 resize-none overflow-auto rounded-none border-0 bg-transparent pb-14 font-mono text-xs leading-5 hover:bg-transparent" @scroll="syncPreviewScroll($event, 'original')" />
        </div>
        <div ref="polishedPreview" class="flex min-w-0 flex-col">
          <div class="shrink-0 border-b bg-primary/5 px-3 py-2 text-xs font-medium text-primary">润色草稿 · 可编辑</div>
          <Textarea v-model="polishDraft" aria-label="润色草稿" class="min-h-0 flex-1 resize-none overflow-auto rounded-none border-0 bg-transparent pb-14 font-mono text-xs leading-5 hover:bg-transparent" @scroll="syncPreviewScroll($event, 'polished')" />
        </div>
      </div>
      <Textarea
        v-else
        v-model="novelText"
        :readonly="readOnly || polishing"
        class="min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-lg border-0 bg-transparent pb-14 placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        :placeholder="inputPlaceholder"
      />
      <div
        v-if="isDraggingTextFile"
        class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary"
      >
        {{ isOriginExplainer ? '松开导入文本并生成镜头规划入口' : '松开导入剧本，可先润色再生成目录' }}
      </div>
      <div
        v-if="polishDraft === null"
        class="pointer-events-none absolute right-3 top-2 rounded bg-background/85 px-2 py-1 text-xs text-muted-foreground/90 backdrop-blur-sm"
      >
        {{ textDropHint }}
      </div>
      <div class="flex min-h-9 shrink-0 items-center border-t border-border/50 bg-background/60 px-3 py-1.5">
        <span class="text-xs text-muted-foreground tabular-nums">{{ textCount }} 字 · {{ lineCount }} 行</span>
      </div>
      <ScriptPolishPanel
        v-if="!isOriginExplainer"
        v-model="novelText"
        v-model:draft="polishDraft"
        :project-id="projectId"
        :disabled="readOnly || parsing"
        :has-episode-plan="hasEpisodePlan"
        @busy="polishing = $event"
      />
    </div>

    <div class="shrink-0 flex flex-wrap items-center gap-3">
      <Button
        :disabled="readOnly || parsing || polishing || polishDraft !== null || !novelText.trim()"
        :variant="hasEpisodePlan ? 'outline' : 'default'"
        class="gap-2"
        :title="planActionDisabledReason || undefined"
        @click="emit('prepare-episodes')"
      >
        <Loader2
          v-if="parsing"
          class="h-4 w-4 animate-spin"
        />
        <Sparkles
          v-else
          class="h-4 w-4"
        />
        {{ parsing ? (isOriginExplainer ? '正在生成镜头规划入口…' : '正在生成分集目录…') : planActionLabel }}
      </Button>
      <span
        v-if="planActionDisabledReason"
        class="text-xs text-muted-foreground"
      >
        {{ planActionDisabledReason }}
      </span>
      <div
        v-if="environmentAssetsCount > 0 || charactersCount > 0"
        class="flex items-center gap-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span class="inline-flex items-center gap-1">
          <span
            class="inline-block h-1.5 w-1.5 rounded-full bg-success"
            aria-hidden="true"
          />
          {{ environmentAssetsCount }} 个场景设定
        </span>
        <span class="inline-flex items-center gap-1">
          <span
            class="inline-block h-1.5 w-1.5 rounded-full bg-primary"
            aria-hidden="true"
          />
          {{ charactersCount }} 个角色
        </span>
      </div>
    </div>

    <div
      v-if="hasEpisodePlan"
      class="shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/20 p-3 text-xs text-muted-foreground"
    >
      <span class="min-w-0 flex-1">{{ planReadyMessage }}</span>
      <Button
        size="sm"
        class="h-8 shrink-0 gap-1.5"
        @click="emit('go-to-videos')"
      >
        去分镜视频
        <ArrowRight class="h-4 w-4" />
      </Button>
    </div>

    <AssetWorkbenchParseProgress
      v-if="parsing || parseProgress?.step === 'error'"
      class="shrink-0"
      :state="parseProgress"
      :running="parsing"
      :mode="progressIsDirectory ? 'directory' : 'episode'"
      :title="progressIsDirectory ? (isOriginExplainer ? '镜头规划入口' : '分集目录') : '分集解析'"
    />

    <p
      v-if="hint && !hasEpisodePlan"
      class="shrink-0 text-xs text-muted-foreground/80"
    >
      {{ hint }}
    </p>
  </AssetWorkbenchStagePanel>
</template>
