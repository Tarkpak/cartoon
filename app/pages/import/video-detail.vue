<script setup lang="ts">
import {
  ArrowLeft,
  FileVideo,
  FolderInput,
  Loader2,
  Pencil,
  Save,
  Trash2,
  Wand2
} from 'lucide-vue-next'
import { useVideoImport } from '@/composables/useVideoImport'
import { parseVideoImportRoleCandidates } from '~/lib/video-import-role-naming'
import {
  buildVideoImportStages,
  findEpisodeSectionOffset,
  hasMultipleEpisodeSections,
  isVideoImportRunning,
  resolveVideoImportActions,
  videoImportStatusLabel,
  videoImportStatusVariant
} from '~/lib/video-import-workflow'
import { normalizeScriptParseMode } from '#shared/types/script'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import VideoImportStepper from '@/components/video-import/VideoImportStepper.vue'
import VideoImportStatusBanner from '@/components/video-import/VideoImportStatusBanner.vue'
import VideoImportEpisodeList from '@/components/video-import/VideoImportEpisodeList.vue'
import VideoImportRunLog from '@/components/video-import/VideoImportRunLog.vue'
import VideoImportCreateProjectDialog, {
  type VideoImportCreateProjectOptions
} from '@/components/video-import/VideoImportCreateProjectDialog.vue'
import VideoImportRoleNamingDialog from '@/components/video-import/VideoImportRoleNamingDialog.vue'

definePageMeta({
  layout: 'default'
})

type ContentView = 'subtitle' | 'script' | 'logs'

const POLL_INTERVAL_MS = 2000

const router = useRouter()
const route = useRoute()
const { toast } = useToast()
const { confirm } = useConfirm()
const {
  activeTask,
  acting,
  error,
  fetchTask,
  updateSubtitle,
  generateScript,
  updateScript,
  importToProject,
  retryTask,
  cancelTask,
  deleteTask
} = useVideoImport()

const routeTaskId = computed(() => {
  const raw = route.params.id
  return typeof raw === 'string' ? raw.trim() : ''
})
const loadingTask = ref(true)
const loadError = ref<string | null>(null)
const contentView = ref<ContentView>('subtitle')
const subtitleDraft = ref('')
const scriptDraft = ref('')
const selectedEpisodeNumber = ref<number | null>(null)
const retryingEpisodeId = ref<string | null>(null)
const createProjectDialogOpen = ref(false)
const roleNamingDialogOpen = ref(false)
/** 用户在本页点了「创建项目」，完成后自动跳转到项目。 */
const awaitingImport = ref(false)
/** 删除任务后跳转时不再询问未保存修改。 */
const leavingAfterDelete = ref(false)

const task = computed(() => activeTask.value?.task || null)
const episodes = computed(() => activeTask.value?.episodes || [])
const isSeries = computed(() => !!task.value?.isSeriesGroup)
const isOriginExplainer = computed(() => normalizeScriptParseMode(task.value?.config?.scriptParseMode) === 'origin_explainer')
const scriptLabel = computed(() => isOriginExplainer.value ? '科普脚本' : '剧本')
const contentLabel = computed(() => isOriginExplainer.value ? '科普内容' : '剧情内容')
const actions = computed(() => resolveVideoImportActions(activeTask.value, scriptLabel.value))
const stages = computed(() => task.value ? buildVideoImportStages(task.value, scriptLabel.value) : [])
const subtitleHasChanges = computed(() => subtitleDraft.value !== (activeTask.value?.subtitleText || ''))
const scriptHasChanges = computed(() => scriptDraft.value !== (activeTask.value?.scriptText || ''))
const hasUnsavedChanges = computed(() => subtitleHasChanges.value || scriptHasChanges.value)
const hasScript = computed(() => !!activeTask.value?.scriptText?.trim())
const roleCandidateCount = computed(() => parseVideoImportRoleCandidates(scriptDraft.value).length)
const episodeStats = computed(() => {
  if (!isSeries.value) return null
  const list = episodes.value
  return {
    total: list.length,
    running: list.filter(episode => isVideoImportRunning(episode.status)).length,
    failed: list.filter(episode => episode.status === 'failed').length,
    ready: list.filter(episode => ['subtitle_ready', 'generating_script', 'script_ready', 'importing', 'imported'].includes(episode.status)).length
  }
})
const showEpisodeNav = computed(() => {
  if (!isSeries.value || contentView.value === 'logs') return false
  return contentView.value === 'subtitle' || hasMultipleEpisodeSections(scriptDraft.value)
})
const contentTabs = computed(() => [
  { value: 'subtitle' as const, label: '字幕', badge: task.value?.status === 'subtitle_ready' ? '待校对' : undefined },
  {
    value: 'script' as const,
    label: scriptLabel.value,
    badge: task.value?.status === 'script_ready' ? '待校对' : undefined,
    disabled: !hasScript.value && task.value?.status !== 'generating_script'
  },
  { value: 'logs' as const, label: '执行记录', badge: activeTask.value?.stepRuns?.length || undefined }
])
const editorLocked = computed(() => contentView.value === 'subtitle'
  ? !actions.value.canEditSubtitle
  : !actions.value.canEditScript)
