import { computed, ref } from 'vue'
import type { ScriptParseMode } from '#shared/types/script'

export interface VideoImportTask {
  id: string
  originalFilename: string
  sourceKind: string
  sourcePath: string
  status: string
  currentStep: string
  progress: number
  errorMessage?: string | null
  asrProvider: string
  scriptModelId?: string | null
  config?: Record<string, unknown>
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  seriesId?: string | null
  episodeNumber?: number | null
  isSeriesGroup?: boolean
}

export interface VideoImportArtifact {
  id: string
  taskId: string
  kind: string
  path: string
  mimeType?: string | null
  sizeBytes?: number | null
  sha256?: string | null
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface VideoImportStepRun {
  id: string
  taskId: string
  step: string
  attempt: number
  status: string
  startedAt: string
  endedAt?: string | null
  durationMs?: number | null
  provider?: string | null
  externalTaskId?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export interface VideoImportTaskDetail {
  task: VideoImportTask
  artifacts: VideoImportArtifact[]
  stepRuns: VideoImportStepRun[]
  episodes?: VideoImportTask[]
  subtitleText?: string | null
  scriptText?: string | null
  parseResult?: unknown
}

export interface VideoImportSeriesPreviewFile {
  episodeNumber: number
  filename: string
  path: string
  sizeBytes: number
  durationSeconds?: number | null
}

export interface VideoImportSeriesPreview {
  folderPath: string
  episodeCount: number
  seriesImportMode?: 'episodes' | 'short_clips'
  shortClipRecommended?: boolean
  durationSummary?: {
    knownCount?: number
    shortCount?: number
    totalSeconds?: number
    averageSeconds?: number | null
    shortClipRecommended?: boolean
  }
  files: VideoImportSeriesPreviewFile[]
}

export interface VideoImportConfig {
  projectTitle?: string
  styleId?: string
  aspectRatio?: '16:9' | '9:16' | '1:1'
  scriptParseMode?: ScriptParseMode
}

export type VideoImportRetryStep = 'extract' | 'transcribe' | 'generate_script' | 'import'

export function useVideoImport() {
  const tasks = ref<VideoImportTask[]>([])
  const activeTask = ref<VideoImportTaskDetail | null>(null)
  const loading = ref(false)
  const uploading = ref(false)
  const acting = ref(false)
  const error = ref<string | null>(null)

  const activeTaskId = computed(() => activeTask.value?.task.id || null)

  async function fetchTasks() {
    loading.value = true
    error.value = null
    try {
      const response = await $fetch<{
        success: boolean
        data?: { tasks: VideoImportTask[] }
        message?: string
      }>('/api/import/video/tasks')
      tasks.value = response.data?.tasks || []
      if (activeTaskId.value) {
        const stillExists = tasks.value.some(task => task.id === activeTaskId.value)
        if (stillExists) await fetchTask(activeTaskId.value)
      }
    } catch (err) {
      error.value = getVideoImportErrorMessage(err)
    } finally {
      loading.value = false
    }
  }

  async function fetchTask(taskId: string) {
    const response = await $fetch<{
      success: boolean
      data?: VideoImportTaskDetail
      message?: string
    }>(`/api/import/video/tasks/${taskId}`)
    if (!response.success || !response.data) {
      throw new Error(response.message || '读取任务失败')
    }
    activeTask.value = response.data
    const index = tasks.value.findIndex(task => task.id === response.data?.task.id)
    if (index >= 0) tasks.value[index] = response.data.task
    return response.data
  }

  async function uploadVideo(file: File, config: VideoImportConfig) {
    uploading.value = true
    error.value = null
    try {
      const formData = new FormData()
      formData.append('video', file)
      formData.append('config', JSON.stringify(config))
      const response = await $fetch<{
        success: boolean
        data?: { taskId: string }
        message?: string
      }>('/api/import/video/upload', {
        method: 'POST',
        body: formData
      })
      if (!response.success || !response.data?.taskId) {
        throw new Error(response.message || '上传失败')
      }
      await fetchTasks()
      await fetchTask(response.data.taskId)
      return response.data.taskId
    } catch (err) {
      error.value = getVideoImportErrorMessage(err)
      throw err
    } finally {
      uploading.value = false
    }
  }

  async function uploadSeriesFolder(folderPath: string, config: VideoImportConfig) {
    uploading.value = true
    error.value = null
    try {
      const response = await $fetch<{
        success: boolean
        data?: { seriesId: string, episodeIds: string[], episodeCount: number }
        message?: string
      }>('/api/import/video/upload-series', {
        method: 'POST',
        body: {
          folderPath,
          config
        }
      })
      if (!response.success || !response.data?.seriesId) {
        throw new Error(response.message || '上传失败')
      }
      await fetchTasks()
      await fetchTask(response.data.seriesId)
      return response.data
    } catch (err) {
      error.value = getVideoImportErrorMessage(err)
      throw err
    } finally {
      uploading.value = false
    }
  }

  async function previewSeriesFolder(folderPath: string) {
    error.value = null
    try {
      const response = await $fetch<{
        success: boolean
        data?: VideoImportSeriesPreview
        message?: string
      }>('/api/import/video/preview-series', {
        method: 'POST',
        body: { folderPath }
      })
      if (!response.success || !response.data) {
        throw new Error(response.message || '读取剧集文件夹失败')
      }
      return response.data
    } catch (err) {
      error.value = getVideoImportErrorMessage(err)
      throw err
    }
  }

  async function updateSubtitle(taskId: string, text: string) {
    await runAction(async () => {
      await $fetch(`/api/import/video/tasks/${taskId}/subtitle`, {
        method: 'PUT',
        body: { text }
      })
      await fetchTask(taskId)
    })
  }

  async function generateScript(taskId: string) {
    await runAction(async () => {
      await $fetch(`/api/import/video/tasks/${taskId}/generate-script`, {
        method: 'POST'
      })
      await fetchTask(taskId)
      await fetchTasks()
    })
  }

  async function updateScript(taskId: string, script: string) {
    await runAction(async () => {
      await $fetch(`/api/import/video/tasks/${taskId}/script`, {
        method: 'PUT',
        body: { script }
      })
      await fetchTask(taskId)
    })
  }

  async function importToProject(taskId: string, config?: {
    projectTitle?: string
    aspectRatio?: '16:9' | '9:16' | '1:1'
    scriptParseMode?: ScriptParseMode
  }) {
    return await runAction(async () => {
      const response = await $fetch<{
        success: boolean
        data?: { projectId: string, redirectUrl: string }
        message?: string
      }>(`/api/import/video/tasks/${taskId}/import`, {
        method: 'POST',
        body: config || undefined
      })
      if (!response.success || !response.data?.projectId) {
        throw new Error(response.message || '导入项目失败')
      }
      await fetchTask(taskId)
      await fetchTasks()
      return response.data
    })
  }

  async function retryTask(taskId: string, fromStep: VideoImportRetryStep) {
    await runAction(async () => {
      await $fetch(`/api/import/video/tasks/${taskId}/retry`, {
        method: 'POST',
        body: { fromStep }
      })
      await fetchTask(taskId)
      await fetchTasks()
    })
  }

  async function cancelTask(taskId: string) {
    await runAction(async () => {
      await $fetch(`/api/import/video/tasks/${taskId}/cancel`, {
        method: 'POST'
      })
      await fetchTask(taskId)
      await fetchTasks()
    })
  }

  async function deleteTask(taskId: string) {
    await runAction(async () => {
      await $fetch(`/api/import/video/tasks/${taskId}`, {
        method: 'DELETE'
      })
      if (activeTaskId.value === taskId) {
        activeTask.value = null
      }
      await fetchTasks()
    })
  }

  async function deleteTasks(taskIds: string[]) {
    await runAction(async () => {
      const response = await $fetch<{
        success: boolean
        data?: { deletedCount: number }
        message?: string
      }>('/api/import/video/tasks/batch-delete', {
        method: 'POST',
        body: { taskIds }
      })
      if (taskIds.includes(activeTaskId.value || '')) {
        activeTask.value = null
      }
      await fetchTasks()
      return response.data
    })
  }

  async function runAction<T>(action: () => Promise<T>): Promise<T> {
    acting.value = true
    error.value = null
    try {
      return await action()
    } catch (err) {
      error.value = getVideoImportErrorMessage(err)
      throw err
    } finally {
      acting.value = false
    }
  }

  return {
    tasks,
    activeTask,
    activeTaskId,
    loading,
    uploading,
    acting,
    error,
    fetchTasks,
    fetchTask,
    uploadVideo,
    uploadSeriesFolder,
    previewSeriesFolder,
    updateSubtitle,
    generateScript,
    updateScript,
    importToProject,
    retryTask,
    cancelTask,
    deleteTask,
    deleteTasks
  }
}

function getVideoImportErrorMessage(error: unknown): string {
  const raw = getRawVideoImportErrorMessage(error)
  if (/FOREIGN KEY constraint failed/i.test(raw)) {
    return '创建转换任务失败，任务数据关联异常。请重试；如果仍失败，请删除失败记录后再导入。'
  }
  if (/路径必须是文件夹|folderPath is required|文件夹中没有找到视频文件|读取文件夹失败|复制视频文件失败|不支持的视频格式/.test(raw)) {
    return raw
  }
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(raw)) {
    return '连接本地转换服务失败，请确认后端或桌面端正在运行。'
  }
  if (/permission denied|denied|operation not permitted/i.test(raw)) {
    return '无法访问所选文件或文件夹，请检查系统权限后重试。'
  }
  return raw || '操作失败'
}

function getRawVideoImportErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = (error as { data?: { message?: string, statusMessage?: string } }).data
    if (data?.message) return data.message
    if (data?.statusMessage) return data.statusMessage
  }
  if (error instanceof Error && error.message) return error.message
  return '操作失败'
}
