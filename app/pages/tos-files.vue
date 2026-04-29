<script setup lang="ts">
import {
  Cloud,
  ExternalLink,
  File,
  Folder,
  Loader2,
  RefreshCw,
  Search,
  Video
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
const prefixInput = ref('manju-assets/images')
const activePrefix = ref('manju-assets/images')
const pageSize = ref('20')
const pageSizeOptions = [20, 50, 100, 200]
const continuationToken = ref<string | undefined>()
const tokenHistory = ref<string[]>([])
const currentPage = ref(1)
const responseData = ref<TosFilesResponse['data'] | null>(null)
const failedPreviewMediaKeys = ref<Record<string, true>>({})
const hoverPreviewFile = ref<TosFileEntry | null>(null)
const hoverPreviewPosition = ref({ x: 0, y: 0 })
const imagePreviewOpen = ref(false)
const imagePreviewSrc = ref('')
const imagePreviewAlt = ref('图片预览')
const assetTabs = [
  { id: 'image', label: 'Image', prefix: 'manju-assets/images/' },
  { id: 'video', label: 'Video', prefix: 'manju-assets/videos/' }
] as const

const pageSizeNumber = computed(() => {
  const parsed = Number.parseInt(pageSize.value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 100
  return Math.min(1000, parsed)
})

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

function normalizePrefixValue(value: string): string {
  return value.trim().replace(/\/+$/g, '')
}

const activeAssetTabId = computed<string | null>(() => {
  const normalizedPrefix = normalizePrefixValue(activePrefix.value)
  for (const tab of assetTabs) {
    const tabPrefix = normalizePrefixValue(tab.prefix)
    if (normalizedPrefix === tabPrefix || normalizedPrefix.startsWith(`${tabPrefix}/`)) {
      return tab.id
    }
  }
  return null
})

function isImageFile(key: string): boolean {
  return /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(key)
}

function isVideoFile(key: string): boolean {
  return /\.(avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i.test(key)
}

function isMediaFile(key: string): boolean {
  return isImageFile(key) || isVideoFile(key)
}

function canPreviewMedia(file: TosFileEntry): boolean {
  return isMediaFile(file.key) && !failedPreviewMediaKeys.value[file.key]
}

function markPreviewMediaFailed(key: string) {
  failedPreviewMediaKeys.value = {
    ...failedPreviewMediaKeys.value,
    [key]: true
  }
}

function updateHoverPreviewPosition(event: MouseEvent) {
  const panelWidth = 320
  const panelHeight = 352
  const offset = 16

  let x = event.clientX + offset
  let y = event.clientY + offset

  if (typeof window !== 'undefined') {
    const maxX = window.innerWidth - panelWidth - 12
    const maxY = window.innerHeight - panelHeight - 12
    if (x > maxX) x = Math.max(12, event.clientX - panelWidth - offset)
    if (y > maxY) y = Math.max(12, event.clientY - panelHeight - offset)
  }

  hoverPreviewPosition.value = { x, y }
}

function openHoverPreview(file: TosFileEntry, event: MouseEvent) {
  if (!canPreviewMedia(file)) return
  hoverPreviewFile.value = file
  updateHoverPreviewPosition(event)
}

function moveHoverPreview(event: MouseEvent) {
  if (!hoverPreviewFile.value) return
  updateHoverPreviewPosition(event)
}

function closeHoverPreview(key?: string) {
  if (!hoverPreviewFile.value) return
  if (key && hoverPreviewFile.value.key !== key) return
  hoverPreviewFile.value = null
}

function handleHoverPreviewMediaError() {
  if (!hoverPreviewFile.value) return
  markPreviewMediaFailed(hoverPreviewFile.value.key)
  hoverPreviewFile.value = null
}

function openImagePreview(file: TosFileEntry) {
  if (!isImageFile(file.key) || !file.url || failedPreviewMediaKeys.value[file.key]) return
  closeHoverPreview(file.key)
  imagePreviewSrc.value = file.url
  imagePreviewAlt.value = fileNameFromKey(file.key)
  imagePreviewOpen.value = true
}

async function loadFiles(options: { reset?: boolean } = {}) {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<TosFilesResponse>('/api/tos/files', {
      query: {
        prefix: activePrefix.value,
        delimiter: '/',
        maxKeys: pageSizeNumber.value,
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

function resetPagination() {
  closeHoverPreview()
  continuationToken.value = undefined
  tokenHistory.value = []
  currentPage.value = 1
}

function applyPrefix() {
  activePrefix.value = normalizePrefixValue(prefixInput.value)
  prefixInput.value = activePrefix.value
  resetPagination()
  void loadFiles({ reset: true })
}

function openPrefix(prefix: string) {
  activePrefix.value = normalizePrefixValue(prefix)
  prefixInput.value = activePrefix.value
  resetPagination()
  void loadFiles({ reset: true })
}

function switchAssetTab(prefix: string) {
  const normalizedPrefix = normalizePrefixValue(prefix)
  if (!normalizedPrefix) return
  if (activePrefix.value === normalizedPrefix) return
  activePrefix.value = normalizedPrefix
  prefixInput.value = normalizedPrefix
  resetPagination()
  void loadFiles({ reset: true })
}

function handlePageSizeChange(value: string) {
  const normalized = (value || '').trim()
  if (!normalized || normalized === pageSize.value) return
  pageSize.value = normalized
  resetPagination()
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
  currentPage.value += 1
  void loadFiles()
}

function goPreviousPage() {
  if (tokenHistory.value.length === 0) return
  const previousToken = tokenHistory.value.pop()
  continuationToken.value = previousToken || undefined
  currentPage.value = Math.max(1, currentPage.value - 1)
  void loadFiles()
}

function goFirstPage() {
  if (currentPage.value <= 1) return
  resetPagination()
  void loadFiles({ reset: true })
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
              v-for="tab in assetTabs"
              :key="tab.id"
              size="sm"
              :variant="activeAssetTabId === tab.id ? 'default' : 'outline'"
              :disabled="loading"
              @click="switchAssetTab(tab.prefix)"
            >
              {{ tab.label }}
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

        <Table
          v-else
          class="table-fixed"
        >
          <colgroup>
            <col>
            <col class="w-[88px]">
            <col class="w-[92px]">
            <col class="w-[190px]">
            <col class="w-[140px]">
            <col class="w-[72px]">
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead class="min-w-[320px]">
                名称
              </TableHead>
              <TableHead class="whitespace-nowrap">
                类型
              </TableHead>
              <TableHead class="whitespace-nowrap">
                大小
              </TableHead>
              <TableHead class="whitespace-nowrap">
                更新时间
              </TableHead>
              <TableHead class="whitespace-nowrap">
                存储类型
              </TableHead>
              <TableHead class="whitespace-nowrap text-right">
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
              <TableCell class="whitespace-nowrap">
                目录
              </TableCell>
              <TableCell class="whitespace-nowrap">
                -
              </TableCell>
              <TableCell class="whitespace-nowrap">
                -
              </TableCell>
              <TableCell class="whitespace-nowrap">
                -
              </TableCell>
              <TableCell />
            </TableRow>

            <TableRow
              v-for="file in responseData?.files || []"
              :key="file.key"
              :class="isImageFile(file.key) && !failedPreviewMediaKeys[file.key] ? 'cursor-pointer hover:bg-muted/50' : undefined"
              @click="openImagePreview(file)"
            >
              <TableCell>
                <div
                  class="flex min-w-0 items-center gap-3"
                  @mouseenter="openHoverPreview(file, $event)"
                  @mousemove="moveHoverPreview($event)"
                  @mouseleave="closeHoverPreview(file.key)"
                >
                  <a
                    v-if="isImageFile(file.key) && !failedPreviewMediaKeys[file.key]"
                    :href="file.url"
                    target="_blank"
                    rel="noreferrer"
                    class="shrink-0"
                    title="查看原图"
                    @click.stop
                  >
                    <img
                      :src="file.url"
                      :alt="fileNameFromKey(file.key)"
                      class="h-12 w-12 rounded border object-cover"
                      loading="lazy"
                      @error="markPreviewMediaFailed(file.key)"
                    >
                  </a>
                  <Video
                    v-else-if="isVideoFile(file.key)"
                    class="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <File
                    v-else
                    class="h-4 w-4 shrink-0 text-muted-foreground"
                  />
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
              <TableCell class="whitespace-nowrap">
                {{ isImageFile(file.key) ? '图片' : (isVideoFile(file.key) ? '视频' : '文件') }}
              </TableCell>
              <TableCell class="whitespace-nowrap">
                {{ formatBytes(file.size) }}
              </TableCell>
              <TableCell class="whitespace-nowrap">
                {{ formatDate(file.lastModified) }}
              </TableCell>
              <TableCell class="whitespace-nowrap">
                {{ file.storageClass || '-' }}
              </TableCell>
              <TableCell class="text-right">
                <Button
                  as="a"
                  variant="ghost"
                  size="icon"
                  :href="file.url"
                  target="_blank"
                  rel="noreferrer"
                  title="打开文件"
                  @click.stop
                >
                  <ExternalLink class="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div
          v-if="responseData"
          class="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="text-xs text-muted-foreground">
            第 {{ currentPage }} 页 · 每页 {{ pageSizeNumber }} 条
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <div class="flex items-center gap-1 text-xs text-muted-foreground">
              <span>每页</span>
              <Select
                :model-value="pageSize"
                @update:model-value="handlePageSizeChange(String($event))"
              >
                <SelectTrigger class="h-8 w-[88px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="size in pageSizeOptions"
                    :key="size"
                    :value="String(size)"
                  >
                    {{ size }} 条
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-8 px-2.5 text-xs"
              :disabled="loading || currentPage <= 1"
              @click="goFirstPage"
            >
              第一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 px-2.5 text-xs"
              :disabled="loading || currentPage <= 1"
              @click="goPreviousPage"
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-8 px-2.5 text-xs"
              :disabled="loading || !responseData?.nextContinuationToken"
              @click="goNextPage"
            >
              下一页
            </Button>
          </div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="hoverPreviewFile"
        class="pointer-events-none fixed z-[70] hidden md:block"
        :style="{ left: `${hoverPreviewPosition.x}px`, top: `${hoverPreviewPosition.y}px` }"
      >
        <div class="w-80 rounded-lg border bg-card/95 p-2 shadow-2xl backdrop-blur-sm">
          <video
            v-if="isVideoFile(hoverPreviewFile.key)"
            :src="hoverPreviewFile.url"
            class="h-72 w-full rounded bg-muted/40 object-contain"
            autoplay
            muted
            loop
            playsinline
            preload="metadata"
            @error="handleHoverPreviewMediaError"
          />
          <img
            v-else
            :src="hoverPreviewFile.url"
            :alt="fileNameFromKey(hoverPreviewFile.key)"
            class="h-72 w-full rounded object-contain bg-muted/40"
            loading="lazy"
            @error="handleHoverPreviewMediaError"
          >
          <p class="mt-2 truncate px-1 text-xs text-muted-foreground">
            {{ fileNameFromKey(hoverPreviewFile.key) }}
          </p>
        </div>
      </div>
    </Teleport>
    <ImagePreview
      v-model:open="imagePreviewOpen"
      :src="imagePreviewSrc"
      :alt="imagePreviewAlt"
    />
  </div>
</template>
