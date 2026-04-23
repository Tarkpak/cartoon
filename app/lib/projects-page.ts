import type { ProjectWorkflowType } from '#shared/types/project'
import {
  DEFAULT_SCRIPT_PARSE_MODE,
  type ScriptParseMode
} from '#shared/types/script'

export type ProjectStatusFilter = 'all' | 'in_progress' | 'completed' | 'draft'
export type ProjectSortBy = 'updated' | 'created' | 'name'
export type ProjectAspectRatio = '16:9' | '9:16' | '1:1'

export interface Project {
  id: string
  title: string
  description: string | null
  workflowType?: ProjectWorkflowType
  scriptParseMode?: ScriptParseMode
  styleId: string
  aspectRatio: string
  status: string | null
  totalScenes: number
  createdAt: string
  updatedAt: string
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
  workflowType: ProjectWorkflowType
  scriptParseMode: ScriptParseMode
  styleId: string
  aspectRatio: ProjectAspectRatio
}

export const projectPageSizeOptions = [10, 20, 50]

export const projectAspectRatioOptions = [
  { value: '16:9', label: '16:9 横屏', description: '适合电脑/电视' },
  { value: '9:16', label: '9:16 竖屏', description: '适合手机/短视频' },
  { value: '1:1', label: '1:1 方形', description: '适合社交媒体' }
] as const

export const projectScriptParseModeOptions = [
  { value: 'short_drama', label: '短剧', description: '短剧强节奏结构，优先钩子、暴击与反击预告。' },
  { value: 'premium_drama', label: '精品剧', description: '忠实还原原文，按剧情密度自然拆场。' }
] as const satisfies ReadonlyArray<{
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
    workflowType: 'asset_consistency',
    scriptParseMode: DEFAULT_SCRIPT_PARSE_MODE,
    styleId,
    aspectRatio: '9:16'
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
