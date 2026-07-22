<script setup lang="ts">
import {
  AlertCircle,
  CheckCircle2,
  FileVideo,
  FolderInput,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-vue-next'
import { useVideoImport, type VideoImportConfig, type VideoImportSeriesPreview } from '@/composables/useVideoImport'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

const router = useRouter()
const {
  tasks,
  loading,
  uploading,
  error,
  fetchTasks,
  uploadVideo,
  uploadSeriesFolder,
  previewSeriesFolder,
  deleteTasks
} = useVideoImport()

const fileInputKey = ref(0)
const singleFileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const selectedFolder = ref<string | null>(null)
const selectedSeriesPreview = ref<VideoImportSeriesPreview | null>(null)
const previewingSeriesFolder = ref(false)
const uploadMode = ref<'single' | 'series'>('series')
const contentType = ref<'story' | 'origin_explainer'>('story')
const contentTypeOptions = [
  {
    value: 'story',
    label: '剧情内容',
    description: '提取剧情结构、人物关系和场景信息，按精品剧方式创建项目。'
  },
  {
    value: 'origin_explainer',
    label: '科普内容',
    description: '提取知识点、过程步骤和可视化线索，按科普拆解方式创建项目。'
  }
] as const
const selectedTaskIds = ref<Set<string>>(new Set())
const showBatchActions = ref(false)
let refreshTimer: number | null = null

const runningStatuses = new Set(['pending', 'extracting', 'transcribing', 'generating_script', 'importing'])
const hasRunningTasks = computed(() => tasks.value.some(task => runningStatuses.has(task.status)))
const hasSelection = computed(() => selectedTaskIds.value.size > 0)
const allTasksSelected = computed(() => tasks.value.length > 0 && selectedTaskIds.value.size === tasks.value.length)
const failedTasks = computed(() => tasks.value.filter(task => task.status === 'failed' || task.status === 'cancelled'))
const completedTasks = computed(() => tasks.value.filter(task => task.status === 'imported'))

watch(hasRunningTasks, syncRefreshTimer)

onMounted(async () => {
  await fetchTasks()
  syncRefreshTimer(hasRunningTasks.value)
})

onUnmounted(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
})

function syncRefreshTimer(running: boolean) {
  if (typeof window === 'undefined') return
  if (running && !refreshTimer) {
    refreshTimer = window.setInterval(() => {
      void fetchTasks()
    }, 2500)
  }
  if (!running && refreshTimer) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function setUploadMode(mode: 'single' | 'series') {
  uploadMode.value = mode
  if (mode === 'single') {
    selectedFolder.value = null
    selectedSeriesPreview.value = null
  } else {
    selectedFile.value = null
    fileInputKey.value += 1
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
}

function triggerSingleFileSelect() {
  singleFileInput.value?.click()
}

async function handleSelectFolder() {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: '选择剧集文件夹'
    })

    if (!selected || typeof selected !== 'string') return
    selectedFolder.value = selected
    selectedSeriesPreview.value = null
    previewingSeriesFolder.value = true
    try {
      selectedSeriesPreview.value = await previewSeriesFolder(selected)
    } finally {
      previewingSeriesFolder.value = false
    }
  } catch (err) {
    console.error('Failed to open folder dialog:', err)
    if (!selectedFolder.value) {
      window.alert('当前环境无法打开文件夹选择器，请在桌面端使用整部剧导入。')
    }
  }
}

async function handleUpload() {
  const config: VideoImportConfig = {
    scriptParseMode: contentType.value === 'origin_explainer' ? 'origin_explainer' : 'premium_drama'
  }

  if (uploadMode.value === 'single') {
    if (!selectedFile.value) return
    const taskId = await uploadVideo(selectedFile.value, config)
    selectedFile.value = null
    fileInputKey.value += 1
    await router.push(`/import/video/${taskId}`)
    return
  }

  if (!selectedFolder.value) return
  const result = await uploadSeriesFolder(selectedFolder.value, config)
  selectedFolder.value = null
  selectedSeriesPreview.value = null
  await router.push(`/import/video/${result.seriesId}`)
}