const lockedReason = computed(() => {
  if (actions.value.running) return '处理中，完成后可编辑'
  if (task.value?.status === 'imported') return '项目已创建，请在资产工作台中继续修改'
  return ''
})

// ---- 数据同步 ----------------------------------------------------------

let lastServerSubtitle = ''
let lastServerScript = ''
let lastStatus = ''

watch(activeTask, (value, previous) => {
  if (!value) return
  const sameTask = previous?.task.id === value.task.id
  const nextSubtitle = value.subtitleText || ''
  const nextScript = value.scriptText || ''
  // 轮询刷新时不覆盖用户尚未保存的修改。
  if (!sameTask || subtitleDraft.value === lastServerSubtitle) subtitleDraft.value = nextSubtitle
  if (!sameTask || scriptDraft.value === lastServerScript) scriptDraft.value = nextScript
  lastServerSubtitle = nextSubtitle
  lastServerScript = nextScript

  const status = value.task.status
  if (!sameTask) {
    selectedEpisodeNumber.value = value.episodes?.[0]?.episodeNumber || null
    contentView.value = nextScript.trim() && ['script_ready', 'importing', 'imported'].includes(status) ? 'script' : 'subtitle'
  } else if (status !== lastStatus) {
    // 步骤推进时切到需要用户处理的内容。
    if (status === 'script_ready' && lastStatus === 'generating_script') contentView.value = 'script'
    if (status === 'imported' && awaitingImport.value && value.projectId) {
      awaitingImport.value = false
      void router.push(`/projects/${value.projectId}`)
    }
    if (status === 'failed' && awaitingImport.value) awaitingImport.value = false
  }
  lastStatus = status
})

async function loadTask(taskId: string) {
  loadingTask.value = true
  loadError.value = null
  try {
    await fetchTask(taskId)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '读取任务失败'
  } finally {
    loadingTask.value = false
  }
}

watch(routeTaskId, (taskId) => {
  if (!taskId) {
    void router.replace('/import/video')
    return
  }
  void loadTask(taskId)
}, { immediate: true })

let pollTimer: number | null = null
let polling = false

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = null
}

function syncPolling() {
  if (typeof window === 'undefined') return
  if (actions.value.running && !pollTimer) {
    pollTimer = window.setInterval(async () => {
      if (polling || !routeTaskId.value) return
      polling = true
      try {
        await fetchTask(routeTaskId.value)
      } catch {
        // 轮询失败时保持当前界面，下次再试。
      } finally {
        polling = false
      }
    }, POLL_INTERVAL_MS)
  } else if (!actions.value.running) {
    stopPolling()
  }
}

watch(() => actions.value.running, syncPolling)
onMounted(syncPolling)
onUnmounted(stopPolling)

onBeforeRouteLeave(async () => {
  if (leavingAfterDelete.value || !hasUnsavedChanges.value) return true
  return await confirm({
    title: '有未保存的修改',
    description: '离开后本次修改会丢失，确定离开吗？',
    confirmText: '离开',
    variant: 'destructive'
  })
})

// ---- 操作 --------------------------------------------------------------

