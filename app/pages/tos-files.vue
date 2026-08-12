<script setup lang="ts">
import type { TosConfigPublic } from '#shared/types/provider'
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  Users,
  Video
} from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import { tosAdminAssetPrefix, tosUserScopeComponent } from '@/lib/tos-path'

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

type TosConfigResponse = {
  success: boolean
  data: TosConfigPublic
}

type TosMember = {
  id: string
  account: string
  displayName: string
  status: string
}

type TosMembersResponse = {
  success: boolean
  data?: {
    members?: TosMember[]
  }
  message?: string
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
const activePrefix = ref('images')
const pageSize = ref('15')
const pageSizeOptions = [15, 20, 50, 100, 200]
const continuationToken = ref<string | undefined>()
const tokenHistory = ref<string[]>([])
const currentPage = ref(1)
const responseData = ref<TosFilesResponse['data'] | null>(null)
const members = ref<TosMember[]>([])
const membersLoading = ref(false)
const selectedMemberAccount = ref('__all__')
const selectedAdminCategory = ref<'all' | 'images' | 'videos'>('all')
const failedPreviewMediaKeys = ref<Record<string, true>>({})
const hoverPreviewFile = ref<TosFileEntry | null>(null)
const hoverPreviewPosition = ref({ x: 0, y: 0 })
const imagePreviewOpen = ref(false)
const imagePreviewSrc = ref('')
const imagePreviewAlt = ref('图片预览')
const videoPreviewFile = ref<TosFileEntry | null>(null)
const downloadingFileKey = ref<string | null>(null)
const searchQuery = ref('')
const { toast } = useToast()
const { currentUser, loadStatus } = useCloudAdmin()
const isAdmin = computed(() => currentUser.value?.role === 'admin')
const selectedMember = computed(() => members.value.find(member => member.account === selectedMemberAccount.value))
const selectedOwnerLabel = computed(() => {
  if (selectedMember.value) return `正在查看 ${selectedMember.value.displayName} 的素材`
  return `共 ${members.value.length} 位成员`
})
const memberByAccount = computed(() => new Map(members.value.map(member => [member.account, member])))
const memberByScope = computed(() => new Map(members.value.map(member => [tosUserScopeComponent(member.account), member])))

const adminCategoryTabs = [
  { id: 'all', label: '全部' },
  { id: 'images', label: '图片' },
  { id: 'videos', label: '视频' }
] as const

function normalizePrefixValue(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function buildTosCategoryPrefix(category: string): string {
  return normalizePrefixValue(category)
}

const assetTabs = computed(() => [
  { id: 'image', label: '图片', prefix: buildTosCategoryPrefix('images') },
  { id: 'video', label: '视频', prefix: buildTosCategoryPrefix('videos') }
] as const)

const pageSizeNumber = computed(() => {
  const parsed = Number.parseInt(pageSize.value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 15
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

function accountFromMemberPrefix(prefix: string): string | null {
  const segments = normalizePrefixValue(prefix).split('/')
  if (segments[0] !== 'users' || !segments[1]) return null
  return segments[1]
}

function directoryNameFromPrefix(prefix: string): string {
  const normalized = normalizePrefixValue(prefix)
  const account = accountFromMemberPrefix(normalized)
  if (normalized.split('/').length === 2 && account) {
    const member = memberByScope.value.get(account) || memberByAccount.value.get(account)
    return member ? `${member.displayName}（${member.account}）` : account
  }
  return normalized.split('/').at(-1) || normalized
}

function buildAdminPrefix(account: string, category: 'all' | 'images' | 'videos'): string {
  return tosAdminAssetPrefix(account, category)
}

const filteredCommonPrefixes = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return responseData.value?.commonPrefixes || []
  return (responseData.value?.commonPrefixes || []).filter(prefix =>
    directoryNameFromPrefix(prefix).toLocaleLowerCase().includes(query)
    || prefix.toLocaleLowerCase().includes(query)
  )
})

const filteredFiles = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return responseData.value?.files || []
  return (responseData.value?.files || []).filter(file =>
    fileNameFromKey(file.key).toLocaleLowerCase().includes(query)
    || file.key.toLocaleLowerCase().includes(query)
  )
})

const breadcrumbItems = computed(() => {
  const segments = normalizePrefixValue(activePrefix.value).split('/').filter(Boolean)
  return segments.map((segment, index) => {
    let label = segment
    if (segment === 'users') label = '全部成员'
    else if (segment === 'images') label = '图片'
    else if (segment === 'videos') label = '视频'
    else if (index === 1 && segments[0] === 'users') {
      const member = memberByScope.value.get(segment)
      label = member ? member.displayName : segment
    }
    return { label, prefix: segments.slice(0, index + 1).join('/') }
  })
})

const activeAssetTabId = computed<string | null>(() => {
  const normalizedPrefix = normalizePrefixValue(activePrefix.value)
  for (const tab of assetTabs.value) {
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
  return isImageFile(file.key) && !failedPreviewMediaKeys.value[file.key]
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

function openMediaPreview(file: TosFileEntry) {
  if (isImageFile(file.key)) {
    openImagePreview(file)
  } else if (isVideoFile(file.key) && file.url) {
    videoPreviewFile.value = file
  }
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
      return true
    }
    return false
  } catch (error) {
    const fetchError = error as FetchErrorWithData
    errorMessage.value = fetchError.data?.data?.message
      || fetchError.data?.message
      || fetchError.data?.statusMessage
      || (error instanceof Error ? error.message : '读取 TOS 文件失败')
    return false
  } finally {
    loading.value = false
  }
}

async function downloadFile(file: TosFileEntry) {
  if (downloadingFileKey.value) return

  downloadingFileKey.value = file.key
  errorMessage.value = ''
  try {
    const response = await $fetch<{ success: boolean, data: { url: string } }>('/api/tos/download-url', {
      query: {
        key: file.key,
        filename: fileNameFromKey(file.key)
      }
    })
    const downloadUrl = response.data?.url
    if (!downloadUrl) throw new Error('下载地址为空')

    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = fileNameFromKey(file.key)
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    toast.success('下载已开始', {
      description: `${fileNameFromKey(file.key)} 将保存到系统下载目录`
    })
  } catch (error) {
    const fetchError = error as FetchErrorWithData
    errorMessage.value = fetchError.data?.data?.message
      || fetchError.data?.message
      || fetchError.data?.statusMessage
      || (error instanceof Error ? error.message : '下载文件失败')
  } finally {
    downloadingFileKey.value = null
  }
}

async function loadTosConfig() {
  const response = await $fetch<TosConfigResponse>('/api/tos/config')
  if (!response.success) return

  if (currentUser.value?.role === 'admin') {
    const account = currentUser.value.account?.trim() || '__all__'
    selectedMemberAccount.value = account
    selectedAdminCategory.value = account === '__all__' ? 'all' : 'images'
    activePrefix.value = buildAdminPrefix(account, selectedAdminCategory.value)
  } else {
    activePrefix.value = buildTosCategoryPrefix('images')
  }
}

async function loadMembers() {
  if (!isAdmin.value) return
  membersLoading.value = true
  try {
    const [cloudMembersResult, tosDirectoriesResult] = await Promise.allSettled([
      $fetch<TosMembersResponse>('/api/tos/members'),
      $fetch<TosFilesResponse>('/api/tos/files', {
        query: {
          prefix: 'users',
          delimiter: '/',
          maxKeys: 1000
        }
      })
    ])

    const merged = new Map<string, TosMember>()
    const addMember = (member: TosMember) => {
      const account = member.account.trim()
      const scope = tosUserScopeComponent(account)
      if (!account || !scope || merged.has(scope)) return
      merged.set(scope, { ...member, account })
    }

    const currentAccount = currentUser.value?.account?.trim()
    if (currentAccount) {
      addMember({
        id: `current_${currentAccount}`,
        account: currentAccount,
        displayName: currentUser.value?.displayName?.trim() || currentAccount,
        status: 'active'
      })
    }

    if (cloudMembersResult.status === 'fulfilled') {
      const response = cloudMembersResult.value
      if (response.success && Array.isArray(response.data?.members)) {
        response.data.members.forEach(addMember)
      }
    }

    if (tosDirectoriesResult.status === 'fulfilled' && tosDirectoriesResult.value.success) {
      for (const prefix of tosDirectoriesResult.value.data.commonPrefixes) {
        const account = accountFromMemberPrefix(prefix)
        if (!account || merged.has(account)) continue
        addMember({
          id: `tos_${account}`,
          account,
          displayName: account,
          status: 'active'
        })
      }
    }

    if (merged.size === 0
      && cloudMembersResult.status === 'rejected'
      && tosDirectoriesResult.status === 'rejected') {
      throw cloudMembersResult.reason
    }
    members.value = Array.from(merged.values())
  } catch (error) {
    const fetchError = error as FetchErrorWithData
    errorMessage.value = fetchError.data?.data?.message
      || fetchError.data?.message
      || fetchError.data?.statusMessage
      || (error instanceof Error ? error.message : '读取成员列表失败')
  } finally {
    membersLoading.value = false
  }
}

async function initializePage() {
  try {
    await loadStatus()
    await loadTosConfig()
  } catch {
    // The files endpoint will surface missing or invalid TOS configuration.
  }
  await Promise.all([
    loadFiles({ reset: true }),
    loadMembers()
  ])
}

function resetPagination() {
  closeHoverPreview()
  continuationToken.value = undefined
  tokenHistory.value = []
  currentPage.value = 1
}

function openPrefix(prefix: string) {
  activePrefix.value = normalizePrefixValue(prefix)
  searchQuery.value = ''
  if (isAdmin.value) {
    const accountScope = accountFromMemberPrefix(activePrefix.value)
    const member = accountScope ? memberByScope.value.get(accountScope) : undefined
    if (member) selectedMemberAccount.value = member.account
    const segments = activePrefix.value.split('/')
    if (segments.includes('images')) selectedAdminCategory.value = 'images'
    else if (segments.includes('videos')) selectedAdminCategory.value = 'videos'
    else selectedAdminCategory.value = 'all'
  }
  resetPagination()
  void loadFiles({ reset: true })
}

function switchMember(account: string) {
  selectedMemberAccount.value = account
  if (account === '__all__') selectedAdminCategory.value = 'all'
  openPrefix(buildAdminPrefix(account, selectedAdminCategory.value))
}

function switchAdminCategory(category: 'all' | 'images' | 'videos') {
  if (selectedMemberAccount.value === '__all__' && category !== 'all') return
  selectedAdminCategory.value = category
  openPrefix(buildAdminPrefix(selectedMemberAccount.value, category))
}

function returnToMembers() {
  switchMember('__all__')
}

function switchAssetTab(prefix: string) {
  const normalizedPrefix = normalizePrefixValue(prefix)
  if (!normalizedPrefix) return
  if (activePrefix.value === normalizedPrefix) return
  activePrefix.value = normalizedPrefix
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

async function goNextPage() {
  const nextToken = responseData.value?.nextContinuationToken
  if (!nextToken) return
  const previousToken = continuationToken.value || ''
  continuationToken.value = nextToken
  const loaded = await loadFiles()
  if (!loaded) {
    continuationToken.value = previousToken || undefined
    return
  }
  tokenHistory.value.push(previousToken)
  currentPage.value += 1
}

async function goPreviousPage() {
  if (tokenHistory.value.length === 0) return
  const previousToken = tokenHistory.value.at(-1)
  const currentToken = continuationToken.value
  continuationToken.value = previousToken || undefined
  const loaded = await loadFiles()
  if (!loaded) {
    continuationToken.value = currentToken
    return
  }
  tokenHistory.value.pop()
  currentPage.value = Math.max(1, currentPage.value - 1)
}

async function goFirstPage() {
  if (currentPage.value <= 1) return
  const loaded = await loadFiles({ reset: true })
  if (loaded) resetPagination()
}

async function copyText(value: string, label: string) {
  if (!value || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label}已复制`)
  } catch {
    toast.error(`复制${label}失败`)
  }
}

onMounted(() => {
  void initializePage()
})
</script>

<template>
  <AppPage>
    <AppPageHeader
      title="云端素材"
      :description="isAdmin ? '按成员浏览和管理云端图片、视频素材' : '浏览云端图片和视频素材'"
    >
      <template #actions>
          <div v-if="!isAdmin" class="flex rounded-xl bg-muted/25 p-1">
            <button
              v-for="tab in assetTabs"
              :key="tab.id"
              type="button"
              class="inline-flex items-center rounded-sm px-3 py-1.5 text-sm transition-colors"
              :class="activeAssetTabId === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              :disabled="loading"
              @click="switchAssetTab(tab.prefix)"
            >
              {{ tab.label }}
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            class="gap-2"
            :disabled="loading"
            @click="loadFiles({ reset: true })"
          >
            <RefreshCw
              class="h-4 w-4"
              :class="loading ? 'animate-spin' : ''"
            />
            刷新
          </Button>
      </template>
    </AppPageHeader>

    <AppPageContent inner-class="flex h-full min-h-0 flex-col gap-4">
      <div
        v-if="isAdmin"
        class="shrink-0 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            v-if="selectedMemberAccount !== '__all__'"
            type="button"
            variant="ghost"
            size="icon"
            class="shrink-0"
            title="返回全部成员"
            :disabled="loading"
            @click="returnToMembers"
          >
            <ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="flex min-w-0 items-center gap-2">
            <Users class="h-4 w-4 shrink-0 text-muted-foreground" />
            <Select
              :model-value="selectedMemberAccount"
              :disabled="loading || membersLoading"
              @update:model-value="switchMember(String($event))"
            >
              <SelectTrigger class="w-full sm:w-[260px]">
                <SelectValue :placeholder="membersLoading ? '加载成员...' : '选择成员'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  全部成员
                </SelectItem>
                <SelectItem
                  v-for="member in members"
                  :key="member.id"
                  :value="member.account"
                >
                  {{ member.displayName }}（{{ member.account }}）{{ member.status === 'active' ? '' : ' · 已停用' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="truncate text-xs text-muted-foreground">
            {{ selectedOwnerLabel }}
          </p>
        </div>

        <div class="flex w-fit rounded-xl bg-muted/25 p-1">
          <button
            v-for="tab in adminCategoryTabs"
            :key="tab.id"
            type="button"
            class="inline-flex min-w-[64px] items-center justify-center rounded-sm px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            :class="selectedAdminCategory === tab.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
            :disabled="loading || (selectedMemberAccount === '__all__' && tab.id !== 'all')"
            @click="switchAdminCategory(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <div
        v-if="errorMessage"
        class="shrink-0 rounded-xl bg-destructive/8 p-4 text-sm text-destructive"
      >
        {{ errorMessage }}
      </div>

      <div class="min-h-0 flex-1 overflow-hidden rounded-xl bg-muted/25 flex flex-col">
        <div class="shrink-0 flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <nav class="flex min-w-0 items-center overflow-x-auto text-sm" aria-label="当前目录">
            <template v-for="(item, index) in breadcrumbItems" :key="item.prefix">
              <ChevronRight v-if="index" class="mx-1 h-4 w-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                class="max-w-[180px] shrink-0 truncate rounded px-1.5 py-1 hover:bg-muted disabled:font-medium disabled:text-foreground"
                :class="index === breadcrumbItems.length - 1 ? 'text-foreground' : 'text-muted-foreground'"
                :disabled="loading || index === breadcrumbItems.length - 1"
                @click="openPrefix(item.prefix)"
              >
                {{ item.label }}
              </button>
            </template>
          </nav>
          <div class="relative w-full shrink-0 lg:w-[280px]">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="searchQuery" class="pl-9" placeholder="搜索当前页名称或 Key" />
          </div>
        </div>

        <div
          v-if="loading && !responseData"
          class="flex min-h-0 flex-1 items-center justify-center py-16 text-sm text-muted-foreground"
        >
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          加载 TOS 文件...
        </div>

        <div
          v-else-if="responseData && filteredCommonPrefixes.length === 0 && filteredFiles.length === 0"
          class="flex min-h-0 flex-1 items-center justify-center py-16 text-center text-sm text-muted-foreground"
        >
          {{ searchQuery.trim() ? '当前页没有匹配的素材' : '当前目录下没有素材' }}
        </div>

        <Table
          v-else
          class="table-fixed"
          container-class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <colgroup>
            <col>
            <col class="w-[88px]">
            <col class="w-[92px]">
            <col class="w-[190px]">
            <col class="w-[140px]">
            <col class="w-[160px]">
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>
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
              <TableHead class="w-[160px] whitespace-nowrap bg-background text-center">
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="prefix in filteredCommonPrefixes"
              :key="`prefix_${prefix}`"
            >
              <TableCell class="min-w-0 overflow-hidden">
                <Button
                  type="button"
                  variant="link"
                  class="h-auto w-full min-w-0 justify-start gap-2 overflow-hidden p-0 text-left text-sm font-medium"
                  @click="openPrefix(prefix)"
                >
                  <UserRound
                    v-if="isAdmin && normalizePrefixValue(prefix).split('/').length === 2"
                    class="h-4 w-4 shrink-0"
                  />
                  <Folder v-else class="h-4 w-4 shrink-0" />
                  <span class="truncate">{{ directoryNameFromPrefix(prefix) }}</span>
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
              <TableCell class="w-[160px] bg-background text-center" />
            </TableRow>

            <TableRow
              v-for="file in filteredFiles"
              :key="file.key"
              :class="isMediaFile(file.key) ? 'cursor-pointer hover:bg-muted/50' : undefined"
              @click="openMediaPreview(file)"
            >
              <TableCell class="min-w-0 overflow-hidden">
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
              <TableCell class="w-[160px] bg-background text-center">
                <div class="inline-flex w-full items-center justify-center gap-1">
                  <Button type="button" variant="ghost" size="icon" title="复制对象 Key" @click.stop="copyText(file.key, '对象 Key')">
                    <Copy class="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" title="复制素材地址" :disabled="!file.url" @click.stop="copyText(file.url, '素材地址')">
                    <Copy class="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="下载文件"
                    :disabled="downloadingFileKey !== null"
                    @click.stop="downloadFile(file)"
                  >
                    <Loader2
                      v-if="downloadingFileKey === file.key"
                      class="h-4 w-4 animate-spin"
                    />
                    <Download v-else class="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <div
          v-if="responseData"
          class="shrink-0 flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
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
    </AppPageContent>
    <Teleport to="body">
      <div
        v-if="hoverPreviewFile"
        class="pointer-events-none fixed z-[70] hidden md:block"
        :style="{ left: `${hoverPreviewPosition.x}px`, top: `${hoverPreviewPosition.y}px` }"
      >
        <div class="w-80 rounded-xl bg-muted/25/95 p-2 shadow-2xl backdrop-blur-sm">
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
    <Teleport to="body">
      <div
        v-if="videoPreviewFile"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="fileNameFromKey(videoPreviewFile.key)"
        @click.self="videoPreviewFile = null"
      >
        <div class="relative flex max-h-full w-full max-w-5xl flex-col gap-3">
          <div class="flex items-center justify-between gap-4 text-white">
            <p class="truncate text-sm font-medium">{{ fileNameFromKey(videoPreviewFile.key) }}</p>
            <Button variant="secondary" size="sm" @click="videoPreviewFile = null">关闭</Button>
          </div>
          <video :src="videoPreviewFile.url" class="max-h-[80vh] w-full bg-black object-contain" controls autoplay playsinline />
        </div>
      </div>
    </Teleport>
  </AppPage>
</template>
