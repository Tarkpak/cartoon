export interface ModelDebugErrorInfo {
  name?: string
  message: string
  stack?: string
}

export interface ModelDebugMediaRef {
  id: string
  direction: 'request' | 'response'
  path: string
  mediaType: 'image' | 'audio' | 'video' | 'binary'
  mimeType?: string
  originalLength: number
  url?: string
  status: 'ready' | 'failed' | 'skipped'
  note?: string
}

export interface ModelDebugLogEntry {
  id: string
  timestamp: string
  provider: string
  model: string
  operation: string
  status: 'success' | 'error'
  durationMs: number
  endpoint?: string
  requestId?: string
  projectId?: string
  sceneId?: string
  taskId?: string
  request?: unknown
  requestRaw?: unknown
  response?: unknown
  responseRaw?: unknown
  mediaRefs?: ModelDebugMediaRef[]
  error?: ModelDebugErrorInfo
  ownerAccount?: string
  ownerDisplayName?: string
}

export const MODEL_DEBUG_PROVIDER_OPTIONS = ['gemini', 'qwen', 'kling', 'volcengine', 'deepseek', 'custom_openai']

export const MODEL_DEBUG_OPERATION_OPTIONS = [
  'generateText',
  'generateJSON',
  'generateImage',
  'generateVideo',
  'textToSpeech',
  'speechToText'
]

export const MODEL_DEBUG_ALL_FILTER_VALUE = '__all__'

export function useModelDebugLogs() {
  const { bootstrap, currentUser, loadStatus } = useCloudAdmin()
  const logs = ref<ModelDebugLogEntry[]>([])
  const activeLogId = ref('')
  const detailOpen = ref(false)
  const loading = ref(false)
  const clearing = ref(false)
  const fetchError = ref('')
  const autoRefresh = ref(true)
  const total = ref(0)
  const page = ref(1)

  const filters = reactive({
    provider: '',
    operation: '',
    status: '',
    model: '',
    requestId: '',
    projectId: '',
    sceneId: '',
    taskId: '',
    keyword: '',
    limit: 100
  })

  const activeLog = computed(() => logs.value.find(item => item.id === activeLogId.value) || null)
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / Math.max(1, filters.limit))))
  const pageStart = computed(() => total.value === 0 ? 0 : (page.value - 1) * filters.limit + 1)
  const pageEnd = computed(() => Math.min(total.value, page.value * filters.limit))

  let refreshTimer: ReturnType<typeof setInterval> | null = null

  function openLogDetail(item: ModelDebugLogEntry) {
    activeLogId.value = item.id
    detailOpen.value = true
  }

  function formatDate(value: string): string {
    return new Date(value).toLocaleString()
  }

  function formatDuration(value: number): string {
    if (!Number.isFinite(value)) return '-'
    if (value < 1000) return `${value}ms`
    return `${(value / 1000).toFixed(2)}s`
  }

  function toPrettyJson(value: unknown): string {
    if (value === undefined) return ''
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  function toReadableText(value: unknown, depth = 0): string {
    if (value === undefined) return ''
    if (value === null) return 'null'

    if (typeof value === 'string') {
      if (!value.includes('\n')) return value
      const pad = '  '.repeat(depth)
      const block = value.split('\n').map(line => `${pad}  ${line}`).join('\n')
      return `|\n${block}`
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      const pad = '  '.repeat(depth)
      const nextDepth = depth + 1
      return value.map((item) => {
        const rendered = toReadableText(item, nextDepth)
        const isComplex = typeof item === 'object' && item !== null
        if (isComplex && !rendered.startsWith('|')) {
          return `${pad}-\n${rendered}`
        }
        return `${pad}- ${rendered}`
      }).join('\n')
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) return '{}'

      const pad = '  '.repeat(depth)
      const nextDepth = depth + 1
      const childPad = '  '.repeat(nextDepth)

      return entries.map(([key, item]) => {
        const rendered = toReadableText(item, nextDepth)
        const isComplex = typeof item === 'object' && item !== null
        if (isComplex && !rendered.startsWith('|')) {
          return `${pad}${key}:\n${rendered}`
        }
        if (rendered.startsWith('|\n')) {
          const lines = rendered.split('\n')
          const head = `${pad}${key}: ${lines[0]}`
          const body = lines.slice(1).map(line => `${childPad}${line.trimStart()}`).join('\n')
          return `${head}\n${body}`
        }
        return `${pad}${key}: ${rendered}`
      }).join('\n')
    }

    return String(value)
  }

  function toSelectString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function buildQuery() {
    return {
      limit: filters.limit,
      offset: (page.value - 1) * filters.limit,
      provider: filters.provider || undefined,
      operation: filters.operation || undefined,
      status: filters.status || undefined,
      model: filters.model || undefined,
      requestId: filters.requestId || undefined,
      projectId: filters.projectId || undefined,
      sceneId: filters.sceneId || undefined,
      taskId: filters.taskId || undefined,
      keyword: filters.keyword || undefined
    }
  }

  async function fetchLogs() {
    loading.value = true
    fetchError.value = ''
    try {
      const response = await $fetch<{
        success: boolean
        data: {
          logs: ModelDebugLogEntry[]
          total: number
        }
      }>('/api/debug/model-logs', {
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
        detailOpen.value = false
      }
    } catch (error) {
      fetchError.value = error instanceof Error ? error.message : '日志加载失败'
    } finally {
      loading.value = false
    }
  }

  async function clearLogs() {
    const confirmed = await useConfirm().confirm({
      title: '清空调用日志',
      description: '确定要清空所有模型调用日志吗？此操作无法撤销。',
      confirmText: '清空',
      variant: 'destructive'
    })
    if (!confirmed) return
    clearing.value = true
    try {
      await $fetch('/api/debug/model-logs', { method: 'DELETE' })
      logs.value = []
      total.value = 0
      page.value = 1
      activeLogId.value = ''
      detailOpen.value = false
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
      filters.provider,
      filters.operation,
      filters.status,
      filters.model,
      filters.requestId,
      filters.projectId,
      filters.sceneId,
      filters.taskId,
      filters.keyword,
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
    await loadStatus()
    if (currentUser.value?.role === 'admin') {
      await bootstrap().catch(error => console.error('管理员日志同步失败:', error))
    }
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
    detailOpen,
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
    providerOptions: MODEL_DEBUG_PROVIDER_OPTIONS,
    operationOptions: MODEL_DEBUG_OPERATION_OPTIONS,
    allFilterValue: MODEL_DEBUG_ALL_FILTER_VALUE,
    openLogDetail,
    formatDate,
    formatDuration,
    toPrettyJson,
    toReadableText,
    toSelectString,
    fetchLogs,
    previousPage,
    nextPage,
    clearLogs
  }
}