function toggleTaskSelection(taskId: string) {
  if (selectedTaskIds.value.has(taskId)) {
    selectedTaskIds.value.delete(taskId)
  } else {
    selectedTaskIds.value.add(taskId)
  }
}

function toggleAllTasks() {
  if (allTasksSelected.value) {
    selectedTaskIds.value.clear()
  } else {
    tasks.value.forEach(task => selectedTaskIds.value.add(task.id))
  }
}

async function handleDeleteSelected() {
  if (!hasSelection.value) return
  const count = selectedTaskIds.value.size
  if (!confirm(`确定要删除选中的 ${count} 个任务吗？此操作无法撤销。`)) return
  await deleteTasks(Array.from(selectedTaskIds.value))
  selectedTaskIds.value.clear()
  showBatchActions.value = false
}

async function handleDeleteFailed() {
  if (failedTasks.value.length === 0) return
  if (!confirm(`确定要删除所有失败的任务吗？共 ${failedTasks.value.length} 个任务，此操作无法撤销。`)) return
  await deleteTasks(failedTasks.value.map(task => task.id))
}

async function handleDeleteCompleted() {
  if (completedTasks.value.length === 0) return
  if (!confirm(`确定要删除所有已完成的任务吗？共 ${completedTasks.value.length} 个任务，此操作无法撤销。`)) return
  await deleteTasks(completedTasks.value.map(task => task.id))
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: '准备中',
    extracting: '提取音频中',
    transcribing: '识别字幕中',
    subtitle_ready: '请确认字幕',
    generating_script: '生成剧本中',
    script_ready: '请确认剧本',
    importing: '创建项目中',
    imported: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }
  return map[status] || status
}

function statusVariant(status: string) {
  if (status === 'failed') return 'destructive'
  if (status === 'imported') return 'default'
  if (status === 'cancelled') return 'secondary'
  return 'outline'
}

function friendlyErrorMessage(message?: string | null) {
  const raw = message || ''
  if (/FOREIGN KEY constraint failed/i.test(raw)) {
    return '创建转换任务失败，任务数据关联异常。请重试；如果仍失败，请删除失败记录后再导入。'
  }
  if (/permission denied|denied|operation not permitted/i.test(raw)) {
    return '无法访问所选文件或文件夹，请检查系统权限后重试。'
  }
  return raw
}

