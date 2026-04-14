<script setup lang="ts">
import { Loader2, RefreshCw, Trash2, X } from 'lucide-vue-next'
import {
  Checkbox
} from '@/components/ui/checkbox'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

definePageMeta({ layout: 'default' })

interface ModelDebugErrorInfo {
  name?: string
  message: string
  stack?: string
}

interface ModelDebugLogEntry {
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

const providerOptions = ['gemini', 'qwen', 'kling', 'volcengine']
const operationOptions = [
  'generateText',
  'generateJSON',
  'generateImage',
  'generateVideo',
  'textToSpeech',
  'speechToText'
]
const ALL_FILTER_VALUE = '__all__'

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
</script>

<template>
  <div class="min-h-screen bg-background p-6 space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>模型输入输出日志</CardTitle>
        <CardDescription>用于定位模型调用问题：可查看请求参数、返回结果、耗时与错误信息</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Select
            :model-value="filters.provider || ALL_FILTER_VALUE"
            @update:model-value="(value) => { const nextValue = toSelectString(value); filters.provider = nextValue === ALL_FILTER_VALUE ? '' : nextValue }"
          >
            <SelectTrigger class="h-9">
              <SelectValue placeholder="全部 Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL_FILTER_VALUE">
                全部 Provider
              </SelectItem>
              <SelectItem
                v-for="provider in providerOptions"
                :key="provider"
                :value="provider"
              >
                {{ provider }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Select
            :model-value="filters.operation || ALL_FILTER_VALUE"
            @update:model-value="(value) => { const nextValue = toSelectString(value); filters.operation = nextValue === ALL_FILTER_VALUE ? '' : nextValue }"
          >
            <SelectTrigger class="h-9">
              <SelectValue placeholder="全部操作" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL_FILTER_VALUE">
                全部操作
              </SelectItem>
              <SelectItem
                v-for="operation in operationOptions"
                :key="operation"
                :value="operation"
              >
                {{ operation }}
              </SelectItem>
            </SelectContent>
          </Select>

          <Select
            :model-value="filters.status || ALL_FILTER_VALUE"
            @update:model-value="(value) => { const nextValue = toSelectString(value); filters.status = nextValue === ALL_FILTER_VALUE ? '' : nextValue }"
          >
            <SelectTrigger class="h-9">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="ALL_FILTER_VALUE">
                全部状态
              </SelectItem>
              <SelectItem value="success">
                success
              </SelectItem>
              <SelectItem value="error">
                error
              </SelectItem>
            </SelectContent>
          </Select>

          <Input
            v-model="filters.model"
            placeholder="模型名关键词"
          />
          <Input
            v-model="filters.keyword"
            placeholder="请求/返回关键词"
          />

          <Input
            v-model.number="filters.limit"
            type="number"
            min="1"
            max="500"
          />
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <Button
            :disabled="loading"
            @click="fetchLogs"
          >
            <Loader2
              v-if="loading"
              class="w-4 h-4 mr-2 animate-spin"
            />
            <RefreshCw
              v-else
              class="w-4 h-4 mr-2"
            />
            刷新
          </Button>

          <Button
            variant="outline"
            :disabled="clearing"
            @click="clearLogs"
          >
            <Loader2
              v-if="clearing"
              class="w-4 h-4 mr-2 animate-spin"
            />
            <Trash2
              v-else
              class="w-4 h-4 mr-2"
            />
            清空日志
          </Button>

          <label class="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox v-model:checked="autoRefresh" />
            自动刷新（5秒）
          </label>
        </div>

        <p
          v-if="fetchError"
          class="text-sm text-destructive"
        >
          {{ fetchError }}
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle>日志列表（{{ logs.length }}）</CardTitle>
        <CardDescription>点击任意行可在右侧抽屉查看完整请求/响应详情</CardDescription>
      </CardHeader>
      <CardContent class="p-0">
        <div class="max-h-[72vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="whitespace-nowrap">
                  时间
                </TableHead>
                <TableHead>
                  Provider
                </TableHead>
                <TableHead>
                  操作
                </TableHead>
                <TableHead>
                  模型
                </TableHead>
                <TableHead>
                  状态
                </TableHead>
                <TableHead class="whitespace-nowrap">
                  耗时
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody v-if="logs.length > 0">
              <TableRow
                v-for="item in logs"
                :key="item.id"
                class="cursor-pointer"
                :class="item.id === activeLogId && detailOpen ? 'bg-muted/60' : ''"
                @click="openLogDetail(item)"
              >
                <TableCell class="whitespace-nowrap text-xs text-muted-foreground">
                  {{ formatDate(item.timestamp) }}
                </TableCell>
                <TableCell class="font-medium">
                  {{ item.provider }}
                </TableCell>
                <TableCell
                  class="max-w-[220px] truncate"
                  :title="item.operation"
                >
                  {{ item.operation }}
                </TableCell>
                <TableCell
                  class="max-w-[280px] truncate"
                  :title="item.model"
                >
                  {{ item.model || '-' }}
                </TableCell>
                <TableCell>
                  <Badge :variant="item.status === 'success' ? 'default' : 'destructive'">
                    {{ item.status }}
                  </Badge>
                </TableCell>
                <TableCell class="whitespace-nowrap">
                  {{ formatDuration(item.durationMs) }}
                </TableCell>
              </TableRow>
            </TableBody>

            <TableBody v-else>
              <TableRow>
                <TableCell
                  :colspan="6"
                  class="h-24 text-center text-muted-foreground"
                >
                  暂无日志
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Drawer
      v-model:open="detailOpen"
      direction="right"
      :should-scale-background="false"
    >
      <DrawerContent
        class="mt-0 h-screen max-h-screen w-[95vw] max-w-none overflow-hidden rounded-none border-l border-border p-0 sm:w-[820px] data-[vaul-drawer-direction=right]:top-0 data-[vaul-drawer-direction=right]:bottom-auto data-[vaul-drawer-direction=right]:left-auto data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:inset-y-0 [&>div:first-child]:hidden"
      >
        <div class="h-full min-h-0 flex flex-col">
          <DrawerHeader class="border-b px-5 py-4 text-left pr-12">
            <DrawerTitle>日志详情</DrawerTitle>
            <DrawerDescription v-if="activeLog">
              {{ activeLog.provider }} · {{ activeLog.operation }} · {{ formatDate(activeLog.timestamp) }}
            </DrawerDescription>
            <DrawerDescription v-else>
              当前日志已不存在（可能被筛选或清空）
            </DrawerDescription>
          </DrawerHeader>

          <DrawerClose as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="absolute right-4 top-4 h-8 w-8 opacity-70 transition-opacity hover:opacity-100"
              aria-label="关闭"
            >
              <X class="w-4 h-4" />
            </Button>
          </DrawerClose>

          <div
            v-if="activeLog"
            class="min-h-0 flex-1 overflow-y-auto p-5 space-y-4 overscroll-contain"
          >
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div class="rounded border p-3">
                <p class="text-xs text-muted-foreground">
                  时间
                </p>
                <p class="mt-1">
                  {{ formatDate(activeLog.timestamp) }}
                </p>
              </div>
              <div class="rounded border p-3">
                <p class="text-xs text-muted-foreground">
                  Provider
                </p>
                <p class="mt-1">
                  {{ activeLog.provider }}
                </p>
              </div>
              <div class="rounded border p-3">
                <p class="text-xs text-muted-foreground">
                  操作
                </p>
                <p class="mt-1 break-all">
                  {{ activeLog.operation }}
                </p>
              </div>
              <div class="rounded border p-3">
                <p class="text-xs text-muted-foreground">
                  模型
                </p>
                <p class="mt-1 break-all">
                  {{ activeLog.model || '-' }}
                </p>
              </div>
              <div class="rounded border p-3">
                <p class="text-xs text-muted-foreground">
                  状态
                </p>
                <p class="mt-1">
                  {{ activeLog.status }}
                </p>
              </div>
              <div class="rounded border p-3">
                <p class="text-xs text-muted-foreground">
                  耗时
                </p>
                <p class="mt-1">
                  {{ formatDuration(activeLog.durationMs) }}
                </p>
              </div>
            </div>

            <div class="space-y-2">
              <h4 class="font-medium text-sm">
                请求参数
              </h4>
              <pre class="text-xs bg-muted p-3 rounded overflow-auto whitespace-pre-wrap break-all">{{ toPrettyJson(activeLog.request) || '无' }}</pre>
            </div>

            <div class="space-y-2">
              <h4 class="font-medium text-sm">
                响应结果
              </h4>
              <pre class="text-xs bg-muted p-3 rounded overflow-auto whitespace-pre-wrap break-all">{{ toPrettyJson(activeLog.response) || '无' }}</pre>
            </div>

            <div
              v-if="activeLog.error"
              class="space-y-2"
            >
              <h4 class="font-medium text-sm text-destructive">
                错误信息
              </h4>
              <pre class="text-xs bg-destructive/10 p-3 rounded overflow-auto whitespace-pre-wrap break-all">{{ toPrettyJson(activeLog.error) }}</pre>
            </div>
          </div>

          <div
            v-else
            class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
          >
            未找到日志详情
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  </div>
</template>
