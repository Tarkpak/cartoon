<script setup lang="ts">
import {
  FileVideo,
  RefreshCw,
  Upload,
  Wand2,
  Save,
  RotateCcw,
  Ban,
  FolderInput,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight
} from 'lucide-vue-next'
import { useVideoImport, type VideoImportConfig, type VideoImportRetryStep } from '@/composables/useVideoImport'

definePageMeta({
  layout: 'default'
})

const router = useRouter()
const {
  tasks,
  activeTask,
  loading,
  uploading,
  acting,
  error,
  fetchTasks,
  fetchTask,
  uploadVideo,
  updateSubtitle,
  generateScript,
  updateScript,
  importToProject,
  retryTask,
  cancelTask
} = useVideoImport()

const fileInputKey = ref(0)
const selectedFile = ref<File | null>(null)
const projectTitle = ref('')
const aspectRatio = ref<'16:9' | '9:16' | '1:1'>('9:16')
const scriptParseMode = ref<'short_drama' | 'premium_drama'>('short_drama')
const subtitleDraft = ref('')
const scriptDraft = ref('')
const sidebarCollapsed = ref(false)
let refreshTimer: number | null = null

const runningStatuses = new Set(['pending', 'extracting', 'transcribing', 'generating_script', 'importing'])

const hasRunningTasks = computed(() => tasks.value.some(task => runningStatuses.has(task.status)))
const selectedTask = computed(() => activeTask.value?.task || null)
const canEditSubtitle = computed(() => ['subtitle_ready', 'script_ready', 'failed'].includes(selectedTask.value?.status || ''))
const canGenerateScript = computed(() => !!selectedTask.value && ['subtitle_ready', 'script_ready', 'failed'].includes(selectedTask.value.status))
const canEditScript = computed(() => !!selectedTask.value && ['script_ready', 'failed'].includes(selectedTask.value.status))
const canImport = computed(() => !!selectedTask.value && ['script_ready', 'failed'].includes(selectedTask.value.status))
const canCancel = computed(() => !!selectedTask.value && runningStatuses.has(selectedTask.value.status))
const subtitleHasChanges = computed(() => subtitleDraft.value !== (activeTask.value?.subtitleText || ''))
const scriptHasChanges = computed(() => scriptDraft.value !== (activeTask.value?.scriptText || ''))
const showSubtitleNextStep = computed(() => canGenerateScript.value && selectedTask.value?.status === 'subtitle_ready')
const showScriptNextStep = computed(() => canImport.value && selectedTask.value?.status === 'script_ready')

watch(activeTask, (value) => {
  subtitleDraft.value = value?.subtitleText || ''
  scriptDraft.value = value?.scriptText || ''
})

watch(hasRunningTasks, (running) => {
  syncRefreshTimer(running)
})

onMounted(async () => {
  await fetchTasks()
  if (tasks.value[0]) {
    await fetchTask(tasks.value[0].id)
  }
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

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] || null
  if (!projectTitle.value && selectedFile.value) {
    projectTitle.value = selectedFile.value.name.replace(/\.[^.]+$/, '')
  }
}

async function handleUpload() {
  if (!selectedFile.value) return
  const config: VideoImportConfig = {
    projectTitle: projectTitle.value.trim() || undefined,
    aspectRatio: aspectRatio.value,
    scriptParseMode: scriptParseMode.value
  }
  await uploadVideo(selectedFile.value, config)
  selectedFile.value = null
  fileInputKey.value += 1
}

async function handleTaskSelect(taskId: string) {
  await fetchTask(taskId)
}

async function handleSaveSubtitle() {
  if (!selectedTask.value) return
  await updateSubtitle(selectedTask.value.id, subtitleDraft.value)
}

async function handleGenerateScript() {
  if (!selectedTask.value) return
  if (subtitleHasChanges.value) {
    await updateSubtitle(selectedTask.value.id, subtitleDraft.value)
  }
  await generateScript(selectedTask.value.id)
}

async function handleSaveScript() {
  if (!selectedTask.value) return
  await updateScript(selectedTask.value.id, scriptDraft.value)
}

