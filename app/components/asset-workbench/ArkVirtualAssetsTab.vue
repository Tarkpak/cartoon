<script setup lang="ts">
import {
  Check,
  Copy,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X
} from 'lucide-vue-next'
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from 'reka-ui'
import type {
  ArkVirtualAssetGroup,
  ArkVirtualAssetListItem
} from '~/lib/ark-virtual-assets'
import {
  createArkVirtualAssetGroup,
  deleteArkVirtualAsset,
  deleteArkVirtualAssetGroup,
  listArkVirtualAssetGroups,
  listArkVirtualAssets,
  uploadArkVirtualAsset,
  updateArkVirtualAsset,
  updateArkVirtualAssetGroup
} from '~/lib/ark-virtual-assets'
import {
  assertValidImageFile,
  fileToDataUrl,
  resetFileInput
} from '~/lib/asset-workbench-upload'
import { statusLabel } from '#shared/utils/display-labels'

const { toast } = useToast()
const MAX_UPLOAD_IMAGE_BYTES = 50 * 1024 * 1024

const groupNameFilter = ref('')
const projectNameFilter = ref('')
const assetNameFilter = ref('')
const assetStatusFilter = ref('')
const selectedGroupId = ref('')

const groups = ref<ArkVirtualAssetGroup[]>([])
const assets = ref<ArkVirtualAssetListItem[]>([])
const groupTotal = ref(0)
const assetTotal = ref(0)
const groupPage = ref(1)
const assetPage = ref(1)
const pageSize = 20

const loadingGroups = ref(false)
const loadingAssets = ref(false)
const mutatingId = ref<string | null>(null)
const copiedAssetId = ref<string | null>(null)
const uploadFileInputRef = ref<HTMLInputElement | null>(null)

const groupDialogOpen = ref(false)
const groupDialogMode = ref<'create' | 'edit'>('create')
const groupDraft = reactive({
  id: '',
  name: '',
  title: '',
  description: '',
  projectName: ''
})

const assetDialogOpen = ref(false)
const assetDraft = reactive({
  id: '',
  name: '',
  projectName: ''
})

const uploadDialogOpen = ref(false)
const uploadDraft = reactive({
  name: '',
  sourceUrl: '',
  imageData: '',
  fileName: '',
  projectName: ''
})

const groupTotalPages = computed(() => Math.max(1, Math.ceil(groupTotal.value / pageSize)))
const assetTotalPages = computed(() => Math.max(1, Math.ceil(assetTotal.value / pageSize)))

const selectedGroup = computed(() => {
  return groups.value.find(group => group.Id === selectedGroupId.value)
})

const uploadPreviewUrl = computed(() => {
  return uploadDraft.imageData || uploadDraft.sourceUrl.trim()
})

function normalizeDisplayText(value: unknown, fallback = '-'): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function statusClass(status: unknown): string {
  if (status === 'Active') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'Failed') return 'border-destructive/20 bg-destructive/5 text-destructive'
  if (status === 'Processing') return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-muted bg-muted/30 text-muted-foreground'
}

function assetTypeLabel(value: unknown): string {
  if (value === 'Image') return '图片'
  if (value === 'Video') return '视频'
  if (value === 'Audio') return '音频'
  return '-'
}

function assetPreviewUrl(asset: ArkVirtualAssetListItem): string {
  const url = typeof asset.URL === 'string' ? asset.URL.trim() : ''
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) {
    return url
  }
  return ''
}

function groupSubtitle(group: ArkVirtualAssetGroup): string {
  return `${normalizeDisplayText(group.ProjectName, 'default')} · ${formatDateTime(group.UpdateTime || group.CreateTime)}`
}

