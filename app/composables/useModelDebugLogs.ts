export interface ModelDebugErrorInfo {
  name?: string
  message: string
  stack?: string
}

export interface ModelDebugLogEntry {
  id: string
  timestamp: string
  provider: string
  model: string
  operation: string
  status: 'success' | 'error'
  durationMs: number
  request?: unknown
  response?: unknown
  error?: ModelDebugErrorInfo
}

export const MODEL_DEBUG_PROVIDER_OPTIONS = ['gemini', 'qwen', 'kling', 'volcengine']

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
  const logs = ref<ModelDebugLogEntry[]>([])
  const activeLogId = ref('')
  const detailOpen = ref(false)
  const loading = ref(false)
  const clearing = ref(false)
  const fetchError = ref('')
  const autoRefresh = ref(true)

  const filters = reactive({
    provider: '',
    operation: '',
    status: '',
    model: '',
    keyword: '',
    limit: 100
  })

  const activeLog = computed(() => logs.value.find(item => item.id === activeLogId.value) || null)

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

  function toSelectString(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  function buildQuery() {
    return {
      limit: filters.limit,
      provider: filters.provider || undefined,
      operation: filters.operation || undefined,
      status: filters.status || undefined,
      model: filters.model || undefined,
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
        }
      }>('/api/debug/model-logs', {
        query: buildQuery()
      })

      logs.value = response.data.logs || []

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
    if (!confirm('确定要清空所有模型日志吗？')) return
    clearing.value = true
    try {
      await $fetch('/api/debug/model-logs', { method: 'DELETE' })
      logs.value = []
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
    detailOpen,
    loading,
    clearing,
    fetchError,
    autoRefresh,
    filters,
    providerOptions: MODEL_DEBUG_PROVIDER_OPTIONS,
    operationOptions: MODEL_DEBUG_OPERATION_OPTIONS,
    allFilterValue: MODEL_DEBUG_ALL_FILTER_VALUE,
    openLogDetail,
    formatDate,
    formatDuration,
    toPrettyJson,
    toSelectString,
    fetchLogs,
    clearLogs
  }
}
