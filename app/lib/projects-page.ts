import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'
import { VIDEO_WORKFLOW_PRESETS } from '#shared/types/video-workflow'
import type { ProjectAccess } from '#shared/types/project'

export type ProjectStatusFilter = 'all' | 'in_progress' | 'completed' | 'draft'
export type ProjectSortBy = 'updated' | 'created' | 'name'
export type ProjectAspectRatio = '16:9' | '9:16' | '1:1'

export interface Project {
  id: string
  title: string
  description: string | null
  scriptParseMode?: ScriptParseMode
  styleId: string
  aspectRatio: string
  status: string | null
  totalScenes: number
  /** Scenes whose video is generated. */
  completedScenes?: number
  totalDuration?: number
  /** First scene frame, or the first character image when no frame exists yet. */
  coverImage?: string | null
  createdAt: string
  updatedAt: string
  collaboration?: boolean
  cloudSyncStatus?: 'pending' | 'synced' | 'conflict' | 'legacy'
  cloudSyncError?: string | null
  ownerAccount?: string | null
  ownerDisplayName?: string | null
  ownerUserId?: string | null
  access?: ProjectAccess
  projectType?: 'video' | 'script_writing' | string
}

export interface ProjectListResponse {
  success: boolean
  projects: Project[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface ProjectDraft {
  title: string
  description: string
  scriptParseMode: ScriptParseMode
  styleId: string
  aspectRatio: ProjectAspectRatio
  idea: string
  genre: string
  customGenre: string
  audience: string
  customAudience: string
  episodeCount: number
  episodeDuration: number
  requirements: string
}

export const projectPageSizeOptions = [12, 24, 48]

export function projectLastOpenedStorageKey(userId?: string | null): string | null {
  const normalizedUserId = userId?.trim()
  return normalizedUserId ? `playlet:last-project-id:${normalizedUserId}` : null
}

export const projectAspectRatioOptions = [
  { value: '16:9', label: '16:9 横屏', description: '适合电脑/电视' },
  { value: '9:16', label: '9:16 竖屏', description: '适合手机/短视频' },
  { value: '1:1', label: '1:1 方形', description: '适合社交媒体' }
] as const

export const projectScriptParseModeOptions = VIDEO_WORKFLOW_PRESETS.map(preset => ({
  value: preset.id,
  label: preset.name,
  description: preset.description
})) satisfies ReadonlyArray<{
  value: ScriptParseMode
  label: string
  description: string
}>

export const projectStatusMap: Record<
  string,
  { label: string, variant: 'default' | 'secondary' | 'success' | 'warning' }
> = {
  in_progress: { label: '进行中', variant: 'success' },
  draft: { label: '草稿', variant: 'warning' },
  completed: { label: '已完成', variant: 'secondary' }
}

export function createProjectDraft(styleId = ''): ProjectDraft {
  return {
    title: '',
    description: '',
    scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE,
    styleId,
    aspectRatio: '9:16',
    idea: '',
    genre: '现代甜宠·都市情感',
    customGenre: '',
    audience: '短视频用户',
    customAudience: '',
    episodeCount: 8,
    episodeDuration: 90,
    requirements: ''
  }
}

export function resolveProjectCreateStyleId(options: {
  currentStyleId?: string
  defaultStyleId?: string
  availableStyleIds: string[]
  preferDefault?: boolean
}): string {
  const availableIds = new Set(options.availableStyleIds.filter(Boolean))
  if (availableIds.size === 0) return ''

  if (
    options.preferDefault
    && options.defaultStyleId
    && availableIds.has(options.defaultStyleId)
  ) {
    return options.defaultStyleId
  }

  if (options.currentStyleId && availableIds.has(options.currentStyleId)) {
    return options.currentStyleId
  }

  if (options.defaultStyleId && availableIds.has(options.defaultStyleId)) {
    return options.defaultStyleId
  }

  return options.availableStyleIds[0] || ''
}

export function hasProjectStyle(styleId: string, availableStyleIds: string[]): boolean {
  if (!styleId) return false
  return availableStyleIds.includes(styleId)
}

export function formatProjectRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 1) return '刚刚'
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return date.toLocaleDateString()
}

export function formatProjectDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return '--'

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}`
}

export interface ProjectProgress {
  done: number
  total: number
  /** 0-100, for a progress bar. */
  percent: number
  label: string
}

export function resolveProjectProgress(project: Pick<Project, 'totalScenes' | 'completedScenes'>): ProjectProgress {
  const total = Math.max(0, Number(project.totalScenes) || 0)
  const done = Math.min(total, Math.max(0, Number(project.completedScenes) || 0))
  if (total === 0) return { done: 0, total: 0, percent: 0, label: '尚未解析剧本' }
  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
    label: done === total ? `已全部出片 · ${total} 个场景` : `已出片 ${done} / ${total}`
  }
}

export const PROJECT_VIEW_MODE_STORAGE_KEY = 'playlet:projects-view-mode'
export type ProjectViewMode = 'grid' | 'list'
