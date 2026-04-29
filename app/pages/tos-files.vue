<script setup lang="ts">
import {
  Cloud,
  ExternalLink,
  File,
  Folder,
  Loader2,
  RefreshCw,
  Search
} from 'lucide-vue-next'

type TosFileEntry = {
  key: string
  size: number
  lastModified: string
  storageClass: string
  etag: string
  url: string
}

type TosFilesResponse = {
  success: boolean
  data: {
    bucket: string
    prefix: string
    delimiter?: string
    maxKeys: number
    isTruncated: boolean
    nextContinuationToken?: string
    commonPrefixes: string[]
    files: TosFileEntry[]
  }
}

type FetchErrorWithData = Error & {
  data?: {
    data?: {
      message?: string
    }
    message?: string
    statusMessage?: string
  }
}

const loading = ref(false)
const errorMessage = ref('')
const prefixInput = ref('manju-assets')
const activePrefix = ref('manju-assets')
const continuationToken = ref<string | undefined>()
const tokenHistory = ref<string[]>([])
const responseData = ref<TosFilesResponse['data'] | null>(null)

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '-'
  return date.toLocaleString('zh-CN')
}

function fileNameFromKey(key: string): string {
  return key.split('/').filter(Boolean).at(-1) || key
}

async function loadFiles(options: { reset?: boolean } = {}) {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<TosFilesResponse>('/api/tos/files', {
      query: {
        prefix: activePrefix.value,
        delimiter: '/',
        maxKeys: 100,
        continuationToken: options.reset ? undefined : continuationToken.value
      }
    })

    if (response.success) {
      responseData.value = response.data
    }
  } catch (error) {
    const fetchError = error as FetchErrorWithData
    errorMessage.value = fetchError.data?.data?.message
      || fetchError.data?.message
      || fetchError.data?.statusMessage
      || (error instanceof Error ? error.message : '读取 TOS 文件失败')
  } finally {
    loading.value = false
  }
}

function applyPrefix() {
  activePrefix.value = prefixInput.value.trim()
  continuationToken.value = undefined
  tokenHistory.value = []
  void loadFiles({ reset: true })
}

function openPrefix(prefix: string) {
  activePrefix.value = prefix.replace(/\/+$/g, '')
  prefixInput.value = activePrefix.value
  continuationToken.value = undefined
  tokenHistory.value = []
  void loadFiles({ reset: true })
}

function goNextPage() {
  const nextToken = responseData.value?.nextContinuationToken
  if (!nextToken) return
  if (continuationToken.value) {
    tokenHistory.value.push(continuationToken.value)
  } else {
    tokenHistory.value.push('')
  }
  continuationToken.value = nextToken
  void loadFiles()
}

function goPreviousPage() {
  if (tokenHistory.value.length === 0) return
  const previousToken = tokenHistory.value.pop()
  continuationToken.value = previousToken || undefined
  void loadFiles()
}

onMounted(() => {
  void loadFiles({ reset: true })
})
</script>

<template>
  <div class="h-full overflow-y-auto bg-background">
    <div class="mx-auto max-w-7xl space-y-6 p-6">
      <div class="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <Cloud class="h-5 w-5 text-primary" />
            <h1 class="text-2xl font-semibold">
              TOS 云端文件
            </h1>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            查看当前 TOS Bucket 中的对象，默认按配置前缀分组显示。
          </p>
        </div>

        <Button
          variant="outline"
          class="gap-2"
          :disabled="loading"
          @click="loadFiles()"
        >
          <Loader2
            v-if="loading"
            class="h-4 w-4 animate-spin"
          />
          <RefreshCw
            v-else
            class="h-4 w-4"
          />
          刷新
        </Button>
      </div>

      <div class="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">对象前缀</label>
          <Input
            v-model="prefixInput"
            placeholder="例如：manju-assets/images"
            @keydown.enter="applyPrefix"
          />
        </div>
        <Button
          class="gap-2"
          :disabled="loading"
          @click="applyPrefix"
        >
          <Search class="h-4 w-4" />
          查询
        </Button>
      </div>

      <div
        v-if="errorMessage"
        class="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        {{ errorMessage }}
      </div>

      <div
        v-if="responseData"
        class="grid gap-3 md:grid-cols-4"
      >
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs text-muted-foreground">
            Bucket
          </p>
          <p class="mt-1 truncate text-sm font-medium">
            {{ responseData.bucket }}
          </p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs text-muted-foreground">
            当前前缀
          </p>
          <p class="mt-1 truncate text-sm font-medium">
            {{ responseData.prefix || '-' }}
          </p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs text-muted-foreground">
            文件数
          </p>
          <p class="mt-1 text-sm font-medium">
            {{ responseData.files.length }}
          </p>
        </div>
        <div class="rounded-lg border bg-card p-4">
          <p class="text-xs text-muted-foreground">
            子目录
          </p>
          <p class="mt-1 text-sm font-medium">
            {{ responseData.commonPrefixes.length }}
          </p>
        </div>
      </div>

      <div class="overflow-hidden rounded-lg border bg-card">
        <div class="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 class="text-sm font-medium">
            对象列表
          </h2>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="loading || tokenHistory.length === 0"
              @click="goPreviousPage"
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              :disabled="loading || !responseData?.nextContinuationToken"
              @click="goNextPage"
            >
              下一页
            </Button>
          </div>
        </div>

        <div
          v-if="loading && !responseData"
          class="flex items-center justify-center py-16 text-sm text-muted-foreground"
        >
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          加载 TOS 文件...
        </div>

        <div
          v-else-if="responseData && responseData.commonPrefixes.length === 0 && responseData.files.length === 0"
          class="py-16 text-center text-sm text-muted-foreground"
        >
          当前前缀下没有文件
        </div>

        <Table v-else>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead>存储类型</TableHead>
              <TableHead class="w-24 text-right">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="prefix in responseData?.commonPrefixes || []"
              :key="`prefix_${prefix}`"
            >
              <TableCell>
                <Button
                  type="button"
                  variant="link"
                  class="h-auto max-w-full justify-start gap-2 p-0 text-left text-sm font-medium"
                  @click="openPrefix(prefix)"
                >
                  <Folder class="h-4 w-4 shrink-0" />
                  <span class="truncate">{{ prefix }}</span>
                </Button>
              </TableCell>
              <TableCell>目录</TableCell>
              <TableCell>-</TableCell>
              <TableCell>-</TableCell>
              <TableCell>-</TableCell>
              <TableCell />
            </TableRow>

            <TableRow
              v-for="file in responseData?.files || []"
              :key="file.key"
            >
              <TableCell>
                <div class="flex min-w-0 items-center gap-2">
                  <File class="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium">
                      {{ fileNameFromKey(file.key) }}
                    </p>
                    <p class="truncate text-xs text-muted-foreground">
                      {{ file.key }}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>文件</TableCell>
              <TableCell>{{ formatBytes(file.size) }}</TableCell>
              <TableCell>{{ formatDate(file.lastModified) }}</TableCell>
              <TableCell>{{ file.storageClass || '-' }}</TableCell>
              <TableCell class="text-right">
                <Button
                  as="a"
                  variant="ghost"
                  size="icon"
                  :href="file.url"
                  target="_blank"
                  rel="noreferrer"
                  title="打开文件"
                >
                  <ExternalLink class="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  </div>
</template>
