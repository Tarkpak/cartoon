<script setup lang="ts">
import { Download, ExternalLink, FolderOpen, History, Loader2, Maximize2, Search, Trash2 } from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'

definePageMeta({
  layout: 'default'
})

type Platform = 'douyin' | 'wxChannels'

interface ShortVideoProfile {
  historyId?: string
  platform: Platform
  title: string
  coverUrl: string
  videoUrl: string
  sourceUrl: string
  author?: string
  authorIcon?: string
  createTime?: number | null
  awemeId?: string
}

interface DownloadResult {
  profile: ShortVideoProfile
  path: string
  filename: string
  downloadDir: string
  sizeBytes: number
}

interface HistoryItem {
  id: string
  platform: Platform
  profile: ShortVideoProfile
  sourceUrl: string
  path: string
  filename: string
  downloadDir: string
  sizeBytes: number
  parsedAt: string
  downloadedAt?: string | null
  updatedAt: string
}

type ApiError = Error & {
  data?: {
    message?: string
    statusMessage?: string
  }
}

const { toast } = useToast()

const shareUrl = ref('')
const filename = ref('')
const profile = ref<ShortVideoProfile | null>(null)
const result = ref<DownloadResult | null>(null)
const historyItems = ref<HistoryItem[]>([])
const previewVideoRef = ref<HTMLVideoElement | null>(null)
const historyPreviewVideoRef = ref<HTMLVideoElement | null>(null)
const selectedHistoryItem = ref<HistoryItem | null>(null)
const historyDrawerOpen = ref(false)
const parsing = ref(false)
const downloading = ref(false)
const loadingHistory = ref(false)
const deletingHistoryId = ref('')
const errorMessage = ref('')

const canParse = computed(() => shareUrl.value.trim().length > 0 && !parsing.value && !downloading.value)
const canDownload = computed(() => profile.value !== null && !parsing.value && !downloading.value)
const previewVideoUrl = computed(() => {
  if (!profile.value?.videoUrl) return ''
  if (profile.value.platform === 'douyin') {
    return `/api/tools/short-video/preview?platform=douyin&url=${encodeURIComponent(profile.value.videoUrl)}`
  }
  return profile.value.videoUrl
})
const platformLabel = computed(() => profile.value ? getPlatformLabel(profile.value.platform) : '')
const selectedHistoryPreviewVideoUrl = computed(() => {
  const item = selectedHistoryItem.value
  if (!item?.profile.videoUrl) return ''
  if (item.platform === 'douyin') {
    return `/api/tools/short-video/preview?platform=douyin&url=${encodeURIComponent(item.profile.videoUrl)}`
  }
  return item.profile.videoUrl
})

onMounted(() => {
  void loadHistory()
})

async function parseShareUrl() {
  parsing.value = true
  errorMessage.value = ''
  result.value = null
  try {
    const response = await $fetch<{ success: boolean, data?: ShortVideoProfile, message?: string }>('/api/tools/short-video/parse', {
      method: 'POST',
      body: { url: shareUrl.value }
    })
    if (!response.success || !response.data) throw new Error(response.message || '解析失败')
    profile.value = response.data
    if (!filename.value.trim()) filename.value = response.data.title || `${getPlatformLabel(response.data.platform)}视频`
    void loadHistory()
  } catch (error) {
    profile.value = null
    errorMessage.value = getErrorMessage(error)
    toast.error('解析失败', { description: errorMessage.value })
  } finally {
    parsing.value = false
  }
}

async function downloadVideo() {
  if (!profile.value) return
  downloading.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<{ success: boolean, data?: DownloadResult, message?: string }>('/api/tools/short-video/download', {
      method: 'POST',
      body: {
        url: shareUrl.value || profile.value.sourceUrl,
        filename: filename.value
      }
    })
    if (!response.success || !response.data) throw new Error(response.message || '下载失败')
    result.value = response.data
    profile.value = result.value.profile
    toast.success('下载完成', { description: result.value.filename })
    void loadHistory()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
    toast.error('下载失败', { description: errorMessage.value })
  } finally {
    downloading.value = false
  }
}

