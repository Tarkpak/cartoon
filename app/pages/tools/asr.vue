<script setup lang="ts">
import {
  AudioLines,
  Check,
  ChevronRight,
  Clipboard,
  Clock3,
  Download,
  FileAudio,
  FileVideo,
  History,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload
} from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type ResultView = 'text' | 'srt' | 'segments'
type ProcessStatus = 'idle' | 'uploading' | 'recognizing' | 'completed' | 'failed'

interface AsrSegment {
  startTime: number
  endTime: number
  transcript: string
}

interface AsrResult {
  id: string
  taskId: string
  fileName: string
  mediaKind: 'audio' | 'video'
  fileSizeBytes: number
  text: string
  srt: string
  segments: AsrSegment[]
  segmentCount: number
  durationMs: number
  createdAt: string
}

interface AsrApiResponse {
  success: boolean
  data?: AsrResult
  message?: string
}

const { toast } = useToast()
const { confirm } = useConfirm()
const fileInputRef = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const previewUrl = ref('')
const draggingFile = ref(false)
const status = ref<ProcessStatus>('idle')
const uploadProgress = ref(0)
const errorMessage = ref('')
const result = ref<AsrResult | null>(null)
const resultView = ref<ResultView>('text')
const resultSectionRef = ref<HTMLElement | null>(null)
const historyItems = ref<AsrResult[]>([])
const selectedHistoryItem = ref<AsrResult | null>(null)
const historyDrawerOpen = ref(false)
const historyResultView = ref<ResultView>('text')
const loadingHistory = ref(false)
const deletingHistoryId = ref('')

const supportedExtensions = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'amr',
  'mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpeg',
  'mpg', 'ts', 'm2ts', 'mts', '3gp'
])

const processing = computed(() => status.value === 'uploading' || status.value === 'recognizing')
const mediaKind = computed<'audio' | 'video'>(() => {
  if (selectedFile.value?.type.startsWith('video/')) return 'video'
  const extension = selectedFile.value?.name.split('.').pop()?.toLowerCase() || ''
  return ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpeg', 'mpg', 'ts', 'm2ts', 'mts', '3gp'].includes(extension)
    ? 'video'
    : 'audio'
})
const statusLabel = computed(() => {
  if (status.value === 'uploading') return `正在上传 ${uploadProgress.value}%`
  if (status.value === 'recognizing') return '正在识别语音并生成字幕'
  if (status.value === 'completed') return '识别完成'
  if (status.value === 'failed') return '识别失败'
  return '等待开始'
})

onMounted(() => {
  void loadHistory()
})

onUnmounted(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function formatTimestamp(value: number) {
  const safe = Math.max(0, value)
  const hours = Math.floor(safe / 3_600_000)
  const minutes = Math.floor((safe % 3_600_000) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1_000)
  const milliseconds = safe % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

function isSupportedFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return supportedExtensions.has(extension)
}

function selectFile(file: File) {
  if (processing.value) return
  if (!isSupportedFile(file)) {
    toast.error('不支持的文件格式')
    return
  }
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  selectedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
  status.value = 'idle'
  uploadProgress.value = 0
  errorMessage.value = ''
  result.value = null
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (file) selectFile(file)
  if (input) input.value = ''
}

function handleDragEnter(event: DragEvent) {
  if (processing.value || !event.dataTransfer?.types.includes('Files')) return
  draggingFile.value = true
}

function handleDragLeave(event: DragEvent) {
  const currentTarget = event.currentTarget as Node | null
  const relatedTarget = event.relatedTarget as Node | null
  if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) return
  draggingFile.value = false
}

function handleDrop(event: DragEvent) {
  draggingFile.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) selectFile(file)
}

function transcribeMedia(file: File): Promise<AsrResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    formData.append('media', file, file.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/tools/asr/transcribe')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      uploadProgress.value = Math.min(100, Math.round((event.loaded / event.total) * 100))
    }
    xhr.upload.onload = () => {
      status.value = 'recognizing'
      uploadProgress.value = 100
    }
    xhr.onload = () => {
      const response = xhr.response as AsrApiResponse | null
      if (xhr.status >= 200 && xhr.status < 300 && response?.success && response.data) {
        resolve(response.data)
        return
      }
      reject(new Error(response?.message || '语音识别失败'))
    }
    xhr.onerror = () => reject(new Error('无法连接语音识别服务，请确认后端正在运行'))
    xhr.send(formData)
  })
}

