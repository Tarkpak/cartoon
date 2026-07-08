export interface AppLogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  category: string
  message: string
  requestId?: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  metadata?: unknown
  error?: unknown
}

export const APP_LOG_LEVEL_OPTIONS = ['debug', 'info', 'warn', 'error']
export const APP_LOG_SOURCE_OPTIONS = ['backend', 'frontend']
export const APP_LOG_ALL_FILTER_VALUE = '__all__'

export function useAppLogs() {
  const logs = ref<AppLogEntry[]>([])
  const activeLogId = ref('')
  const loading = ref(false)
  const clearing = ref(false)
  const fetchError = ref('')
  const autoRefresh = ref(true)
  const total = ref(0)
  const page = ref(1)

  const filters = reactive({
    level: '',
    source: '',
    category: '',
    path: '',
    requestId: '',
    status: '',
    keyword: '',
    modelOnly: false,
    limit: 200
  })

  const activeLog = computed(() => logs.value.find(item => item.id === activeLogId.value) || null)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, filters.limit))))
  const pageStart = computed(() => total.value === 0 ? 0 : (page.value - 1) * filters.limit + 1)
  const pageEnd = computed(() => Math.min(total.value, page.value * filters.limit))

  let refreshTimer: ReturnType<typeof setInterval> | null = null

  function formatDate(value: string): string {
    return new Date(value).toLocaleString()
  }

  function formatDuration(value?: number): string {
    if (value === undefined || !Number.isFinite(value)) return '-'
    if (value < 1000) return `${value}ms`
    return `${(value / 1000).toFixed(2)}s`
  }

  function toPrettyJson(value: unknown): string {
    if (value === undefined || value === null) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  function buildQuery() {
    return {
      limit: filters.limit,
      offset: (page.value - 1) * filters.limit,
      level: filters.level || undefined,
      source: filters.source || undefined,
      category: filters.category || undefined,
      path: filters.path || undefined,
      requestId: filters.requestId || undefined,
      status: filters.status || undefined,
      keyword: filters.keyword || undefined,
      modelOnly: filters.modelOnly ? '1' : undefined
    }
  }

  async function fetchLogs() {
    loading.value = true
    fetchError.value = ''
    try {
      const response = await $fetch<{
        success: boolean
        data: {
          logs: AppLogEntry[]
          total: number
        }
      }>('/api/debug/app-logs', {
        query: buildQuery()
      })

      logs.value = response.data.logs || []
      total.value = Number.isFinite(response.data.total) ? response.data.total : logs.value.length
      if (page.value > totalPages.value) {
        page.value = totalPages.value
        await fetchLogs()
        return
      }
      if (activeLogId.value && !logs.value.some(item => item.id === activeLogId.value)) {
        activeLogId.value = ''
      }
    } catch (error) {
      fetchError.value = error instanceof Error ? error.message : '日志加载失败'
    } finally {
      loading.value = false
    }
  }

  async function clearLogs() {
    const confirmed = await useConfirm().confirm({
      title: '清空系统日志',
      description: '确定要清空所有系统日志吗？模型调用日志不会被清空。',
      confirmText: '清空',
      variant: 'destructive'
    })
    if (!confirmed) return
    clearing.value = true
    try {
      await $fetch('/api/debug/app-logs', { method: 'DELETE' })
      logs.value = []
      total.value = 0
      page.value = 1
      activeLogId.value = ''
    } catch (error) {
      fetchError.value = error instanceof Error ? error.message : '清空日志失败'
    } finally {
      clearing.value = false
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }

    if (!autoRefresh.value) return
    refreshTimer = setInterval(() => {
      fetchLogs()
    }, 5000)
  }

  async function goToPage(nextPage: number) {
    const normalized = Math.min(Math.max(1, nextPage), totalPages.value)
    if (normalized === page.value) return
    page.value = normalized
    await fetchLogs()
  }

  async function previousPage() {
    await goToPage(page.value - 1)
  }

  async function nextPage() {
    await goToPage(page.value + 1)
  }

  watch(
    () => [
      filters.level,
      filters.source,
      filters.category,
      filters.path,
      filters.requestId,
      filters.status,
      filters.keyword,
      filters.modelOnly,
      filters.limit
    ],
    () => {
      page.value = 1
    }
  )

  watch(autoRefresh, () => {
    startAutoRefresh()
  })

  onMounted(async () => {
    await fetchLogs()
    startAutoRefresh()
  })

  onBeforeUnmount(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  })

  return {
    logs,
    activeLogId,
    activeLog,
    loading,
    clearing,
    fetchError,
    autoRefresh,
    total,
    page,
    totalPages,
    pageStart,
    pageEnd,
    filters,
    levelOptions: APP_LOG_LEVEL_OPTIONS,
    sourceOptions: APP_LOG_SOURCE_OPTIONS,
    allFilterValue: APP_LOG_ALL_FILTER_VALUE,
    formatDate,
    formatDuration,
    toPrettyJson,
    fetchLogs,
    previousPage,
    nextPage,
    clearLogs
  }
}