async function loadHistory() {
  loadingHistory.value = true
  try {
    const response = await $fetch<{ success: boolean, data?: { items?: HistoryItem[] }, message?: string }>('/api/tools/short-video/history')
    if (!response.success) throw new Error(response.message || '读取历史失败')
    historyItems.value = response.data?.items || []
  } catch (error) {
    console.error('Failed to load short video history:', error)
  } finally {
    loadingHistory.value = false
  }
}

function restoreHistory(item: HistoryItem) {
  shareUrl.value = item.sourceUrl
  profile.value = item.profile
  filename.value = item.filename || item.profile.title || `${getPlatformLabel(item.platform)}视频`
  result.value = item.path
    ? {
        profile: item.profile,
        path: item.path,
        filename: item.filename,
        downloadDir: item.downloadDir,
        sizeBytes: item.sizeBytes
      }
    : null
  errorMessage.value = ''
}

function openHistoryDrawer(item: HistoryItem) {
  selectedHistoryItem.value = item
  historyDrawerOpen.value = true
}

function loadHistoryItemToCurrent(item: HistoryItem) {
  restoreHistory(item)
  historyDrawerOpen.value = false
}

async function deleteHistoryItem(item: HistoryItem) {
  deletingHistoryId.value = item.id
  try {
    await $fetch(`/api/tools/short-video/history/${item.platform}/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
    historyItems.value = historyItems.value.filter(history => !(history.platform === item.platform && history.id === item.id))
    if (selectedHistoryItem.value?.id === item.id && selectedHistoryItem.value.platform === item.platform) {
      selectedHistoryItem.value = null
      historyDrawerOpen.value = false
    }
    if (profile.value?.historyId === item.id && profile.value.platform === item.platform) {
      profile.value = null
      result.value = null
    }
  } catch (error) {
    toast.error('删除历史失败', { description: getErrorMessage(error) })
  } finally {
    deletingHistoryId.value = ''
  }
}

async function openLocalPath(path: string) {
  const target = path.trim()
  if (!target) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_local_path', { path: target })
  } catch (error) {
    toast.error('无法打开路径', { description: getErrorMessage(error) })
  }
}

async function openLocalDirectory(path: string) {
  const target = path.trim()
  if (!target) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_local_directory', { path: target })
  } catch (error) {
    toast.error('无法打开目录', { description: getErrorMessage(error) })
  }
}

async function openPreviewFullscreen() {
  const video = previewVideoRef.value
  await openVideoFullscreen(video)
}

async function openHistoryPreviewFullscreen() {
  const video = historyPreviewVideoRef.value
  await openVideoFullscreen(video)
}

async function openVideoFullscreen(video: HTMLVideoElement | null) {
  if (!video) return
  const fullscreenTarget = video as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void
    webkitRequestFullscreen?: () => Promise<void> | void
  }

  try {
    if (fullscreenTarget.requestFullscreen) {
      await fullscreenTarget.requestFullscreen()
    } else if (fullscreenTarget.webkitRequestFullscreen) {
      await fullscreenTarget.webkitRequestFullscreen()
    } else if (fullscreenTarget.webkitEnterFullscreen) {
      fullscreenTarget.webkitEnterFullscreen()
    }
  } catch {
    toast.error('无法进入全屏')
  }
}

function getPlatformLabel(platform: Platform) {
  return platform === 'douyin' ? '抖音' : '视频号'
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatCreateTime(value?: number | null) {
  if (!value) return ''
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function downloadedStatus(item: HistoryItem) {
  return item.path ? '已下载' : '未下载'
}

function formatHistoryTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'string') return error
  const err = error as ApiError
  return err?.data?.message || err?.data?.statusMessage || err?.message || '操作失败'
}
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="短视频下载"
      compact
      class="h-12"
    />

    <AppPageContent class="overflow-auto px-4 pb-4 md:px-6">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <Card>
          <CardContent class="space-y-4 p-4">
            <div class="space-y-3">
              <label class="text-sm font-medium text-foreground">分享链接</label>
              <Textarea
                v-model="shareUrl"
                rows="2"
                placeholder="粘贴抖音或视频号分享链接"
              />
              <Button
                type="button"
                class="gap-2"
                :disabled="!canParse"
                @click="parseShareUrl"
              >
                <Loader2
                  v-if="parsing"
                  class="h-4 w-4 animate-spin"
                />
                <Search
                  v-else
                  class="h-4 w-4"
                />
                解析
              </Button>
            </div>

            <div
              v-if="errorMessage"
              class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {{ errorMessage }}
            </div>

            <div
              v-if="historyItems.length > 0"
              class="space-y-3 border-t pt-4"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2 text-sm font-medium text-foreground">
                  <History class="h-4 w-4" />
                  最近解析
                </div>
                <span
                  v-if="loadingHistory"
                  class="text-xs text-muted-foreground"
                >
                  更新中...
                </span>
              </div>

              <Table class="table-fixed">
                <colgroup>
                  <col>
                  <col class="w-[96px]">
                  <col class="w-[150px]">
                  <col class="w-[96px]">
                  <col class="w-[180px]">
                  <col class="w-[72px]">
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>视频</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>作者/标识</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead class="text-right">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow
                    v-for="item in historyItems"
                    :key="`${item.platform}:${item.id}`"
                    tabindex="0"
                    class="cursor-pointer hover:bg-muted/50"
                    @click="openHistoryDrawer(item)"
                    @keydown.enter.prevent="openHistoryDrawer(item)"
                  >
                    <TableCell>
                      <div class="flex min-w-0 items-center gap-3">
                        <div class="h-12 w-20 shrink-0 overflow-hidden rounded border bg-black">
                          <img
                            v-if="item.profile.coverUrl"
                            :src="item.profile.coverUrl"
                            alt=""
                            class="h-full w-full object-cover"
                          >
                        </div>
                        <div class="min-w-0">
                          <p class="truncate text-sm font-medium">
                            {{ item.profile.title || '未命名视频' }}
                          </p>
                          <p class="truncate text-xs text-muted-foreground">
                            {{ item.sourceUrl }}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell class="whitespace-nowrap">
                      <Badge variant="outline">
                        {{ getPlatformLabel(item.platform) }}
                      </Badge>
                    </TableCell>
                    <TableCell class="truncate text-sm text-muted-foreground">
                      {{ item.profile.author || item.profile.awemeId || '-' }}
                    </TableCell>
                    <TableCell class="whitespace-nowrap">
                      <Badge :variant="item.path ? 'success' : 'secondary'">
                        {{ downloadedStatus(item) }}
                      </Badge>
                    </TableCell>
                    <TableCell class="whitespace-nowrap text-sm text-muted-foreground">
                      {{ formatHistoryTime(item.updatedAt) || '-' }}
                    </TableCell>
                    <TableCell class="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="h-8 w-8"
                        :disabled="deletingHistoryId === item.id"
                        title="删除历史"
                        aria-label="删除历史"
                        @click.stop="deleteHistoryItem(item)"
                      >
                        <Loader2
                          v-if="deletingHistoryId === item.id"
                          class="h-4 w-4 animate-spin"
                        />
                        <Trash2
                          v-else
                          class="h-4 w-4"
                        />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div
              v-if="profile"
              class="grid gap-5 border-t pt-4 xl:grid-cols-[minmax(560px,1fr)_minmax(320px,420px)]"
            >
              <div class="group relative overflow-hidden rounded-md border bg-black">
                <video
                  v-if="previewVideoUrl"
                  ref="previewVideoRef"
                  :src="previewVideoUrl"
                  :poster="profile.coverUrl || undefined"
                  controls
                  playsinline
                  preload="metadata"
                  class="aspect-video min-h-[360px] w-full bg-black object-contain"
                />
                <Button
                  v-if="previewVideoUrl"
                  type="button"
                  variant="secondary"
                  size="icon"
                  class="absolute right-3 top-3 h-9 w-9 bg-background/80 opacity-90 shadow-sm backdrop-blur transition-opacity hover:bg-background group-hover:opacity-100"
                  title="全屏预览"
                  aria-label="全屏预览"
                  @click="openPreviewFullscreen"
                >
                  <Maximize2 class="h-4 w-4" />
                </Button>
              </div>

              <div class="flex min-w-0 flex-col gap-3">
                <div class="min-w-0 space-y-2">
                  <div class="text-xs font-medium text-muted-foreground">
                    {{ platformLabel }}
                  </div>
                  <h2 class="line-clamp-3 text-base font-semibold leading-6">
                    {{ profile.title || '未命名视频' }}
                  </h2>
                  <div
                    v-if="profile.author || formatCreateTime(profile.createTime)"
                    class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
                  >
                    <img
                      v-if="profile.authorIcon"
                      :src="profile.authorIcon"
                      alt=""
                      class="h-6 w-6 rounded-full object-cover"
                    >
                    <span
                      v-if="profile.author"
                      class="truncate"
                    >
                      {{ profile.author }}
                    </span>
                    <span
                      v-if="formatCreateTime(profile.createTime)"
                      class="shrink-0"
                    >
                      {{ formatCreateTime(profile.createTime) }}
                    </span>
                  </div>
                  <p class="break-all text-xs text-muted-foreground">
                    {{ profile.sourceUrl }}
                  </p>
                </div>

                <div class="space-y-2">
                  <label class="text-sm font-medium text-foreground">保存文件名</label>
                  <Input
                    v-model="filename"
                    placeholder="保存为..."
                  />
                </div>

                <Button
                  type="button"
                  class="w-fit gap-2"
                  :disabled="!canDownload"
                  @click="downloadVideo"
                >
                  <Loader2
                    v-if="downloading"
                    class="h-4 w-4 animate-spin"
                  />
                  <Download
                    v-else
                    class="h-4 w-4"
                  />
                  下载视频
                </Button>

                <div
                  v-if="result"
                  class="space-y-3 rounded-md border bg-muted/30 p-3"
                >
                  <div class="text-sm font-medium text-foreground">
                    已下载：{{ result.filename }} {{ formatBytes(result.sizeBytes) ? `· ${formatBytes(result.sizeBytes)}` : '' }}
                  </div>
                  <p class="break-all text-xs text-muted-foreground">
                    {{ result.path }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="gap-2"
                      @click="openLocalPath(result.path)"
                    >
                      <ExternalLink class="h-4 w-4" />
                      打开文件
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="gap-2"
                      @click="openLocalDirectory(result.downloadDir)"
                    >
                      <FolderOpen class="h-4 w-4" />
                      打开目录
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppPageContent>

    <Drawer
      v-model:open="historyDrawerOpen"
      direction="right"
    >
      <DrawerContent class="!bottom-auto !left-auto !right-0 !top-0 !mt-0 h-full w-full max-w-xl rounded-none border-l">
        <DrawerHeader class="border-b px-5 pb-4 text-left">
          <DrawerTitle class="line-clamp-2 text-base">
            {{ selectedHistoryItem?.profile.title || '历史详情' }}
          </DrawerTitle>
          <DrawerDescription>
            {{ selectedHistoryItem ? getPlatformLabel(selectedHistoryItem.platform) : '' }}
            {{ selectedHistoryItem?.updatedAt ? `· ${formatHistoryTime(selectedHistoryItem.updatedAt)}` : '' }}
          </DrawerDescription>
        </DrawerHeader>

        <div
          v-if="selectedHistoryItem"
          class="min-h-0 flex-1 overflow-auto px-5 py-4"
        >
          <div class="space-y-5">
            <div class="group relative overflow-hidden rounded-md border bg-black">
              <video
                v-if="selectedHistoryPreviewVideoUrl"
                ref="historyPreviewVideoRef"
                :src="selectedHistoryPreviewVideoUrl"
                :poster="selectedHistoryItem.profile.coverUrl || undefined"
                controls
                playsinline
                preload="metadata"
                class="aspect-video w-full bg-black object-contain"
              />
              <img
                v-else-if="selectedHistoryItem.profile.coverUrl"
                :src="selectedHistoryItem.profile.coverUrl"
                alt=""
                class="aspect-video w-full bg-black object-contain"
              >
              <Button
                v-if="selectedHistoryPreviewVideoUrl"
                type="button"
                variant="secondary"
                size="icon"
                class="absolute right-3 top-3 h-9 w-9 bg-background/80 opacity-90 shadow-sm backdrop-blur transition-opacity hover:bg-background group-hover:opacity-100"
                title="全屏预览"
                aria-label="全屏预览"
                @click="openHistoryPreviewFullscreen"
              >
                <Maximize2 class="h-4 w-4" />
              </Button>
            </div>

            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {{ getPlatformLabel(selectedHistoryItem.platform) }}
                </Badge>
                <Badge :variant="selectedHistoryItem.path ? 'success' : 'secondary'">
                  {{ downloadedStatus(selectedHistoryItem) }}
                </Badge>
              </div>

              <div class="space-y-1">
                <p class="text-xs text-muted-foreground">
                  标题
                </p>
                <p class="text-sm font-medium leading-6">
                  {{ selectedHistoryItem.profile.title || '未命名视频' }}
                </p>
              </div>

              <div
                v-if="selectedHistoryItem.profile.author || selectedHistoryItem.profile.awemeId || formatCreateTime(selectedHistoryItem.profile.createTime)"
                class="grid gap-3 sm:grid-cols-2"
              >
                <div
                  v-if="selectedHistoryItem.profile.author || selectedHistoryItem.profile.awemeId"
                  class="space-y-1"
                >
                  <p class="text-xs text-muted-foreground">
                    作者/标识
                  </p>
                  <div class="flex min-w-0 items-center gap-2 text-sm">
                    <img
                      v-if="selectedHistoryItem.profile.authorIcon"
                      :src="selectedHistoryItem.profile.authorIcon"
                      alt=""
                      class="h-6 w-6 rounded-full object-cover"
                    >
                    <span class="truncate">{{ selectedHistoryItem.profile.author || selectedHistoryItem.profile.awemeId }}</span>
                  </div>
                </div>
                <div
                  v-if="formatCreateTime(selectedHistoryItem.profile.createTime)"
                  class="space-y-1"
                >
                  <p class="text-xs text-muted-foreground">
                    发布时间
                  </p>
                  <p class="text-sm">
                    {{ formatCreateTime(selectedHistoryItem.profile.createTime) }}
                  </p>
                </div>
              </div>

              <div class="space-y-1">
                <p class="text-xs text-muted-foreground">
                  分享链接
                </p>
                <p class="break-all text-sm text-muted-foreground">
                  {{ selectedHistoryItem.sourceUrl }}
                </p>
              </div>

              <div
                v-if="selectedHistoryItem.path"
                class="space-y-2 rounded-md border bg-muted/30 p-3"
              >
                <div class="text-sm font-medium text-foreground">
                  {{ selectedHistoryItem.filename }} {{ formatBytes(selectedHistoryItem.sizeBytes) ? `· ${formatBytes(selectedHistoryItem.sizeBytes)}` : '' }}
                </div>
                <p class="break-all text-xs text-muted-foreground">
                  {{ selectedHistoryItem.path }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DrawerFooter
          v-if="selectedHistoryItem"
          class="border-t px-5 py-4"
        >
          <div class="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              @click="loadHistoryItemToCurrent(selectedHistoryItem)"
            >
              载入当前
            </Button>
            <Button
              v-if="selectedHistoryItem.path"
              type="button"
              variant="outline"
              class="gap-2"
              @click="openLocalPath(selectedHistoryItem.path)"
            >
              <ExternalLink class="h-4 w-4" />
              打开文件
            </Button>
            <Button
              v-if="selectedHistoryItem.downloadDir"
              type="button"
              variant="outline"
              class="gap-2"
              @click="openLocalDirectory(selectedHistoryItem.downloadDir)"
            >
              <FolderOpen class="h-4 w-4" />
              打开目录
            </Button>
            <Button
              type="button"
              variant="destructive"
              class="gap-2"
              :disabled="deletingHistoryId === selectedHistoryItem.id"
              @click="deleteHistoryItem(selectedHistoryItem)"
            >
              <Loader2
                v-if="deletingHistoryId === selectedHistoryItem.id"
                class="h-4 w-4 animate-spin"
              />
              <Trash2
                v-else
                class="h-4 w-4"
              />
              删除
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  </AppPage>
</template>