function notifyError(err: unknown) {
  console.error(err)
  if (error.value) toast.error(error.value)
}

async function saveSubtitle() {
  if (!task.value || !subtitleHasChanges.value) return true
  try {
    const updated = await updateSubtitle(task.value.id, subtitleDraft.value)
    if (isSeries.value) {
      toast.success(updated > 0 ? `已保存 ${updated} 集字幕修改` : '没有检测到需要保存的分集修改')
    } else {
      toast.success('字幕已保存')
    }
    return true
  } catch (err) {
    notifyError(err)
    return false
  }
}

async function saveScript() {
  if (!task.value || !scriptHasChanges.value) return true
  try {
    await updateScript(task.value.id, scriptDraft.value)
    toast.success(`${scriptLabel.value}已保存`)
    return true
  } catch (err) {
    notifyError(err)
    return false
  }
}

async function handleGenerateScript() {
  if (!task.value) return
  if (hasScript.value) {
    const confirmed = await confirm({
      title: `重新生成${scriptLabel.value}`,
      description: scriptHasChanges.value
        ? `当前${scriptLabel.value}有未保存的修改，重新生成会覆盖它们。已保存的版本会保留在执行记录的产物文件中。`
        : `将根据最新字幕重新生成${isSeries.value ? '全部分集的' : ''}${scriptLabel.value}，当前版本会保留在产物文件中。`,
      confirmText: '重新生成'
    })
    if (!confirmed) return
    scriptDraft.value = activeTask.value?.scriptText || ''
  }
  if (!(await saveSubtitle())) return
  try {
    await generateScript(task.value.id, { force: true })
  } catch (err) {
    notifyError(err)
  }
}

async function openCreateProjectDialog() {
  if (!(await saveScript())) return
  createProjectDialogOpen.value = true
}

async function handleCreateProject(options: VideoImportCreateProjectOptions) {
  if (!task.value) return
  createProjectDialogOpen.value = false
  awaitingImport.value = true
  try {
    const result = await importToProject(task.value.id, {
      ...options,
      scriptParseMode: normalizeScriptParseMode(task.value.config?.scriptParseMode)
    })
    if (result?.status === 'imported' && result.projectId) {
      awaitingImport.value = false
      await router.push(`/projects/${result.projectId}`)
    }
  } catch (err) {
    awaitingImport.value = false
    notifyError(err)
  }
}

async function handleRecover() {
  const recovery = actions.value.recovery
  if (!task.value || !recovery) return
  if (recovery.step === 'import') awaitingImport.value = true
  try {
    await retryTask(task.value.id, recovery.step)
  } catch (err) {
    awaitingImport.value = false
    notifyError(err)
  }
}

async function handleRetryEpisode(episodeId: string) {
  if (!task.value || retryingEpisodeId.value) return
  retryingEpisodeId.value = episodeId
  try {
    await retryTask(episodeId, 'transcribe', task.value.id)
  } catch (err) {
    notifyError(err)
  } finally {
    retryingEpisodeId.value = null
  }
}

async function handleCancel() {
  if (!task.value) return
  const confirmed = await confirm({
    title: '取消任务',
    description: '会立即停止当前步骤，已完成的步骤结果都会保留，之后可以从中断处继续。',
    confirmText: '取消任务',
    variant: 'destructive'
  })
  if (!confirmed) return
  awaitingImport.value = false
  try {
    await cancelTask(task.value.id)
  } catch (err) {
    notifyError(err)
  }
}

async function handleDelete() {
  if (!task.value) return
  const confirmed = await confirm({
    title: '删除任务',
    description: `删除「${task.value.originalFilename}」及其字幕、剧本和中间文件，已创建的项目不受影响。此操作无法撤销。`,
    confirmText: '删除',
    variant: 'destructive'
  })
  if (!confirmed) return
  try {
    await deleteTask(task.value.id)
    leavingAfterDelete.value = true
    await router.push('/import/video')
  } catch (err) {
    notifyError(err)
  }
}

function openProject() {
  const projectId = activeTask.value?.projectId
  void router.push(projectId ? `/projects/${projectId}` : '/projects')
}

