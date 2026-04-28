<script setup lang="ts">
import type { ScriptParseMode } from '#shared/types/script'
import { Loader2, Sparkles } from 'lucide-vue-next'

const novelText = defineModel<string>('novelText', { required: true })

const props = defineProps<{
  scriptParseMode: ScriptParseMode
  parsing: boolean
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
const parseProgressChunkText = computed(() => {
  const chunkIndex = props.parseProgress?.chunkIndex
  const chunkCount = props.parseProgress?.chunkCount
  if (typeof chunkIndex !== 'number' || typeof chunkCount !== 'number') return ''
  if (chunkCount <= 1) return ''
  return `分段进度：${chunkIndex}/${chunkCount}`
})

const emit = defineEmits<{
  (e: 'parse'): void
}>()

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
    emit('parse')
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
