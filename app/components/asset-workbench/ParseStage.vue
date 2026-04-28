<script setup lang="ts">
import type { ScriptParseMode } from '#shared/types/script'
import { Loader2, Sparkles } from 'lucide-vue-next'

const novelText = defineModel<string>('novelText', { required: true })

const props = defineProps<{
  scriptParseMode: ScriptParseMode
  parsing: boolean
  episodePlan?: Array<{
    id: string
    title: string
    index: number
    startOffset: number
    endOffset: number
    charCount: number
  }>
  parseProgress?: {
    active?: boolean
    step?: string
    message?: string
    progress?: number
    chunkIndex?: number | null
    chunkCount?: number | null
    logs?: Array<{ id: string, message: string }>
  }
  scenesCount: number
  charactersCount: number
  hint: string
}>()

const textCount = computed(() => novelText.value.length)
const lineCount = computed(() => {
  if (!novelText.value) return 0
  return novelText.value.split(/\r?\n/).length
})
const isDraggingTextFile = ref(false)
const dragCounter = ref(0)
const parseProgressPercent = computed(() => {
  const value = props.parseProgress?.progress
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
})
const parseProgressLogs = computed(() => {
  return (props.parseProgress?.logs || []).slice(-6).reverse()
})
const hasEpisodePlan = computed(() => (props.episodePlan?.length || 0) > 0)
const parseProgressChunkText = computed(() => {
  const chunkIndex = props.parseProgress?.chunkIndex
  const chunkCount = props.parseProgress?.chunkCount
  if (typeof chunkIndex !== 'number' || typeof chunkCount !== 'number') return ''
  if (chunkCount <= 1) return ''
  return `分段进度：${chunkIndex}/${chunkCount}`
})

const emit = defineEmits<{
  (e: 'prepare-episodes' | 'parse' | 'clear-episode-plan'): void
  (e: 'update-episode-title', payload: { id: string, title: string }): void
  (e: 'update-episode-end-offset', payload: { id: string, endOffset: number }): void
}>()

function handleUpdateEpisodeTitle(id: string, title: string) {
  emit('update-episode-title', { id, title })
}

function resolveEpisodeEndRange(index: number): { min: number, max: number } | null {
  const episodes = props.episodePlan || []
  const current = episodes[index]
  if (!current || index >= episodes.length - 1) return null

  const prev = episodes[index - 1]
  const next = episodes[index + 1]
  const min = Math.max((prev?.endOffset ?? current.startOffset) + 200, current.startOffset + 200)
  const max = Math.max(min, (next?.endOffset ?? current.endOffset) - 200)
  return { min, max }
}

function handleUpdateEpisodeEndOffset(index: number, rawValue: string) {
  const episodes = props.episodePlan || []
  const current = episodes[index]
  if (!current || index >= episodes.length - 1) return

  const numericValue = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(numericValue)) return

  const range = resolveEpisodeEndRange(index)
  if (!range) return

  const normalizedEndOffset = Math.min(range.max, Math.max(range.min, numericValue))
  emit('update-episode-end-offset', {
    id: current.id,
    endOffset: normalizedEndOffset
  })
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
  if (props.parsing) return

  dragCounter.value += 1
  isDraggingTextFile.value = true
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  if (props.parsing) return

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  if (props.parsing) return

  dragCounter.value = Math.max(0, dragCounter.value - 1)
  if (dragCounter.value === 0) {
    isDraggingTextFile.value = false
  }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (props.parsing) return

  resetDragState()

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const fileList = Array.from(files)
  const textFile = fileList.find(isTextFile)
  if (!textFile) {
    window.alert('请拖拽文本文件（.txt /.md）')
    return
  }

  try {
    const fileText = (await textFile.text()).replace(/^\uFEFF/, '')
    if (!fileText.trim()) {
      window.alert('文本文件内容为空，请检查后重试')
      return
    }

    novelText.value = fileText
    emit('prepare-episodes')
  } catch (error) {
    console.error('[ParseStage] 读取文本文件失败:', error)
    window.alert('文本文件读取失败，请重试')
  }
}
</script>