function formatDateRelative(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`
  return date.toLocaleDateString()
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatSeconds(value?: number | null) {
  if (!value || value <= 0) return ''
  if (value < 60) return `${Math.round(value)} 秒`
  return `${Math.floor(value / 60)} 分 ${Math.round(value % 60)} 秒`
}
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="视频转项目"
      description="导入单集或整部剧，转换完成后进入详情页确认字幕和剧本"
    >
      <template #actions>
      <Button
        variant="outline"
        class="gap-2"
        :disabled="loading"
        @click="fetchTasks"
      >
        <RefreshCw
          class="h-4 w-4"
          :class="loading ? 'animate-spin' : ''"
        />
        刷新
      </Button>
      </template>
    </AppPageHeader>

    <AppPageContent inner-class="flex h-full min-h-0 flex-col gap-4">
      <div
        v-if="error"
        class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <AlertCircle class="h-4 w-4 shrink-0" />
        {{ error }}
      </div>

      <Card class="w-full">
        <CardHeader class="pb-3">
          <CardTitle class="flex items-center gap-2 text-base">
            <Upload class="h-4 w-4" />
            导入来源
          </CardTitle>
        </CardHeader>
        <CardContent class="space-y-3">
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              class="flex-1"
              :class="uploadMode === 'series' ? 'bg-muted' : ''"
              @click="setUploadMode('series')"
            >
              整部剧
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="flex-1"
              :class="uploadMode === 'single' ? 'bg-muted' : ''"
              @click="setUploadMode('single')"
            >
              单集
            </Button>
          </div>

          <div v-if="uploadMode === 'single'" class="space-y-2">
            <input
              :key="fileInputKey"
              ref="singleFileInput"
              type="file"
              accept="video/*"
              class="hidden"
              @change="handleFileChange"
            >
            <Button
              variant="outline"
              class="w-full justify-start"
              @click="triggerSingleFileSelect"
            >
              <Upload class="mr-2 h-4 w-4" />
              {{ selectedFile ? '重新选择视频' : '选择视频文件' }}
            </Button>
            <div v-if="selectedFile" class="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div class="break-all">{{ selectedFile.name }}</div>
            </div>
          </div>

          <div v-else class="space-y-2">
            <Button
              variant="outline"
              class="w-full justify-start"
              @click="handleSelectFolder"
            >
              <FolderInput class="mr-2 h-4 w-4" />
              {{ selectedFolder ? '重新选择文件夹' : '选择剧集文件夹' }}
            </Button>
            <div v-if="selectedFolder" class="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <div class="break-all text-muted-foreground">
                {{ selectedFolder }}
              </div>
              <div v-if="previewingSeriesFolder" class="mt-2 text-muted-foreground">
                正在检查剧集文件...
              </div>
              <div v-else-if="selectedSeriesPreview" class="mt-2 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-medium text-foreground">
                    识别到 {{ selectedSeriesPreview.episodeCount }} 个视频
                  </span>
                  <span class="text-muted-foreground">
                    {{ selectedSeriesPreview.shortClipRecommended ? '连续片段模式' : '按集导入' }}
                  </span>
                </div>
                <div
                  v-if="selectedSeriesPreview.shortClipRecommended"
                  class="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-primary"
                >
                  多数视频较短，将先合并理解剧情，再创建项目。
                </div>
                <div class="max-h-40 overflow-y-auto rounded border bg-background">
                  <div
                    v-for="file in selectedSeriesPreview.files.slice(0, 12)"
                    :key="file.path"
                    class="flex items-center justify-between gap-2 border-b px-2 py-1.5 last:border-b-0"
                  >
                    <span class="min-w-0 truncate">
                      第{{ file.episodeNumber }}集 · {{ file.filename }}
                    </span>
                    <span class="shrink-0 text-muted-foreground">
                      {{ [formatSeconds(file.durationSeconds), formatBytes(file.sizeBytes)].filter(Boolean).join(' · ') }}
                    </span>
                  </div>
                  <div
                    v-if="selectedSeriesPreview.files.length > 12"
                    class="px-2 py-1.5 text-muted-foreground"
                  >
                    还有 {{ selectedSeriesPreview.files.length - 12 }} 个视频将按同样顺序导入
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-1.5">
            <label class="text-xs font-medium text-muted-foreground">视频内容</label>
            <Select v-model="contentType">
              <SelectTrigger>
                <SelectValue placeholder="视频内容" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in contentTypeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs leading-5 text-muted-foreground">
              {{ contentTypeOptions.find(option => option.value === contentType)?.description }}
            </p>
          </div>

          <Button
            class="w-full gap-2"
            :disabled="(uploadMode === 'single' ? !selectedFile : !selectedFolder || previewingSeriesFolder || !selectedSeriesPreview?.episodeCount) || uploading"
            @click="handleUpload"
          >
            <Upload class="h-4 w-4" />
            {{
              uploading
                ? '上传中...'
                : (uploadMode === 'series' && selectedSeriesPreview?.episodeCount
                  ? `导入并识别 ${selectedSeriesPreview.episodeCount} 集`
                  : (uploadMode === 'series' ? '开始转换剧集' : '开始转换'))
            }}
          </Button>
        </CardContent>
      </Card>

      <Card class="flex min-h-0 w-full flex-col overflow-hidden">
        <CardHeader class="border-b pb-3">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle class="flex items-center gap-2 text-base">
                <FileVideo class="h-4 w-4" />
                转换任务
              </CardTitle>
              <CardDescription>
                进入详情页确认字幕、生成剧本并创建项目
              </CardDescription>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                @click="showBatchActions = !showBatchActions"
              >
                {{ showBatchActions ? '取消管理' : '管理任务' }}
              </Button>
              <Button
                v-if="showBatchActions"
                variant="outline"
                size="sm"
                @click="toggleAllTasks"
              >
                {{ allTasksSelected ? '取消全选' : '全选' }}
              </Button>
              <Button
                v-if="showBatchActions"
                variant="destructive"
                size="sm"
                class="gap-2"
                :disabled="!hasSelection"
                @click="handleDeleteSelected"
              >
                <Trash2 class="h-4 w-4" />
                删除选中
              </Button>
              <Button
                v-if="showBatchActions"
                variant="ghost"
                size="sm"
                :disabled="failedTasks.length === 0"
                @click="handleDeleteFailed"
              >
                清空失败
              </Button>
              <Button
                v-if="showBatchActions"
                variant="ghost"
                size="sm"
                :disabled="completedTasks.length === 0"
                @click="handleDeleteCompleted"
              >
                清空完成
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent class="min-h-0 flex-1 overflow-auto p-0">
          <button
            v-for="task in tasks"
            :key="task.id"
            type="button"
            class="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 border-b px-4 py-3 text-left transition-colors hover:bg-muted/50 md:grid-cols-[minmax(0,1.4fr)_120px_140px_120px]"
            @click="showBatchActions ? toggleTaskSelection(task.id) : router.push(`/import/video/${task.id}`)"
          >
            <div class="flex min-w-0 items-start gap-3">
              <input
                v-if="showBatchActions"
                type="checkbox"
                :checked="selectedTaskIds.has(task.id)"
                class="mt-1 h-4 w-4 shrink-0 rounded border-gray-300"
                @click.stop="toggleTaskSelection(task.id)"
              />
              <div class="min-w-0">
                <div class="truncate font-medium" :title="task.originalFilename">
                  {{ task.originalFilename }}
                </div>
                <div class="mt-1 text-xs text-muted-foreground">
                  <template v-if="task.isSeriesGroup">
                    整部剧
                    <template v-if="task.config?.episodeCount">
                      · {{ task.config.episodeCount }} 集
                    </template>
                    ·
                  </template>
                  {{ task.sourceKind === 'folder' ? '文件夹导入' : '单集导入' }}
                </div>
                <div
                  v-if="task.errorMessage"
                  class="mt-2 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                  :title="task.errorMessage"
                >
                  {{ friendlyErrorMessage(task.errorMessage) }}
                </div>
              </div>
            </div>

            <div class="hidden items-center md:flex">
              <Badge :variant="statusVariant(task.status)">
                {{ statusLabel(task.status) }}
              </Badge>
            </div>
            <div class="hidden items-center gap-2 md:flex">
              <Progress :model-value="task.progress" class="h-1.5" />
              <span class="w-9 text-right text-xs text-muted-foreground">{{ task.progress }}%</span>
            </div>
            <div class="hidden items-center text-xs text-muted-foreground md:flex">
              {{ formatDateRelative(task.updatedAt) }}
            </div>

            <div class="flex flex-col items-end gap-2 md:hidden">
              <Badge :variant="statusVariant(task.status)">
                {{ statusLabel(task.status) }}
              </Badge>
              <span class="text-xs text-muted-foreground">{{ task.progress }}%</span>
            </div>
          </button>

          <div
            v-if="tasks.length === 0"
            class="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"
          >
            <FileVideo class="h-14 w-14 opacity-20" />
            <div>
              <div class="text-base font-medium text-foreground">暂无转换任务</div>
              <div class="mt-1">选择视频或剧集文件夹开始转换</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </AppPageContent>
  </AppPage>
</template>