function locateEpisode(episodeNumber: number) {
  selectedEpisodeNumber.value = episodeNumber
  if (contentView.value === 'logs') contentView.value = 'subtitle'
  const text = contentView.value === 'script' ? scriptDraft.value : subtitleDraft.value
  const offset = findEpisodeSectionOffset(text, episodeNumber)
  if (offset < 0) return
  nextTick(() => {
    const editor = document.getElementById(`video-import-${contentView.value}-editor`) as HTMLTextAreaElement | null
    if (!editor) return
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 28
    const line = text.slice(0, offset).split('\n').length - 1
    editor.focus({ preventScroll: true })
    editor.setSelectionRange(offset, offset)
    editor.scrollTo({ top: Math.max(0, (line - 2) * lineHeight), behavior: 'smooth' })
  })
}
</script>

<template>
  <AppPage>
    <AppPageHeader compact>
      <div class="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          class="-ml-2 shrink-0 gap-2"
          @click="router.push('/import/video')"
        >
          <ArrowLeft class="h-4 w-4" />
          任务列表
        </Button>
        <h1 class="min-w-0 truncate text-xl font-semibold">
          {{ task?.originalFilename || '视频转项目' }}
        </h1>
        <span v-if="task" class="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {{ contentLabel }}<template v-if="episodeStats"> · {{ episodeStats.total }} 集</template>
        </span>
        <Badge v-if="task" :variant="videoImportStatusVariant(task.status)" class="shrink-0">
          {{ videoImportStatusLabel(task.status, scriptLabel) }}
        </Badge>
      </div>
      <template #actions>
        <Button
          v-if="task"
          v-tooltip="'删除任务'"
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="删除任务"
          :disabled="acting"
          @click="handleDelete"
        >
          <Trash2 class="h-4 w-4" />
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent inner-class="flex h-full min-h-0 flex-col gap-3">
      <div v-if="loadingTask && !task" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 class="mr-2 h-4 w-4 animate-spin" />
        加载任务中...
      </div>

      <EmptyState
        v-else-if="!task"
        :icon="FileVideo"
        title="任务不存在"
        :description="loadError || '任务可能已被删除。'"
        action-label="返回任务列表"
        class="flex-1"
        @action="router.push('/import/video')"
      />

      <template v-else>
        <section class="shrink-0 space-y-3 rounded-xl border bg-card px-4 py-3">
          <VideoImportStepper :stages="stages" />
          <VideoImportStatusBanner
            :task="task"
            :actions="actions"
            :script-label="scriptLabel"
            :script-outdated="activeTask?.scriptOutdated"
            :episode-stats="episodeStats"
            :acting="acting"
            @cancel="handleCancel"
            @recover="handleRecover"
            @open-project="openProject"
            @regenerate="handleGenerateScript"
          />
        </section>

        <section class="flex min-h-0 flex-1 overflow-hidden rounded-xl border bg-card">
          <VideoImportEpisodeList
            v-if="showEpisodeNav"
            class="hidden w-44 shrink-0 border-r bg-muted/10 lg:flex"
            :episodes="episodes"
            :selected-number="selectedEpisodeNumber"
            :retrying-id="retryingEpisodeId"
            :acting="acting"
            @select="locateEpisode"
            @retry="handleRetryEpisode"
          />

          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <div class="shrink-0 px-4">
              <SegmentedTabs
                v-model="contentView"
                :items="contentTabs"
                variant="underline"
                aria-label="任务内容"
              />
            </div>

            <div v-if="contentView === 'logs'" class="min-h-0 flex-1 overflow-y-auto p-4">
              <VideoImportRunLog
                :step-runs="activeTask?.stepRuns || []"
                :artifacts="activeTask?.artifacts || []"
              />
            </div>

            <template v-else>
              <div class="relative flex min-h-0 flex-1">
                <Textarea
                  v-show="contentView === 'subtitle'"
                  id="video-import-subtitle-editor"
                  v-model="subtitleDraft"
                  class="min-h-[24rem] w-full resize-none rounded-none border-0 bg-background px-6 py-5 text-base leading-7 shadow-none focus-visible:ring-0 md:px-10"
                  :readonly="!actions.canEditSubtitle"
                  :class="!actions.canEditSubtitle ? 'text-muted-foreground' : ''"
                  :placeholder="actions.running ? '正在识别字幕，完成后显示在这里…' : '暂无字幕'"
                  aria-label="字幕内容"
                />
                <Textarea
                  v-show="contentView === 'script'"
                  id="video-import-script-editor"
                  v-model="scriptDraft"
                  class="min-h-[24rem] w-full resize-none rounded-none border-0 bg-background px-6 py-5 text-base leading-7 shadow-none focus-visible:ring-0 md:px-10"
                  :readonly="!actions.canEditScript"
                  :class="!actions.canEditScript ? 'text-muted-foreground' : ''"
                  :placeholder="task.status === 'generating_script' ? `正在生成${scriptLabel}…` : `暂无${scriptLabel}`"
                  :aria-label="`${scriptLabel}内容`"
                />
              </div>

              <footer class="flex shrink-0 flex-col gap-2 border-t bg-background/95 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="text-xs text-muted-foreground">
                  <template v-if="editorLocked && lockedReason">{{ lockedReason }}</template>
                  <span v-else-if="contentView === 'subtitle' ? subtitleHasChanges : scriptHasChanges" class="font-medium text-warning">
                    有未保存的修改
                  </span>
                  <template v-else-if="contentView === 'subtitle' && isSeries">
                    保留每集开头的「## 第N集」标题行，保存时按集写回
                  </template>
                  <template v-else>所有修改已保存</template>
                </div>

                <div v-if="contentView === 'subtitle'" class="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-2"
                    :disabled="acting || !subtitleHasChanges || !actions.canEditSubtitle"
                    @click="saveSubtitle"
                  >
                    <Save class="h-4 w-4" />
                    保存
                  </Button>
                  <Button
                    v-if="actions.canGenerateScript"
                    size="sm"
                    class="gap-2"
                    :variant="hasScript && !activeTask?.scriptOutdated ? 'outline' : 'default'"
                    :disabled="acting || !subtitleDraft.trim()"
                    @click="handleGenerateScript"
                  >
                    <Wand2 class="h-4 w-4" />
                    {{ hasScript ? `重新生成${scriptLabel}` : `确认字幕，生成${scriptLabel}` }}
                  </Button>
                </div>

                <div v-else class="flex flex-wrap justify-end gap-2">
                  <Button
                    v-if="!isOriginExplainer && actions.canEditScript"
                    v-tooltip="roleCandidateCount === 0 ? '当前剧本没有检测到可命名的角色' : '批量填写角色真实名称'"
                    variant="outline"
                    size="sm"
                    class="gap-2"
                    :disabled="roleCandidateCount === 0"
                    @click="roleNamingDialogOpen = true"
                  >
                    <Pencil class="h-4 w-4" />
                    命名角色
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-2"
                    :disabled="acting || !scriptHasChanges || !actions.canEditScript"
                    @click="saveScript"
                  >
                    <Save class="h-4 w-4" />
                    保存
                  </Button>
                  <Button
                    v-if="actions.canCreateProject"
                    size="sm"
                    class="gap-2"
                    :disabled="acting || !scriptDraft.trim()"
                    @click="openCreateProjectDialog"
                  >
                    <FolderInput class="h-4 w-4" />
                    确认{{ scriptLabel }}，创建项目
                  </Button>
                </div>
              </footer>
            </template>
          </div>
        </section>
      </template>
    </AppPageContent>

    <VideoImportRoleNamingDialog
      v-model:open="roleNamingDialogOpen"
      :script="scriptDraft"
      @apply="scriptDraft = $event"
    />

    <VideoImportCreateProjectDialog
      v-if="task"
      v-model:open="createProjectDialogOpen"
      :default-title="String(task.config?.projectTitle || task.originalFilename.replace(/\.[^.]+$/, ''))"
      :default-aspect-ratio="String(task.config?.aspectRatio || '9:16')"
      :default-style-id="typeof task.config?.styleId === 'string' ? task.config.styleId : undefined"
      :is-origin-explainer="isOriginExplainer"
      :episode-count="episodeStats?.total"
      :submitting="acting"
      @confirm="handleCreateProject"
    />
  </AppPage>
</template>