async function refreshGroups(options: { resetPage?: boolean, refreshAssets?: boolean } = {}) {
  if (options.resetPage) groupPage.value = 1
  loadingGroups.value = true
  try {
    const page = await listArkVirtualAssetGroups({
      name: groupNameFilter.value.trim() || undefined,
      projectName: projectNameFilter.value.trim() || undefined,
      pageNumber: groupPage.value,
      pageSize
    })
    groups.value = page.items
    groupTotal.value = page.totalCount
    if (!selectedGroupId.value || !groups.value.some(group => group.Id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0]?.Id || ''
    }
    if (options.refreshAssets !== false) {
      await refreshAssets({ resetPage: true })
    }
  } catch (error) {
    toast.error('查询素材组失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    loadingGroups.value = false
  }
}

async function refreshAssets(options: { resetPage?: boolean } = {}) {
  if (options.resetPage) assetPage.value = 1
  loadingAssets.value = true
  try {
    const page = await listArkVirtualAssets({
      groupId: selectedGroupId.value || undefined,
      name: assetNameFilter.value.trim() || undefined,
      status: assetStatusFilter.value || undefined,
      projectName: projectNameFilter.value.trim() || selectedGroup.value?.ProjectName || undefined,
      pageNumber: assetPage.value,
      pageSize
    })
    assets.value = page.items
    assetTotal.value = page.totalCount
  } catch (error) {
    toast.error('查询素材失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    loadingAssets.value = false
  }
}

function openCreateGroupDialog() {
  groupDialogMode.value = 'create'
  groupDraft.id = ''
  groupDraft.name = ''
  groupDraft.title = ''
  groupDraft.description = ''
  groupDraft.projectName = projectNameFilter.value.trim() || ''
  groupDialogOpen.value = true
}

function openEditGroupDialog(group: ArkVirtualAssetGroup) {
  groupDialogMode.value = 'edit'
  groupDraft.id = group.Id
  groupDraft.name = group.Name || group.Title || ''
  groupDraft.title = group.Title || group.Name || ''
  groupDraft.description = group.Description || ''
  groupDraft.projectName = group.ProjectName || projectNameFilter.value.trim() || ''
  groupDialogOpen.value = true
}

async function submitGroupDialog() {
  const name = groupDraft.name.trim()
  const title = groupDraft.title.trim()
  const description = groupDraft.description.trim()
  const projectName = groupDraft.projectName.trim() || undefined
  if (!name && groupDialogMode.value === 'create') {
    toast.warning('请填写素材组名称')
    return
  }

  mutatingId.value = groupDraft.id || 'create-group'
  try {
    if (groupDialogMode.value === 'create') {
      const groupId = await createArkVirtualAssetGroup({
        name,
        description,
        projectName
      })
      selectedGroupId.value = groupId
      toast.success('素材组已创建')
    } else {
      await updateArkVirtualAssetGroup({
        groupId: groupDraft.id,
        name: name || undefined,
        title: title || undefined,
        description: description || undefined,
        projectName
      })
      toast.success('素材组已更新')
    }
    groupDialogOpen.value = false
    await refreshGroups({ refreshAssets: true })
  } catch (error) {
    toast.error(groupDialogMode.value === 'create' ? '创建素材组失败' : '更新素材组失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    mutatingId.value = null
  }
}

function openEditAssetDialog(asset: ArkVirtualAssetListItem) {
  assetDraft.id = asset.Id
  assetDraft.name = asset.Name || ''
  assetDraft.projectName = asset.ProjectName || projectNameFilter.value.trim() || ''
  assetDialogOpen.value = true
}

function openUploadAssetDialog() {
  if (!selectedGroupId.value) {
    toast.warning('请先选择素材组')
    return
  }
  uploadDraft.name = ''
  uploadDraft.sourceUrl = ''
  uploadDraft.imageData = ''
  uploadDraft.fileName = ''
  uploadDraft.projectName = selectedGroup.value?.ProjectName || projectNameFilter.value.trim() || ''
  uploadDialogOpen.value = true
}

async function handleUploadFileChange(event: Event) {
  try {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    if (!file) return
    assertValidImageFile(file, MAX_UPLOAD_IMAGE_BYTES)
    uploadDraft.imageData = await fileToDataUrl(file)
    uploadDraft.fileName = file.name
    uploadDraft.sourceUrl = ''
    if (!uploadDraft.name.trim()) {
      uploadDraft.name = file.name.replace(/\.[^.]+$/, '')
    }
  } catch (error) {
    toast.error('读取图片失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    resetFileInput(event)
  }
}

function clearUploadFile() {
  uploadDraft.imageData = ''
  uploadDraft.fileName = ''
  if (uploadFileInputRef.value) uploadFileInputRef.value.value = ''
}

async function submitUploadAsset() {
  const groupId = selectedGroupId.value
  if (!groupId) {
    toast.warning('请先选择素材组')
    return
  }
  const sourceUrl = uploadDraft.sourceUrl.trim()
  const imageData = uploadDraft.imageData
  if (!sourceUrl && !imageData) {
    toast.warning('请提供图片 URL 或选择本地图片')
    return
  }
  const name = uploadDraft.name.trim() || uploadDraft.fileName.replace(/\.[^.]+$/, '') || '虚拟人像素材'
  mutatingId.value = 'upload-asset'
  try {
    await uploadArkVirtualAsset({
      groupId,
      name,
      sourceUrl: sourceUrl || undefined,
      imageData: imageData || undefined,
      projectName: uploadDraft.projectName.trim() || selectedGroup.value?.ProjectName || projectNameFilter.value.trim() || undefined
    })
    toast.success('素材已提交')
    uploadDialogOpen.value = false
    await refreshAssets({ resetPage: true })
  } catch (error) {
    toast.error('上传素材失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    mutatingId.value = null
  }
}

async function submitAssetDialog() {
  mutatingId.value = assetDraft.id
  try {
    await updateArkVirtualAsset({
      assetId: assetDraft.id,
      name: assetDraft.name.trim() || undefined,
      projectName: assetDraft.projectName.trim() || undefined
    })
    toast.success('素材已更新')
    assetDialogOpen.value = false
    await refreshAssets()
  } catch (error) {
    toast.error('更新素材失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    mutatingId.value = null
  }
}

async function confirmDeleteGroup(group: ArkVirtualAssetGroup) {
  const ok = window.confirm(`确定删除素材组「${group.Name || group.Id}」？删除前请确认组内素材不再使用。`)
  if (!ok) return

  mutatingId.value = group.Id
  try {
    await deleteArkVirtualAssetGroup({
      groupId: group.Id,
      projectName: group.ProjectName || projectNameFilter.value.trim() || undefined
    })
    toast.success('素材组已删除')
    if (selectedGroupId.value === group.Id) selectedGroupId.value = ''
    await refreshGroups({ refreshAssets: true })
  } catch (error) {
    toast.error('删除素材组失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    mutatingId.value = null
  }
}

async function confirmDeleteAsset(asset: ArkVirtualAssetListItem) {
  const ok = window.confirm(`确定删除素材「${asset.Name || asset.Id}」？已用于分镜的 asset URI 将不可用。`)
  if (!ok) return

  mutatingId.value = asset.Id
  try {
    await deleteArkVirtualAsset({
      assetId: asset.Id,
      projectName: asset.ProjectName || projectNameFilter.value.trim() || undefined
    })
    toast.success('素材已删除')
    await refreshAssets()
  } catch (error) {
    toast.error('删除素材失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    mutatingId.value = null
  }
}

async function copyAssetUri(assetId: string) {
  const uri = `asset://${assetId}`
  try {
    await navigator.clipboard.writeText(uri)
    copiedAssetId.value = assetId
    window.setTimeout(() => {
      if (copiedAssetId.value === assetId) copiedAssetId.value = null
    }, 1500)
    toast.success('已复制素材 URI')
  } catch {
    toast.warning(uri)
  }
}

async function changeGroupPage(delta: number) {
  groupPage.value = Math.min(groupTotalPages.value, Math.max(1, groupPage.value + delta))
  await refreshGroups({ refreshAssets: false })
}

async function changeAssetPage(delta: number) {
  assetPage.value = Math.min(assetTotalPages.value, Math.max(1, assetPage.value + delta))
  await refreshAssets()
}

watch(selectedGroupId, async () => {
  await refreshAssets({ resetPage: true })
})

onMounted(() => {
  void refreshGroups()
})
</script>

<template>
  <TooltipProvider :delay-duration="180">
    <div class="flex h-full min-h-0 w-full flex-1 flex-col">
      <div class="grid h-full min-h-0 flex-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section class="flex h-full min-h-0 flex-col rounded-md border bg-background shadow-sm">
          <div class="border-b px-3 py-2.5">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-medium">素材组</h3>
                <p class="text-xs text-muted-foreground">共 {{ groupTotal }} 个</p>
              </div>
              <div class="flex gap-1">
                <TooltipRoot>
                  <TooltipTrigger as-child>
                    <Button
                      size="icon"
                      variant="ghost"
                      class="h-8 w-8"
                      :disabled="loadingGroups"
                      @click="refreshGroups()"
                    >
                      <Loader2
                        v-if="loadingGroups"
                        class="h-4 w-4 animate-spin"
                      />
                      <RefreshCw
                        v-else
                        class="h-4 w-4"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent
                      side="top"
                      :side-offset="6"
                      class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                    >
                      刷新素材组
                    </TooltipContent>
                  </TooltipPortal>
                </TooltipRoot>
                <TooltipRoot>
                  <TooltipTrigger as-child>
                    <Button
                      size="icon"
                      class="h-8 w-8"
                      @click="openCreateGroupDialog"
                    >
                      <Plus class="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent
                      side="top"
                      :side-offset="6"
                      class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                    >
                      新建素材组
                    </TooltipContent>
                  </TooltipPortal>
                </TooltipRoot>
              </div>
            </div>
            <div class="mt-2 grid gap-2">
              <Input
                v-model="groupNameFilter"
                class="h-8 text-xs"
                placeholder="搜索素材组名称"
                @keydown.enter="refreshGroups({ resetPage: true })"
              />
              <div class="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  v-model="projectNameFilter"
                  class="h-8 text-xs"
                  placeholder="方舟项目：默认 default"
                  @keydown.enter="refreshGroups({ resetPage: true })"
                />
                <Button
                  size="sm"
                  variant="outline"
                  class="h-8 gap-1 px-2 text-xs"
                  :disabled="loadingGroups"
                  @click="refreshGroups({ resetPage: true })"
                >
                  <Search class="h-3.5 w-3.5" />
                  查询
                </Button>
              </div>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <div
              v-if="loadingGroups && groups.length === 0"
              class="space-y-2 p-3"
            >
              <div
                v-for="index in 4"
                :key="index"
                class="h-16 animate-pulse rounded-md bg-muted"
              />
            </div>
            <button
              v-for="group in groups"
              :key="group.Id"
              type="button"
              class="group flex w-full border-b px-3 py-3 text-left transition-colors hover:bg-muted/40"
              :class="selectedGroupId === group.Id ? 'bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]' : ''"
              @click="selectedGroupId = group.Id"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ group.Name || group.Title || group.Id }}</p>
                <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{{ group.Id }}</p>
                <p class="mt-1 truncate text-xs text-muted-foreground">{{ groupSubtitle(group) }}</p>
              </div>
              <div class="ml-2 flex shrink-0 items-start gap-1">
                <TooltipRoot>
                  <TooltipTrigger as-child>
                    <Button
                      size="icon"
                      variant="ghost"
                      class="h-7 w-7"
                      :disabled="!!mutatingId"
                      @click.stop="openEditGroupDialog(group)"
                    >
                      <Pencil class="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent
                      side="top"
                      :side-offset="6"
                      class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                    >
                      编辑素材组
                    </TooltipContent>
                  </TooltipPortal>
                </TooltipRoot>
                <TooltipRoot>
                  <TooltipTrigger as-child>
                    <Button
                      size="icon"
                      variant="ghost"
                      class="h-7 w-7 text-destructive hover:text-destructive"
                      :disabled="!!mutatingId"
                      @click.stop="confirmDeleteGroup(group)"
                    >
                      <Loader2
                        v-if="mutatingId === group.Id"
                        class="h-3.5 w-3.5 animate-spin"
                      />
                      <Trash2
                        v-else
                        class="h-3.5 w-3.5"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent
                      side="top"
                      :side-offset="6"
                      class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                    >
                      删除素材组
                    </TooltipContent>
                  </TooltipPortal>
                </TooltipRoot>
              </div>
            </button>
            <div
              v-if="!loadingGroups && groups.length === 0"
              class="flex h-full min-h-64 flex-col items-center justify-center px-4 py-10 text-center"
            >
              <div class="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <ImageIcon class="h-5 w-5" />
              </div>
              <p class="mt-3 text-sm font-medium">没有素材组</p>
              <p class="mt-1 text-xs text-muted-foreground">新建一个素材组后再上传虚拟人像素材。</p>
            </div>
          </div>

          <div class="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>第 {{ groupPage }} / {{ groupTotalPages }} 页</span>
            <div class="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                class="h-7 px-2 text-xs"
                :disabled="groupPage <= 1 || loadingGroups"
                @click="changeGroupPage(-1)"
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="outline"
                class="h-7 px-2 text-xs"
                :disabled="groupPage >= groupTotalPages || loadingGroups"
                @click="changeGroupPage(1)"
              >
                下一页
              </Button>
            </div>
          </div>
        </section>

        <section class="flex h-full min-w-0 flex-col overflow-hidden rounded-md border bg-background shadow-sm">
          <div class="border-b px-3 py-2.5 xl:min-h-[116px]">
            <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <h3 class="truncate text-sm font-medium">
                    {{ selectedGroup ? (selectedGroup.Name || selectedGroup.Id) : '素材列表' }}
                  </h3>
                  <span
                    v-if="selectedGroup"
                    class="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {{ normalizeDisplayText(selectedGroup.ProjectName, 'default') }}
                  </span>
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {{ selectedGroupId || '未选择素材组，将查询全部素材' }}
                </p>
              </div>
              <div class="grid min-w-0 gap-2 sm:grid-cols-[minmax(140px,1fr)_150px_auto_auto] xl:w-[min(100%,590px)]">
                <Input
                  v-model="assetNameFilter"
                  class="h-8 text-xs"
                  placeholder="素材名称"
                  @keydown.enter="refreshAssets({ resetPage: true })"
                />
                <select
                  v-model="assetStatusFilter"
                  class="h-8 rounded-md border bg-background px-2 text-xs"
                >
                  <option value="">全部状态</option>
                  <option value="Active">已启用</option>
                  <option value="Processing">处理中</option>
                  <option value="Failed">失败</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-8 gap-2 text-xs"
                  :disabled="loadingAssets"
                  @click="refreshAssets({ resetPage: true })"
                >
                  <Search class="h-3.5 w-3.5" />
                  筛选
                </Button>
                <Button
                  size="sm"
                  class="h-8 gap-2 text-xs"
                  :disabled="!selectedGroupId || !!mutatingId"
                  @click="openUploadAssetDialog"
                >
                  <Upload class="h-3.5 w-3.5" />
                  上传素材
                </Button>
              </div>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
            <div class="flex h-full min-h-0 min-w-0 flex-col xl:min-w-[760px]">
              <div class="grid min-h-9 shrink-0 items-center gap-3 border-b bg-muted/20 px-3 text-xs font-medium text-muted-foreground xl:grid-cols-[minmax(260px,1fr)_72px_112px_128px_116px]">
                <div>素材</div>
                <div class="hidden xl:block">类型</div>
                <div>状态</div>
                <div>更新时间</div>
                <div class="text-right">操作</div>
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto">
                <div
                  v-if="loadingAssets"
                  class="flex h-32 items-center justify-center text-sm text-muted-foreground"
                >
                  <span class="inline-flex items-center gap-2">
                    <Loader2 class="h-4 w-4 animate-spin" />
                    正在查询素材
                  </span>
                </div>

                <div
                  v-else-if="assets.length === 0"
                  class="flex h-full min-h-56 flex-col items-center justify-center px-4 text-center"
                >
                  <div class="flex h-12 w-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <ImageIcon class="h-6 w-6" />
                  </div>
                  <p class="mt-3 text-sm font-medium text-foreground">没有素材</p>
                  <p class="mt-1 text-xs text-muted-foreground">选择素材组后上传图片，生成可在分镜中引用的 asset URI。</p>
                  <Button
                    v-if="selectedGroupId"
                    size="sm"
                    class="mt-4 gap-2"
                    @click="openUploadAssetDialog"
                  >
                    <Upload class="h-4 w-4" />
                    上传素材
                  </Button>
                </div>

                <div
                  v-else
                  class="min-w-0"
                >
                  <div
                    v-for="asset in assets"
                    :key="asset.Id"
                    class="grid min-h-[92px] items-center gap-3 border-b px-3 py-3 transition-colors hover:bg-muted/30 xl:grid-cols-[minmax(260px,1fr)_72px_112px_128px_116px]"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <div class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                        <img
                          v-if="assetPreviewUrl(asset)"
                          :src="assetPreviewUrl(asset)"
                          :alt="asset.Name || asset.Id"
                          class="h-full w-full object-cover"
                          loading="lazy"
                        >
                        <ImageIcon
                          v-else
                          class="h-5 w-5 text-muted-foreground"
                        />
                      </div>
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium">{{ asset.Name || asset.Id }}</p>
                        <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{{ asset.Id }}</p>
                        <p class="mt-1 truncate text-xs text-muted-foreground">{{ asset.GroupId || '-' }}</p>
                      </div>
                    </div>

                    <div class="hidden text-sm xl:block">{{ assetTypeLabel(asset.AssetType) }}</div>
                    <div>
                      <span
                        class="inline-flex rounded-md border px-2 py-0.5 text-xs font-medium"
                        :class="statusClass(asset.Status)"
                      >
                        {{ statusLabel(asset.Status) }}
                      </span>
                    </div>
                    <div class="whitespace-nowrap text-sm text-muted-foreground">
                      {{ formatDateTime(asset.UpdateTime || asset.CreateTime) }}
                    </div>
                    <div class="flex items-center justify-end gap-1">
                      <TooltipRoot>
                        <TooltipTrigger as-child>
                          <Button
                            size="icon"
                            variant="ghost"
                            class="h-8 w-8"
                            @click="copyAssetUri(asset.Id)"
                          >
                            <Check
                              v-if="copiedAssetId === asset.Id"
                              class="h-4 w-4 text-emerald-600"
                            />
                            <Copy
                              v-else
                              class="h-4 w-4"
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent
                            side="top"
                            :side-offset="6"
                            class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                          >
                            复制 asset URI
                          </TooltipContent>
                        </TooltipPortal>
                      </TooltipRoot>
                      <TooltipRoot>
                        <TooltipTrigger as-child>
                          <Button
                            size="icon"
                            variant="ghost"
                            class="h-8 w-8"
                            :disabled="!!mutatingId"
                            @click="openEditAssetDialog(asset)"
                          >
                            <Pencil class="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent
                            side="top"
                            :side-offset="6"
                            class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                          >
                            编辑素材
                          </TooltipContent>
                        </TooltipPortal>
                      </TooltipRoot>
                      <TooltipRoot>
                        <TooltipTrigger as-child>
                          <Button
                            size="icon"
                            variant="ghost"
                            class="h-8 w-8 text-destructive hover:text-destructive"
                            :disabled="!!mutatingId"
                            @click="confirmDeleteAsset(asset)"
                          >
                            <Loader2
                              v-if="mutatingId === asset.Id"
                              class="h-4 w-4 animate-spin"
                            />
                            <Trash2
                              v-else
                              class="h-4 w-4"
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipPortal>
                          <TooltipContent
                            side="top"
                            :side-offset="6"
                            class="z-[70] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
                          >
                            删除素材
                          </TooltipContent>
                        </TooltipPortal>
                      </TooltipRoot>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        <div class="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>共 {{ assetTotal }} 个，第 {{ assetPage }} / {{ assetTotalPages }} 页</span>
          <div class="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              class="h-7 px-2 text-xs"
              :disabled="assetPage <= 1 || loadingAssets"
              @click="changeAssetPage(-1)"
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              class="h-7 px-2 text-xs"
              :disabled="assetPage >= assetTotalPages || loadingAssets"
              @click="changeAssetPage(1)"
            >
              下一页
            </Button>
          </div>
        </div>
      </section>
    </div>

    <Dialog
      :open="groupDialogOpen"
      @update:open="groupDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ groupDialogMode === 'create' ? '新建素材组' : '编辑素材组' }}</DialogTitle>
          <DialogDescription>
            素材组用于归类同一虚拟人物或同一项目的可信素材。
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">素材组名称</label>
            <Input
              v-model="groupDraft.name"
              placeholder="figure_group"
            />
          </div>
          <div
            v-if="groupDialogMode === 'edit'"
            class="space-y-1.5"
          >
            <label class="text-xs text-muted-foreground">显示标题</label>
            <Input
              v-model="groupDraft.title"
              placeholder="显示标题"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">说明</label>
            <Textarea
              v-model="groupDraft.description"
              class="min-h-20"
              placeholder="素材组说明"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">方舟项目</label>
            <Input
              v-model="groupDraft.projectName"
              placeholder="留空则使用设置项或 default"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            @click="groupDialogOpen = false"
          >
            取消
          </Button>
          <Button
            :disabled="!!mutatingId"
            @click="submitGroupDialog"
          >
            <Loader2
              v-if="!!mutatingId"
              class="mr-2 h-4 w-4 animate-spin"
            />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="uploadDialogOpen"
      @update:open="uploadDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>上传素材</DialogTitle>
          <DialogDescription>
            上传到当前素材组，生成可在分镜中引用的 asset URI。
          </DialogDescription>
        </DialogHeader>
        <div class="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div class="flex min-h-56 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
            <img
              v-if="uploadPreviewUrl"
              :src="uploadPreviewUrl"
              alt="待上传素材预览"
              class="h-full max-h-72 w-full object-cover"
            >
            <div
              v-else
              class="flex flex-col items-center px-4 text-center text-muted-foreground"
            >
              <ImageIcon class="h-8 w-8" />
              <p class="mt-2 text-xs">选择图片或粘贴公网 URL</p>
            </div>
          </div>

          <div class="space-y-3">
            <div class="space-y-1.5">
              <label class="text-xs text-muted-foreground">素材名称</label>
              <Input
                v-model="uploadDraft.name"
                placeholder="例如：林婉-正脸"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs text-muted-foreground">公网图片 URL</label>
              <Input
                v-model="uploadDraft.sourceUrl"
                :disabled="!!uploadDraft.imageData"
                placeholder="https://..."
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs text-muted-foreground">本地图片</label>
              <div class="flex gap-2">
                <input
                  ref="uploadFileInputRef"
                  type="file"
                  accept="image/*"
                  class="hidden"
                  @change="handleUploadFileChange"
                >
                <Button
                  type="button"
                  variant="outline"
                  class="h-9 gap-2"
                  @click="uploadFileInputRef?.click()"
                >
                  <Upload class="h-4 w-4" />
                  选择图片
                </Button>
                <Button
                  v-if="uploadDraft.imageData"
                  type="button"
                  variant="ghost"
                  class="h-9 gap-2"
                  @click="clearUploadFile"
                >
                  <X class="h-4 w-4" />
                  移除
                </Button>
              </div>
              <p
                v-if="uploadDraft.fileName"
                class="truncate text-xs text-muted-foreground"
              >
                {{ uploadDraft.fileName }}
              </p>
            </div>
            <div class="space-y-1.5">
              <label class="text-xs text-muted-foreground">方舟项目</label>
              <Input
                v-model="uploadDraft.projectName"
                placeholder="留空则使用当前素材组项目"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            @click="uploadDialogOpen = false"
          >
            取消
          </Button>
          <Button
            :disabled="mutatingId === 'upload-asset'"
            @click="submitUploadAsset"
          >
            <Loader2
              v-if="mutatingId === 'upload-asset'"
              class="mr-2 h-4 w-4 animate-spin"
            />
            提交上传
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="assetDialogOpen"
      @update:open="assetDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑素材</DialogTitle>
          <DialogDescription>
            当前支持更新素材名称，素材内容需重新上传生成新的 Asset。
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">Asset ID</label>
            <Input
              :model-value="assetDraft.id"
              disabled
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">素材名称</label>
            <Input
              v-model="assetDraft.name"
              placeholder="素材名称"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs text-muted-foreground">方舟项目</label>
            <Input
              v-model="assetDraft.projectName"
              placeholder="留空则使用设置项或 default"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            @click="assetDialogOpen = false"
          >
            取消
          </Button>
          <Button
            :disabled="!!mutatingId"
            @click="submitAssetDialog"
          >
            <Loader2
              v-if="!!mutatingId"
              class="mr-2 h-4 w-4 animate-spin"
            />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  </TooltipProvider>
</template>
