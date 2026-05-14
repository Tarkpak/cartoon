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
  request?: unknown
  requestRaw?: unknown
  response?: unknown
  responseRaw?: unknown
  mediaRefs?: ModelDebugMediaRef[]
  error?: ModelDebugErrorInfo
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
    toReadableText,
    toSelectString,
    fetchLogs,
    clearLogs
  }
}
