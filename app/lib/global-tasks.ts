import type { RouteLocationRaw } from 'vue-router'

/** Background jobs started from tools pages, merged into one list. */
export type GlobalTaskSource = 'video-enhance' | 'image-enhance' | 'subtitle-erasure' | 'video-import'
export type GlobalTaskStatus = 'running' | 'failed' | 'done'

export interface GlobalTask {
  key: string
  source: GlobalTaskSource
  sourceLabel: string
  title: string
  detail?: string
  status: GlobalTaskStatus
  /** 0-100 when the provider reports it. */
  progress?: number
  updatedAt: string
  to: RouteLocationRaw
}

export const GLOBAL_TASK_SOURCE_LABEL: Record<GlobalTaskSource, string> = {
  'video-enhance': '视频增强',
  'image-enhance': '图片增强',
  'subtitle-erasure': '字幕擦除',
  'video-import': '视频转项目'
}

interface EnhanceTaskLike {
  taskId: string
  fileName: string
  kindLabel?: string
  status: string
  progress?: number | null
  errorMessage?: string | null
  createdAt?: string
  updatedAt?: string
}

interface VideoImportTaskLike {
  id: string
  originalFilename: string
  status: string
  currentStep?: string
  progress?: number
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
  isSeriesGroup?: boolean
  seriesId?: string | null
}

const VIDEO_IMPORT_RUNNING = new Set(['pending', 'extracting', 'transcribing', 'generating_script', 'importing'])
const VIDEO_IMPORT_FAILED = new Set(['failed', 'cancelled'])

function normalizeProgress(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  // Backends store progress as an integer percentage.
  return Math.min(Math.max(Math.round(value), 0), 100)
}

function normalizeEnhanceStatus(status: string): GlobalTaskStatus | null {
  if (status === 'processing') return 'running'
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'done'
  return null
}

export function normalizeEnhanceTasks(
  source: 'video-enhance' | 'image-enhance' | 'subtitle-erasure',
  tasks: EnhanceTaskLike[]
): GlobalTask[] {
  const type = source === 'video-enhance' ? 'video' : source === 'image-enhance' ? 'image' : 'subtitle-erasure'
  return tasks.flatMap((task) => {
    const status = normalizeEnhanceStatus(task.status)
    if (!status) return []
    return [{
      key: `${source}:${task.taskId}`,
      source,
      sourceLabel: GLOBAL_TASK_SOURCE_LABEL[source],
      title: task.fileName || task.taskId,
      detail: status === 'failed' ? (task.errorMessage || undefined) : (task.kindLabel || undefined),
      status,
      progress: status === 'running' ? normalizeProgress(task.progress) : undefined,
      updatedAt: task.updatedAt || task.createdAt || '',
      to: { path: '/tools/enhance', query: { type, view: 'tasks', taskId: task.taskId } }
    }]
  })
}

export function normalizeVideoImportTasks(tasks: VideoImportTaskLike[]): GlobalTask[] {
  return tasks.flatMap((task) => {
    // Episodes of a series are reported through their group row.
    if (task.seriesId && !task.isSeriesGroup) return []
    const status: GlobalTaskStatus | null = VIDEO_IMPORT_RUNNING.has(task.status)
      ? 'running'
      : VIDEO_IMPORT_FAILED.has(task.status)
        ? 'failed'
        : task.status === 'imported' ? 'done' : null
    if (!status) return []
    return [{
      key: `video-import:${task.id}`,
      source: 'video-import' as const,
      sourceLabel: GLOBAL_TASK_SOURCE_LABEL['video-import'],
      title: task.originalFilename || task.id,
      detail: status === 'failed' ? (task.errorMessage || undefined) : undefined,
      status,
      progress: status === 'running' ? normalizeProgress(task.progress) : undefined,
      updatedAt: task.updatedAt || task.createdAt,
      to: `/import/video/${task.id}`
    }]
  })
}

const STATUS_ORDER: Record<GlobalTaskStatus, number> = { running: 0, failed: 1, done: 2 }

/** Running first, then failures, then recent completions; newest first within each. */
export function sortGlobalTasks(tasks: GlobalTask[]): GlobalTask[] {
  return [...tasks].sort((a, b) => (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0')
  ))
}

export function summarizeGlobalTasks(tasks: GlobalTask[]) {
  return {
    running: tasks.filter(task => task.status === 'running').length,
    failed: tasks.filter(task => task.status === 'failed').length,
    done: tasks.filter(task => task.status === 'done').length
  }
}
