<script setup lang="ts">
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileVideo2,
  FolderOpen,
  History,
  Link2,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Search,
  Trash2
} from 'lucide-vue-next'
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
const { confirm } = useConfirm()
const { bootstrap: cloudBootstrap } = useCloudAdmin()

const shareUrl = ref('')
const filename = ref('')
const profile = ref<ShortVideoProfile | null>(null)
const result = ref<DownloadResult | null>(null)
const historyItems = ref<HistoryItem[]>([])
const previewVideoRef = ref<HTMLVideoElement | null>(null)
const historyPreviewVideoRef = ref<HTMLVideoElement | null>(null)
const selectedHistoryItem = ref<HistoryItem | null>(null)
const historyFilename = ref('')
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
  void cloudBootstrap().catch((error) => {
    console.warn('Failed to refresh cloud runtime config for short video tools:', error)
  })
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

function openHistoryDrawer(item: HistoryItem) {
  selectedHistoryItem.value = item
  historyFilename.value = item.filename || item.profile.title || `${getPlatformLabel(item.platform)}视频`
  historyDrawerOpen.value = true
}

async function downloadHistoryItem(item: HistoryItem) {
  downloading.value = true
  try {
    const response = await $fetch<{ success: boolean, data?: DownloadResult, message?: string }>('/api/tools/short-video/download', {
      method: 'POST',
      body: {
        url: item.sourceUrl,
        filename: historyFilename.value
      }
    })
    if (!response.success || !response.data) throw new Error(response.message || '下载失败')
    toast.success('下载完成', { description: response.data.filename })
    await loadHistory()
    selectedHistoryItem.value = historyItems.value.find(history => history.platform === item.platform && history.id === item.id) || {
      ...item,
      profile: response.data.profile,
      path: response.data.path,
      filename: response.data.filename,
      downloadDir: response.data.downloadDir,
      sizeBytes: response.data.sizeBytes,
      downloadedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    historyFilename.value = response.data.filename
  } catch (error) {
    toast.error('下载失败', { description: getErrorMessage(error) })
  } finally {
    downloading.value = false
  }
}

async function deleteHistoryItem(item: HistoryItem) {
  const confirmed = await confirm({
    title: '删除这条历史记录？',
    description: `“${item.profile.title || '未命名视频'}”将从解析历史中移除，本地已下载文件不会被删除。`,
    confirmText: '删除记录',
    variant: 'destructive'
  })
  if (!confirmed) return

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
      class="min-h-16"
    />

    <AppPageContent class="overflow-auto px-4 pb-8 md:px-6">
      <div class="mx-auto w-full max-w-5xl">
        <Card class="border-0 bg-transparent shadow-none backdrop-blur-none">
          <CardContent class="flex flex-col gap-6 p-0">
            <form
              class="order-1 rounded-lg border border-border/70 bg-card p-3 shadow-[0_12px_34px_hsl(var(--foreground)/0.05)] sm:p-4"
              @submit.prevent="parseShareUrl"
            >
              <label
                for="short-video-share-url"
                class="mb-2 block text-sm font-semibold text-foreground"
              >分享链接</label>
              <div class="flex flex-col gap-2 sm:flex-row">
                <div class="relative min-w-0 flex-1">
                  <Link2 class="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="short-video-share-url"
                    v-model="shareUrl"
                    class="h-11 bg-background pl-10"
                    placeholder="粘贴抖音或视频号分享链接"
                    autocomplete="off"
                  />
                </div>
                <Button
                  type="submit"
                  class="h-11 shrink-0 gap-2 px-5 sm:min-w-28"
                  :disabled="!canParse"
                >
                  <Loader2
                    v-if="parsing"
                    class="h-4 w-4 animate-spin"
                  />
                  <Search
                    v-else
                    class="h-4 w-4"
                  />
                  {{ parsing ? '解析中' : '解析视频' }}
                </Button>
              </div>
            </form>

            <div
              v-if="errorMessage"
              role="alert"
              class="order-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
            >
              <span class="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-destructive" />
              {{ errorMessage }}
            </div>

            <section
              v-if="parsing && !profile"
              class="order-3 grid animate-pulse gap-6 rounded-lg border border-border/60 bg-card/60 p-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]"
              aria-label="正在解析视频"
            >
              <div class="mx-auto aspect-[9/16] h-[min(52vh,520px)] rounded-md bg-muted" />
              <div class="space-y-5 py-2">
                <div class="h-5 w-24 rounded bg-muted" />
                <div class="space-y-2">
                  <div class="h-6 w-full rounded bg-muted" />
                  <div class="h-6 w-4/5 rounded bg-muted" />
                </div>
                <div class="h-16 rounded bg-muted" />
                <div class="h-10 rounded bg-muted" />
              </div>
            </section>

            <div
              v-if="historyItems.length > 0"
              class="order-5 space-y-3 border-t border-border/70 pt-5"
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

              <div class="overflow-hidden rounded-md border border-border/70 bg-card/55">
                <article
                  v-for="item in historyItems"
                  :key="`${item.platform}:${item.id}`"
                  tabindex="0"
                  class="group flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-3 transition-colors last:border-b-0 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-4 sm:px-4"
                  :class="profile?.historyId === item.id && profile.platform === item.platform ? 'bg-accent/35' : ''"
                  @click="openHistoryDrawer(item)"
                  @keydown.enter.prevent="openHistoryDrawer(item)"
                >
                  <div class="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-[hsl(224_18%_9%)] sm:h-16 sm:w-24">
                    <img
                      v-if="item.profile.coverUrl"
                      :src="item.profile.coverUrl"
                      :alt="`${item.profile.title || '未命名视频'}封面`"
                      class="h-full w-full object-cover"
                    >
                    <FileVideo2 v-else class="h-5 w-5 text-white/55" />
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" class="hidden shrink-0 rounded-md sm:inline-flex">
                        {{ getPlatformLabel(item.platform) }}
                      </Badge>
                      <p class="truncate text-sm font-semibold text-foreground">
                        {{ item.profile.title || '未命名视频' }}
                      </p>
                    </div>
                    <div class="mt-1.5 flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
                      <span class="truncate">{{ item.profile.author || item.profile.awemeId || getPlatformLabel(item.platform) }}</span>
                      <span class="hidden shrink-0 items-center gap-1 md:inline-flex">
                        <Clock3 class="h-3 w-3" />
                        {{ formatHistoryTime(item.updatedAt) || '-' }}
                      </span>
                    </div>
                  </div>

                  <Badge
                    :variant="item.path ? 'success' : 'secondary'"
                    class="hidden shrink-0 sm:inline-flex"
                  >
                    {{ downloadedStatus(item) }}
                  </Badge>

                  <ChevronRight class="hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:block" />
                </article>
              </div>
            </div>

            <section
              v-else-if="!loadingHistory"
              class="order-5 flex items-center gap-3 border-t border-border/70 py-6 text-muted-foreground"
              aria-label="解析历史为空"
            >
              <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <History class="h-4 w-4" />
              </div>
              <div>
                <p class="text-sm font-medium text-foreground">暂无解析记录</p>
                <p class="mt-0.5 text-xs">解析过的视频会显示在这里</p>
              </div>
            </section>

            <div
              v-if="profile"
              class="order-3 grid gap-6 rounded-lg border border-border/70 bg-card p-4 shadow-[0_16px_42px_hsl(var(--foreground)/0.055)] sm:p-5 lg:grid-cols-[minmax(260px,0.82fr)_minmax(0,1.18fr)] lg:gap-8"
            >
              <div class="flex min-w-0 items-center justify-center rounded-md bg-[hsl(224_18%_9%)] p-3 sm:p-4">
                <div class="group relative aspect-[9/16] h-[min(58vh,580px)] max-h-[580px] max-w-full overflow-hidden rounded-md bg-black shadow-[0_20px_44px_hsl(224_30%_4%/0.32)]">
                  <video
                    v-if="previewVideoUrl"
                    ref="previewVideoRef"
                    :src="previewVideoUrl"
                    :poster="profile.coverUrl || undefined"
                    controls
                    playsinline
                    preload="metadata"
                    class="h-full w-full bg-black object-contain"
                  />
                  <Button
                    v-if="previewVideoUrl"
                    type="button"
                    variant="secondary"
                    size="icon"
                    class="absolute right-3 top-3 h-9 w-9 bg-background/85 opacity-90 shadow-sm backdrop-blur transition-opacity hover:bg-background group-hover:opacity-100"
                    title="全屏预览"
                    aria-label="全屏预览"
                    @click="openPreviewFullscreen"
                  >
                    <Maximize2 class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div class="flex min-w-0 flex-col gap-5 lg:border-l lg:border-border/70 lg:pl-8">
                <div class="min-w-0 space-y-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" class="rounded-md">
                      {{ platformLabel }}
                    </Badge>
                    <span class="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                      <CheckCircle2 class="h-3.5 w-3.5" />
                      解析完成
                    </span>
                  </div>
                  <h2 class="line-clamp-4 text-xl font-semibold leading-8 sm:text-2xl">
                    {{ profile.title || '未命名视频' }}
                  </h2>
                  <div
                    v-if="profile.author || formatCreateTime(profile.createTime)"
                    class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
                  >
                    <img
                      v-if="profile.authorIcon"
                      :src="profile.authorIcon"
                      :alt="`${profile.author || '视频作者'}头像`"
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
                  <div class="flex items-start gap-2 rounded-md bg-muted/55 px-3 py-2.5 text-xs text-muted-foreground">
                    <Link2 class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p class="min-w-0 break-all">{{ profile.sourceUrl }}</p>
                  </div>
                </div>

                <div class="space-y-4 border-t border-border/70 pt-5">
                  <div class="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p class="text-xs text-muted-foreground">格式</p>
                      <p class="mt-1 font-medium">MP4</p>
                    </div>
                    <div>
                      <p class="text-xs text-muted-foreground">质量</p>
                      <p class="mt-1 font-medium">原始视频</p>
                    </div>
                    <div>
                      <p class="text-xs text-muted-foreground">保存到</p>
                      <p class="mt-1 truncate font-medium">默认下载目录</p>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <label for="short-video-filename" class="text-sm font-semibold text-foreground">保存文件名</label>
                    <Input
                      id="short-video-filename"
                      v-model="filename"
                      class="h-11"
                      placeholder="保存为..."
                    />
                  </div>

                  <Button
                    type="button"
                    class="h-11 w-full gap-2"
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
                    {{ downloading ? '正在下载' : '下载视频' }}
                  </Button>
                </div>

                <div
                  v-if="result"
                  class="space-y-3 rounded-md border border-success/25 bg-success/5 p-3.5"
                >
                  <div class="flex items-start gap-2">
                    <CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-foreground">
                        下载完成
                      </div>
                      <p class="mt-0.5 truncate text-xs text-muted-foreground">
                        {{ result.filename }} {{ formatBytes(result.sizeBytes) ? `· ${formatBytes(result.sizeBytes)}` : '' }}
                      </p>
                    </div>
                  </div>
                  <p class="break-all pl-6 text-xs text-muted-foreground">
                    {{ result.path }}
                  </p>
                  <div class="flex flex-wrap gap-2 pl-6">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="gap-2 bg-background/70"
                      @click="openLocalPath(result.path)"
                    >
                      <ExternalLink class="h-4 w-4" />
                      打开文件
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="gap-2 bg-background/70"
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
                      :alt="`${selectedHistoryItem.profile.author || '视频作者'}头像`"
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

              <div class="space-y-2 border-t border-border/70 pt-4">
                <label for="history-video-filename" class="text-sm font-semibold text-foreground">
                  保存文件名
                </label>
                <Input
                  id="history-video-filename"
                  v-model="historyFilename"
                  class="h-11"
                  placeholder="保存为..."
                />
              </div>

              <div
                v-if="selectedHistoryItem.path"
                class="space-y-2 rounded-md border border-success/25 bg-success/5 p-3"
              >
                <div class="flex items-center gap-2 text-sm font-medium text-foreground">
                  <CheckCircle2 class="h-4 w-4 text-success" />
                  已下载 {{ formatBytes(selectedHistoryItem.sizeBytes) ? `· ${formatBytes(selectedHistoryItem.sizeBytes)}` : '' }}
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
              class="gap-2"
              :disabled="downloading || !historyFilename.trim()"
              @click="downloadHistoryItem(selectedHistoryItem)"
            >
              <Loader2 v-if="downloading" class="h-4 w-4 animate-spin" />
              <Download v-else class="h-4 w-4" />
              {{ downloading ? '正在下载' : selectedHistoryItem.path ? '重新下载' : '下载视频' }}
            </Button>
            <DropdownMenu v-if="selectedHistoryItem.path || selectedHistoryItem.downloadDir">
              <DropdownMenuTrigger as-child>
                <Button type="button" variant="outline" size="icon" title="打开下载结果" aria-label="打开下载结果">
                  <MoreHorizontal class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  v-if="selectedHistoryItem.path"
                  @click="openLocalPath(selectedHistoryItem.path)"
                >
                  <ExternalLink class="mr-2 h-4 w-4" />
                  打开文件
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="selectedHistoryItem.downloadDir"
                  @click="openLocalDirectory(selectedHistoryItem.downloadDir)"
                >
                  <FolderOpen class="mr-2 h-4 w-4" />
                  打开目录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