async function handleImport() {
  if (!selectedTask.value) return
  if (scriptHasChanges.value) {
    await updateScript(selectedTask.value.id, scriptDraft.value)
  }
  const result = await importToProject(selectedTask.value.id)
  if (result?.redirectUrl) {
    await router.push(result.redirectUrl)
  }
}

async function handleRetry(step: VideoImportRetryStep) {
  if (!selectedTask.value) return
  await retryTask(selectedTask.value.id, step)
}

async function handleCancel() {
  if (!selectedTask.value) return
  await cancelTask(selectedTask.value.id)
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

function stepLabel(step: string) {
  const map: Record<string, string> = {
    created: '已创建',
    extract: '提取音频',
    transcribe: '识别字幕',
    subtitle_ready: '确认字幕',
    generate_script: '生成剧本',
    script_ready: '确认剧本',
    import: '创建项目',
    imported: '完成',
    retry: '重试中',
    processing: '处理中',
    cancelled: '已取消'
  }
  return map[step] || step
}

function getCurrentStepIndex(status: string): number {
  const steps = ['pending', 'extracting', 'transcribing', 'subtitle_ready', 'generating_script', 'script_ready', 'importing', 'imported']
  const index = steps.indexOf(status)
  return index >= 0 ? index : 0
}

function isStepActive(status: string, stepIndex: number): boolean {
  return getCurrentStepIndex(status) >= stepIndex
}

function statusVariant(status: string) {
  if (status === 'failed') return 'destructive'
  if (status === 'imported') return 'default'
  if (status === 'cancelled') return 'secondary'
  return 'outline'
}

function formatDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-4 md:p-6">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-normal">
          视频转项目
        </h1>
        <p class="text-sm text-muted-foreground">
          从现有视频中提取字幕和剧本，快速创建新项目
        </p>
      </div>
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
    </div>

    <div
      v-if="error"
      class="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle class="h-4 w-4 shrink-0" />
      {{ error }}
    </div>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)]">
      <div
        class="flex min-h-0 gap-4 transition-all"
        :class="sidebarCollapsed ? 'xl:grid-cols-[80px_minmax(0,1fr)]' : 'xl:grid-cols-[390px_minmax(0,1fr)]'"
        style="display: grid;"
      >
        <div class="flex min-h-0 flex-col gap-4">
          <Button
            variant="outline"
            size="sm"
            class="hidden gap-2 xl:flex"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <ChevronLeft v-if="!sidebarCollapsed" class="h-4 w-4" />
            <ChevronRight v-if="sidebarCollapsed" class="h-4 w-4" />
            <span v-if="!sidebarCollapsed">收起</span>
          </Button>

          <Card v-if="!sidebarCollapsed" class="shrink-0">
          <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-base">
              <Upload class="h-4 w-4" />
              上传视频
            </CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <Input
              :key="fileInputKey"
              type="file"
              accept="video/*"
              @change="handleFileChange"
            />
            <Input
              v-model="projectTitle"
              placeholder="项目标题（选填）"
            />
            <div class="grid grid-cols-2 gap-2">
              <Select v-model="aspectRatio">
                <SelectTrigger>
                  <SelectValue placeholder="画幅" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">
                    竖屏 9:16
                  </SelectItem>
                  <SelectItem value="16:9">
                    横屏 16:9
                  </SelectItem>
                  <SelectItem value="1:1">
                    方形 1:1
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="scriptParseMode">
                <SelectTrigger>
                  <SelectValue placeholder="剧本类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short_drama">
                    短剧
                  </SelectItem>
                  <SelectItem value="premium_drama">
                    精品剧
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              class="w-full gap-2"
              :disabled="!selectedFile || uploading"
              @click="handleUpload"
            >
              <Upload class="h-4 w-4" />
              {{ uploading ? '上传中...' : '开始转换' }}
            </Button>
          </CardContent>
        </Card>

        <Card v-if="!sidebarCollapsed" class="min-h-0 flex-1 overflow-hidden">
          <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-base">
              <FileVideo class="h-4 w-4" />
              转换历史
            </CardTitle>
          </CardHeader>
          <CardContent class="min-h-0 overflow-y-auto p-0">
            <button
              v-for="task in tasks"
              :key="task.id"
              type="button"
              class="w-full border-t px-4 py-3 text-left transition-colors hover:bg-muted/50"
              :class="activeTask?.task.id === task.id ? 'bg-muted' : ''"
              @click="handleTaskSelect(task.id)"
            >
              <div class="mb-2 flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium">
                    {{ task.originalFilename }}
                  </div>
                  <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{{ formatDate(task.updatedAt) }}</span>
                    <span>·</span>
                    <span>{{ stepLabel(task.currentStep) }}</span>
                  </div>
                </div>
                <Badge :variant="statusVariant(task.status)" class="shrink-0">
                  {{ statusLabel(task.status) }}
                </Badge>
              </div>
              <Progress :model-value="task.progress" class="h-1" />
              <div
                v-if="task.errorMessage"
                class="mt-2 line-clamp-2 text-xs text-destructive"
              >
                {{ task.errorMessage }}
              </div>
            </button>
            <div
              v-if="tasks.length === 0"
              class="px-4 py-10 text-center text-sm text-muted-foreground"
            >
              暂无转换记录
            </div>
          </CardContent>
        </Card>

        <Card v-if="sidebarCollapsed" class="flex min-h-0 flex-1 items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            class="flex h-auto flex-col gap-2 py-4"
            @click="sidebarCollapsed = false"
          >
            <FileVideo class="h-6 w-6" />
            <span class="text-xs">任务</span>
          </Button>
        </Card>
      </div>

      <Card class="min-h-0 overflow-hidden">
        <CardHeader class="border-b pb-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <CardTitle class="truncate text-lg">
                {{ selectedTask?.originalFilename || '选择任务查看详情' }}
              </CardTitle>
              <CardDescription v-if="selectedTask">
                {{ statusLabel(selectedTask.status) }}
                <template v-if="selectedTask.status !== 'imported' && selectedTask.status !== 'failed' && selectedTask.status !== 'cancelled'">
                  · {{ selectedTask.progress }}%
                </template>
              </CardDescription>
            </div>
            <div
              v-if="selectedTask"
              class="flex flex-wrap gap-2"
            >
              <Button
                v-if="canCancel"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleCancel"
              >
                <Ban class="h-4 w-4" />
                取消
              </Button>
              <Button
                v-if="selectedTask.status === 'failed' && ['extract', 'transcribe'].includes(selectedTask.currentStep)"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleRetry('transcribe')"
              >
                <RotateCcw class="h-4 w-4" />
                重新识别
              </Button>
              <Button
                v-if="selectedTask.status === 'failed' && selectedTask.currentStep === 'generate_script'"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleRetry('generate_script')"
              >
                <RotateCcw class="h-4 w-4" />
                重新生成剧本
              </Button>
              <Button
                v-if="selectedTask.status === 'failed' && selectedTask.currentStep === 'import'"
                variant="outline"
                size="sm"
                class="gap-2"
                :disabled="acting"
                @click="handleRetry('import')"
              >
                <RotateCcw class="h-4 w-4" />
                重新导入
              </Button>
            </div>
          </div>

          <div v-if="selectedTask && selectedTask.status !== 'cancelled'" class="mt-4 flex items-center gap-2">
            <div class="flex flex-1 items-center gap-2">
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors"
                  :class="getCurrentStepIndex(selectedTask.status) >= 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
                >
                  1
                </div>
                <span class="text-xs font-medium" :class="getCurrentStepIndex(selectedTask.status) >= 0 ? '' : 'text-muted-foreground'">识别字幕</span>
              </div>
              <div class="h-px flex-1 bg-border" :class="getCurrentStepIndex(selectedTask.status) >= 3 ? 'bg-primary' : ''" />
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors"
                  :class="getCurrentStepIndex(selectedTask.status) >= 4 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
                >
                  2
                </div>
                <span class="text-xs font-medium" :class="getCurrentStepIndex(selectedTask.status) >= 4 ? '' : 'text-muted-foreground'">生成剧本</span>
              </div>
              <div class="h-px flex-1 bg-border" :class="getCurrentStepIndex(selectedTask.status) >= 6 ? 'bg-primary' : ''" />
              <div class="flex items-center gap-2">
                <div
                  class="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors"
                  :class="getCurrentStepIndex(selectedTask.status) >= 7 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'"
                >
                  3
                </div>
                <span class="text-xs font-medium" :class="getCurrentStepIndex(selectedTask.status) >= 7 ? '' : 'text-muted-foreground'">创建项目</span>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent
          v-if="selectedTask"
          class="grid min-h-0 grid-cols-1 gap-4 overflow-hidden p-4 xl:grid-cols-2"
          :style="{ height: 'calc(100% - ' + (selectedTask.status === 'cancelled' ? '88px' : '160px') + ')' }"
        >
          <section class="flex min-h-0 flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 class="flex items-center gap-2 text-sm font-medium">
                <span>字幕内容</span>
                <Badge
                  v-if="selectedTask.status === 'subtitle_ready'"
                  variant="secondary"
                  class="text-xs"
                >
                  待确认
                </Badge>
              </h2>
              <div class="flex gap-2">
                <Button
                  v-if="subtitleHasChanges && canEditSubtitle"
                  variant="outline"
                  size="sm"
                  class="gap-2"
                  :disabled="acting"
                  @click="handleSaveSubtitle"
                >
                  <Save class="h-4 w-4" />
                  保存修改
                </Button>
                <Button
                  v-if="showSubtitleNextStep"
                  size="sm"
                  class="gap-2"
                  :disabled="acting || !subtitleDraft.trim()"
                  @click="handleGenerateScript"
                >
                  <Wand2 class="h-4 w-4" />
                  {{ subtitleHasChanges ? '保存并生成剧本' : '生成剧本' }}
                </Button>
              </div>
            </div>
            <Textarea
              v-model="subtitleDraft"
              class="min-h-0 flex-1 resize-none font-mono text-sm leading-6"
              :disabled="!canEditSubtitle"
              placeholder="识别完成后将显示字幕内容，你可以在此编辑修正"
            />
          </section>

          <section class="flex min-h-0 flex-col gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 class="flex items-center gap-2 text-sm font-medium">
                <span>剧本内容</span>
                <Badge
                  v-if="selectedTask.status === 'script_ready'"
                  variant="secondary"
                  class="text-xs"
                >
                  待确认
                </Badge>
              </h2>
              <div class="flex gap-2">
                <Button
                  v-if="scriptHasChanges && canEditScript"
                  variant="outline"
                  size="sm"
                  class="gap-2"
                  :disabled="acting"
                  @click="handleSaveScript"
                >
                  <Save class="h-4 w-4" />
                  保存修改
                </Button>
                <Button
                  v-if="showScriptNextStep"
                  size="sm"
                  class="gap-2"
                  :disabled="acting || !scriptDraft.trim()"
                  @click="handleImport"
                >
                  <FolderInput class="h-4 w-4" />
                  {{ scriptHasChanges ? '保存并创建项目' : '创建为项目' }}
                </Button>
              </div>
            </div>
            <Textarea
              v-model="scriptDraft"
              class="min-h-0 flex-1 resize-none font-mono text-sm leading-6"
              :disabled="!canEditScript"
              placeholder="从字幕生成的剧本将显示在这里，确认无误后即可创建项目"
            />
          </section>

          <div class="xl:col-span-2">
            <div
              v-if="selectedTask.status === 'imported'"
              class="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
            >
              <CheckCircle2 class="h-4 w-4 shrink-0" />
              <span>项目创建成功，你可以前往项目详情继续编辑</span>
            </div>
            <div
              v-else-if="selectedTask.errorMessage"
              class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle class="h-4 w-4 shrink-0 mt-0.5" />
              <span>{{ selectedTask.errorMessage }}</span>
            </div>
          </div>
        </CardContent>

        <CardContent
          v-else
          class="flex h-[420px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"
        >
          <FileVideo class="h-12 w-12 opacity-20" />
          <div>
            <div class="font-medium">暂未选择任务</div>
            <div class="mt-1">从左侧选择一个任务查看详情和进行编辑</div>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