async function startTranscription() {
  if (!selectedFile.value || processing.value) return
  status.value = 'uploading'
  uploadProgress.value = 0
  errorMessage.value = ''
  result.value = null
  try {
    result.value = await transcribeMedia(selectedFile.value)
    status.value = 'completed'
    resultView.value = 'text'
    toast.success('语音识别完成')
    void loadHistory()
    await nextTick()
    resultSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (error) {
    status.value = 'failed'
    errorMessage.value = error instanceof Error ? error.message : '语音识别失败'
    toast.error('语音识别失败', { description: errorMessage.value })
  }
}

function resetWorkbench() {
  if (processing.value) return
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  selectedFile.value = null
  result.value = null
  errorMessage.value = ''
  uploadProgress.value = 0
  status.value = 'idle'
}

async function loadHistory() {
  loadingHistory.value = true
  try {
    const response = await $fetch<{ success: boolean, data?: { items?: AsrResult[] }, message?: string }>('/api/tools/asr/history')
    if (!response.success) throw new Error(response.message || '读取历史失败')
    historyItems.value = response.data?.items || []
  } catch (error) {
    console.error('Failed to load ASR history:', error)
  } finally {
    loadingHistory.value = false
  }
}

function openHistoryDrawer(item: AsrResult) {
  selectedHistoryItem.value = item
  historyResultView.value = 'text'
  historyDrawerOpen.value = true
}

async function deleteHistoryItem(item: AsrResult) {
  const confirmed = await confirm({
    title: '删除这条识别记录？',
    description: `“${item.fileName}”的识别文本和字幕将被移除。`,
    confirmText: '删除记录',
    variant: 'destructive'
  })
  if (!confirmed) return

  deletingHistoryId.value = item.id
  try {
    await $fetch(`/api/tools/asr/history/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    historyItems.value = historyItems.value.filter(history => history.id !== item.id)
    if (selectedHistoryItem.value?.id === item.id) {
      selectedHistoryItem.value = null
      historyDrawerOpen.value = false
    }
  } catch (error) {
    toast.error('删除历史失败', { description: error instanceof Error ? error.message : '操作失败' })
  } finally {
    deletingHistoryId.value = ''
  }
}

function formatHistoryTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

async function copyAsrResult(source: AsrResult, view: ResultView) {
  const content = view === 'srt' ? source.srt : source.text
  await navigator.clipboard.writeText(content)
  toast.success('已复制到剪贴板')
}

async function copyResult() {
  if (!result.value) return
  await copyAsrResult(result.value, resultView.value)
}

function downloadAsrResult(source: AsrResult, format: 'txt' | 'srt') {
  try {
    const content = format === 'srt' ? source.srt : source.text
    const mimeType = format === 'srt' ? 'application/x-subrip;charset=utf-8' : 'text/plain;charset=utf-8'
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const basename = source.fileName.replace(/\.[^.]+$/, '') || 'transcript'
    const downloadName = `${basename}.${format}`
    anchor.href = url
    anchor.download = downloadName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    toast.success('下载已开始', { description: downloadName })
  } catch (error) {
    toast.error('下载失败', {
      description: error instanceof Error ? error.message : '无法创建下载文件'
    })
  }
}

function downloadResult(format: 'txt' | 'srt') {
  if (result.value) downloadAsrResult(result.value, format)
}
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="语音识别"
      compact
      class="min-h-16"
    >
      <template #actions>
        <Button
          v-if="selectedFile && !processing"
          variant="ghost"
          size="icon"
          title="重新选择文件"
          aria-label="重新选择文件"
          @click="resetWorkbench"
        >
          <RotateCcw class="h-4 w-4" />
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent scroll inner-class="mx-auto w-full max-w-5xl space-y-6 pt-4 pb-8">
      <Card
        class="overflow-hidden transition-[border-color,background-color,box-shadow]"
        :class="draggingFile ? 'border-primary bg-primary/5 ring-2 ring-primary/15' : ''"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <input
          ref="fileInputRef"
          type="file"
          accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma,.amr,.mkv,.avi,.flv,.wmv,.m2ts,.mts"
          class="hidden"
          @change="handleFileChange"
        >

        <button
          v-if="!selectedFile"
          type="button"
          class="flex min-h-64 w-full flex-col items-center justify-center bg-card px-6 py-12 text-center transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          @click="triggerFileInput"
        >
          <span class="grid h-12 w-12 place-items-center rounded-md bg-primary/10 ring-1 ring-primary/15">
            <Upload class="h-5 w-5 text-primary" />
          </span>
          <span class="mt-4 text-sm font-semibold text-foreground">选择音频或视频文件</span>
          <span class="mt-1.5 text-xs text-muted-foreground">也可以将文件拖到这里</span>
        </button>

        <div
          v-else
          class="grid lg:grid-cols-[minmax(280px,0.9fr)_minmax(340px,1.1fr)]"
        >
          <div class="flex h-[min(58vh,520px)] min-h-64 items-center justify-center bg-[hsl(224_18%_9%)] p-3 sm:p-5 lg:min-h-[32rem]">
            <video
              v-if="mediaKind === 'video'"
              :src="previewUrl"
              controls
              playsinline
              preload="metadata"
              class="h-full w-full rounded-md bg-black object-contain"
            />
            <div
              v-else
              class="flex w-full max-w-md flex-col items-center justify-center rounded-md bg-white/5 px-5 py-10 ring-1 ring-white/10"
            >
              <div class="grid h-14 w-14 place-items-center rounded-md bg-white/10">
                <AudioLines class="h-7 w-7 text-white/80" />
              </div>
              <audio :src="previewUrl" controls class="mt-7 w-full" />
            </div>
          </div>

          <section class="flex min-w-0 flex-col justify-between gap-6 border-t border-border/70 p-5 sm:p-6 lg:border-l lg:border-t-0 lg:p-8">
            <div class="space-y-6">
              <div class="flex min-w-0 items-start gap-3">
                <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted">
                  <FileVideo v-if="mediaKind === 'video'" class="h-5 w-5 text-muted-foreground" />
                  <FileAudio v-else class="h-5 w-5 text-muted-foreground" />
                </div>
                <div class="min-w-0 flex-1">
                  <h2 class="truncate text-base font-semibold text-foreground">{{ selectedFile.name }}</h2>
                  <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{{ mediaKind === 'video' ? '视频' : '音频' }}</span>
                    <span aria-hidden="true">·</span>
                    <span>{{ formatBytes(selectedFile.size) }}</span>
                  </div>
                </div>
                <Button
                  v-if="!processing"
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="h-9 w-9 shrink-0"
                  title="更换文件"
                  aria-label="更换文件"
                  @click="triggerFileInput"
                >
                  <RotateCcw class="h-4 w-4" />
                </Button>
              </div>

              <div class="grid grid-cols-2 gap-3 border-y border-border/70 py-4 text-sm">
                <div>
                  <p class="text-xs text-muted-foreground">识别内容</p>
                  <p class="mt-1 font-medium text-foreground">语音与时间轴</p>
                </div>
                <div>
                  <p class="text-xs text-muted-foreground">输出格式</p>
                  <p class="mt-1 font-medium text-foreground">TXT · SRT</p>
                </div>
              </div>

              <div v-if="processing || status === 'completed'" class="space-y-3">
                <div class="flex items-center justify-between gap-3 text-sm">
                  <span class="text-muted-foreground">处理状态</span>
                  <span class="inline-flex items-center font-semibold text-foreground">
                    <Loader2 v-if="processing" class="mr-2 h-4 w-4 animate-spin" />
                    <Check v-else class="mr-2 h-4 w-4 text-success" />
                    {{ statusLabel }}
                  </span>
                </div>
                <Progress v-if="status === 'uploading'" :model-value="uploadProgress" />
              </div>

              <div
                v-if="errorMessage"
                role="alert"
                class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive"
              >
                {{ errorMessage }}
              </div>
            </div>

            <div class="space-y-2">
              <Button
                class="h-11 w-full"
                :disabled="processing"
                @click="startTranscription"
              >
                <Loader2 v-if="processing" class="mr-2 h-4 w-4 animate-spin" />
                <Sparkles v-else class="mr-2 h-4 w-4" />
                {{ processing ? statusLabel : status === 'failed' ? '重试识别' : status === 'completed' ? '重新识别' : '开始识别' }}
              </Button>
              <p v-if="processing" class="text-center text-xs text-muted-foreground">
                处理期间请保持当前页面打开
              </p>
            </div>
          </section>
        </div>
      </Card>

      <section v-if="result" ref="resultSectionRef" class="scroll-mt-4">
        <Card>
        <CardHeader class="border-b">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle class="text-base">识别结果</CardTitle>
              <CardDescription class="mt-1">
                {{ result.segmentCount }} 个片段 · {{ formatTimestamp(result.durationMs) }}
              </CardDescription>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" @click="copyResult">
                <Clipboard class="mr-2 h-4 w-4" />
                复制
              </Button>
              <Button variant="outline" size="sm" @click="downloadResult('txt')">
                <Download class="mr-2 h-4 w-4" />
                TXT
              </Button>
              <Button variant="outline" size="sm" @click="downloadResult('srt')">
                <Download class="mr-2 h-4 w-4" />
                SRT
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="pt-6">
          <div class="mb-4 flex w-fit rounded-md border bg-muted/30 p-1" role="tablist" aria-label="识别结果格式">
            <button
              v-for="option in ([['text', '纯文本'], ['srt', 'SRT 字幕'], ['segments', '时间轴']] as const)"
              :key="option[0]"
              type="button"
              role="tab"
              :aria-selected="resultView === option[0]"
              class="h-8 rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="resultView === option[0] ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="resultView = option[0]"
            >
              {{ option[1] }}
            </button>
          </div>

          <pre
            v-if="resultView !== 'segments'"
            class="max-h-[32rem] min-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-4 font-sans text-sm leading-7 text-foreground"
          >{{ resultView === 'srt' ? result.srt : result.text }}</pre>

          <div v-else class="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="w-16">序号</TableHead>
                  <TableHead class="w-48">时间</TableHead>
                  <TableHead>识别文本</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="(segment, index) in result.segments" :key="`${segment.startTime}-${index}`">
                  <TableCell class="font-mono text-xs text-muted-foreground">{{ index + 1 }}</TableCell>
                  <TableCell class="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {{ formatTimestamp(segment.startTime) }} – {{ formatTimestamp(segment.endTime) }}
                  </TableCell>
                  <TableCell class="leading-6">{{ segment.transcript }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
        </Card>
      </section>

      <section class="space-y-3 border-t border-border/70 pt-5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2 text-sm font-semibold text-foreground">
            <History class="h-4 w-4" />
            最近识别
          </div>
          <span v-if="loadingHistory" class="text-xs text-muted-foreground">更新中...</span>
        </div>

        <div
          v-if="historyItems.length > 0"
          class="overflow-hidden rounded-md border border-border/70 bg-card/55"
        >
          <article
            v-for="item in historyItems"
            :key="item.id"
            tabindex="0"
            class="group flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-4"
            @click="openHistoryDrawer(item)"
            @keydown.enter.prevent="openHistoryDrawer(item)"
          >
            <div class="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-muted">
              <FileVideo v-if="item.mediaKind === 'video'" class="h-5 w-5 text-muted-foreground" />
              <FileAudio v-else class="h-5 w-5 text-muted-foreground" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-foreground">{{ item.fileName }}</p>
              <div class="mt-1.5 flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                <span>{{ item.segmentCount }} 个片段</span>
                <span>{{ formatTimestamp(item.durationMs) }}</span>
                <span class="hidden shrink-0 items-center gap-1 md:inline-flex">
                  <Clock3 class="h-3 w-3" />
                  {{ formatHistoryTime(item.createdAt) }}
                </span>
              </div>
            </div>
            <Badge variant="success" class="hidden shrink-0 sm:inline-flex">已完成</Badge>
            <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </article>
        </div>

        <div
          v-else-if="!loadingHistory"
          class="flex items-center gap-3 py-5 text-muted-foreground"
        >
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
            <History class="h-4 w-4" />
          </div>
          <p class="text-sm font-medium text-foreground">暂无识别记录</p>
        </div>
      </section>
    </AppPageContent>

    <Drawer v-model:open="historyDrawerOpen" direction="right">
      <DrawerContent class="!bottom-auto !left-auto !right-0 !top-0 !mt-0 h-full w-full max-w-2xl rounded-none border-l">
        <DrawerHeader class="border-b px-5 pb-4 text-left">
          <DrawerTitle class="line-clamp-2 text-base">
            {{ selectedHistoryItem?.fileName || '识别详情' }}
          </DrawerTitle>
          <DrawerDescription v-if="selectedHistoryItem">
            {{ selectedHistoryItem.segmentCount }} 个片段 · {{ formatTimestamp(selectedHistoryItem.durationMs) }} · {{ formatHistoryTime(selectedHistoryItem.createdAt) }}
          </DrawerDescription>
        </DrawerHeader>

        <div
          v-if="selectedHistoryItem"
          class="min-h-0 flex-1 overflow-auto px-5 py-4"
        >
          <div class="space-y-5">
            <div class="grid grid-cols-3 gap-3 border-b border-border/70 pb-4 text-sm">
              <div>
                <p class="text-xs text-muted-foreground">媒体类型</p>
                <p class="mt-1 font-medium">{{ selectedHistoryItem.mediaKind === 'video' ? '视频' : '音频' }}</p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">文件大小</p>
                <p class="mt-1 font-medium">{{ formatBytes(selectedHistoryItem.fileSizeBytes) }}</p>
              </div>
              <div>
                <p class="text-xs text-muted-foreground">输出格式</p>
                <p class="mt-1 font-medium">TXT · SRT</p>
              </div>
            </div>

            <div class="flex w-fit rounded-md border bg-muted/30 p-1" role="tablist" aria-label="历史识别结果格式">
              <button
                v-for="option in ([['text', '纯文本'], ['srt', 'SRT 字幕'], ['segments', '时间轴']] as const)"
                :key="option[0]"
                type="button"
                role="tab"
                :aria-selected="historyResultView === option[0]"
                class="h-8 rounded-sm px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="historyResultView === option[0] ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
                @click="historyResultView = option[0]"
              >
                {{ option[1] }}
              </button>
            </div>

            <pre
              v-if="historyResultView !== 'segments'"
              class="max-h-[calc(100vh-18rem)] min-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-4 font-sans text-sm leading-7 text-foreground"
            >{{ historyResultView === 'srt' ? selectedHistoryItem.srt : selectedHistoryItem.text }}</pre>

            <div v-else class="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-36">时间</TableHead>
                    <TableHead>识别文本</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(segment, index) in selectedHistoryItem.segments" :key="`${segment.startTime}-${index}`">
                    <TableCell class="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {{ formatTimestamp(segment.startTime) }}<br>
                      {{ formatTimestamp(segment.endTime) }}
                    </TableCell>
                    <TableCell class="leading-6">{{ segment.transcript }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DrawerFooter v-if="selectedHistoryItem" class="border-t px-5 py-4">
          <div class="flex flex-wrap justify-end gap-2">
            <Button variant="outline" @click="copyAsrResult(selectedHistoryItem, historyResultView)">
              <Clipboard class="h-4 w-4" />
              复制
            </Button>
            <Button variant="outline" @click="downloadAsrResult(selectedHistoryItem, 'txt')">
              <Download class="h-4 w-4" />
              TXT
            </Button>
            <Button variant="outline" @click="downloadAsrResult(selectedHistoryItem, 'srt')">
              <Download class="h-4 w-4" />
              SRT
            </Button>
            <Button
              variant="destructive"
              :disabled="deletingHistoryId === selectedHistoryItem.id"
              @click="deleteHistoryItem(selectedHistoryItem)"
            >
              <Loader2 v-if="deletingHistoryId === selectedHistoryItem.id" class="h-4 w-4 animate-spin" />
              <Trash2 v-else class="h-4 w-4" />
              删除
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  </AppPage>
</template>