<template>
  <AssetWorkbenchStagePanel
    content-class="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden"
  >
    <div
      class="relative flex-1 min-h-[280px] rounded-lg border transition-colors"
      :class="isDraggingTextFile ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-muted-foreground/20 bg-muted/30'"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <Textarea
        v-model="novelText"
        class="h-full min-h-[280px] w-full resize-none overflow-y-auto rounded-lg border-0 bg-transparent placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="粘贴完整剧本原文..."
      />
      <div
        v-if="isDraggingTextFile"
        class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary"
      >
        松开导入文本并开始解析
      </div>
      <div
        class="pointer-events-none absolute right-3 top-2 rounded bg-background/85 px-2 py-1 text-xs text-muted-foreground/90 backdrop-blur-sm"
      >
        支持粘贴文本 / 拖拽 .txt .md 自动解析
      </div>
      <div
        class="pointer-events-none absolute bottom-2 right-3 rounded bg-background/85 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm tabular-nums"
      >
        {{ textCount }} 字 · {{ lineCount }} 行
      </div>
    </div>

    <div class="shrink-0 flex flex-wrap items-center gap-3">
      <Button
        :disabled="parsing || !novelText.trim()"
        class="gap-2"
        @click="hasEpisodePlan ? emit('parse') : emit('prepare-episodes')"
      >
        <Loader2
          v-if="parsing"
          class="h-4 w-4 animate-spin"
        />
        <Sparkles
          v-else
          class="h-4 w-4"
        />
        {{ hasEpisodePlan ? '按分集解析剧本' : '生成分集目录' }}
      </Button>
      <Button
        v-if="hasEpisodePlan"
        variant="outline"
        :disabled="parsing"
        @click="emit('clear-episode-plan')"
      >
        重新分集
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

    <div
      v-if="hasEpisodePlan"
      class="shrink-0 rounded-md border border-border/60 bg-muted/20 p-3"
    >
      <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>分集目录（可编辑标题与边界）</span>
        <span>共 {{ episodePlan?.length || 0 }} 集</span>
      </div>
      <div class="max-h-52 space-y-2 overflow-y-auto pr-1">
        <div
          v-for="(episode, index) in episodePlan"
          :key="episode.id"
          class="rounded border border-border/50 bg-background/80 p-2"
        >
          <div class="flex items-center gap-2">
            <span class="w-12 text-xs text-muted-foreground">第{{ episode.index }}集</span>
            <Input
              :model-value="episode.title"
              class="h-8"
              @update:model-value="(value) => handleUpdateEpisodeTitle(episode.id, String(value || ''))"
            />
          </div>
          <div class="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>范围 {{ episode.startOffset }} - {{ episode.endOffset }}</span>
            <span>约 {{ episode.charCount }} 字</span>
            <label
              v-if="index < (episodePlan?.length || 0) - 1"
              class="inline-flex items-center gap-1"
            >
              <span>边界</span>
              <Input
                type="number"
                :min="resolveEpisodeEndRange(index)?.min"
                :max="resolveEpisodeEndRange(index)?.max"
                :model-value="episode.endOffset"
                class="h-7 w-28"
                @update:model-value="(value) => handleUpdateEpisodeEndOffset(index, String(value || ''))"
              />
            </label>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="parsing"
      class="shrink-0 rounded-md border border-primary/20 bg-primary/5 p-3"
    >
      <div class="flex items-center justify-between gap-2 text-xs">
        <p class="text-foreground/90">
          {{ parseProgress?.message || '解析进行中，请稍候…' }}
        </p>
        <span class="tabular-nums text-primary/80">
          {{ parseProgressPercent }}%
        </span>
      </div>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
        <div
          class="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          :style="{ width: `${parseProgressPercent}%` }"
        />
      </div>
      <p
        v-if="parseProgressChunkText"
        class="mt-2 text-[11px] text-muted-foreground"
      >
        {{ parseProgressChunkText }}
      </p>
      <ul
        v-if="parseProgressLogs.length > 0"
        class="mt-2 max-h-28 space-y-1 overflow-y-auto text-[11px] text-muted-foreground"
      >
        <li
          v-for="item in parseProgressLogs"
          :key="item.id"
        >
          {{ item.message }}
        </li>
      </ul>
    </div>

    <p
      v-if="hint"
      class="shrink-0 text-xs text-muted-foreground/80"
    >
      {{ hint }}
    </p>
  </AssetWorkbenchStagePanel>
</template>
