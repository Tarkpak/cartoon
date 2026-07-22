<template>
  <AdminShell content-mode="fixed">
    <div class="page tos-files-page fixed-table-page">
      <div class="tos-files-content fixed-table-content">
        <div class="tos-member-toolbar">
          <n-select
            v-model:value="selectedMemberAccount"
            class="tos-member-select"
            :options="memberOptions"
            :loading="membersLoading"
            filterable
            @update:value="switchMember"
          />
          <span class="muted">{{ selectedMemberLabel }}</span>
          <div class="tos-files-shortcuts">
          <n-button
            size="small"
            :type="activeAssetDirectory === 'all' ? 'primary' : 'default'"
            :disabled="pending"
            @click="openAssetDirectory('all')"
          >
            全部
          </n-button>
          <n-button
            size="small"
            :type="activeAssetDirectory === 'images' ? 'primary' : 'default'"
            :disabled="pending || selectedMemberAccount === '__all__'"
            @click="openAssetDirectory('images')"
          >
            images
          </n-button>
          <n-button
            size="small"
            :type="activeAssetDirectory === 'videos' ? 'primary' : 'default'"
            :disabled="pending || selectedMemberAccount === '__all__'"
            @click="openAssetDirectory('videos')"
          >
            videos
          </n-button>
          </div>
        </div>

        <div class="tos-files-toolbar">
          <n-input
            v-model:value="searchQuery"
            clearable
            placeholder="搜索当前页名称或 Key"
          />
          <ClientOnly>
            <n-select
              v-model:value="delimiter"
              :options="delimiterOptions"
            />
            <template #fallback>
              <div class="tos-files-select-fallback">按目录浏览</div>
            </template>
          </ClientOnly>
          <ClientOnly>
            <n-select
              v-model:value="maxKeys"
              :options="maxKeysOptions"
            />
            <template #fallback>
              <div class="tos-files-select-fallback">每页 100 条</div>
            </template>
          </ClientOnly>
          <n-button type="primary" :loading="pending" @click="loadFromInput">查询</n-button>
        </div>

        <n-alert v-if="loadError" type="warning">
          {{ loadError }}
        </n-alert>

        <div v-if="meta" class="tos-files-meta">
          <nav class="tos-breadcrumbs" aria-label="当前目录">
            <template v-for="(item, index) in breadcrumbItems" :key="item.prefix">
              <span v-if="index" class="tos-breadcrumbs__separator">/</span>
              <n-button
                text
                size="small"
                :type="index === breadcrumbItems.length - 1 ? 'default' : 'primary'"
                :disabled="pending || index === breadcrumbItems.length - 1"
                @click="openDirectory(item.prefix)"
              >
                {{ item.label }}
              </n-button>
            </template>
          </nav>
          <n-space size="small">
            <n-button size="small" :disabled="!canGoParent || pending" @click="goParent">上一级</n-button>
            <n-button size="small" :disabled="pending" @click="goRoot">成员根目录</n-button>
          </n-space>
        </div>

        <n-data-table
          class="fixed-data-table"
          :columns="columns"
          :data="filteredRows"
          :loading="pending"
          :pagination="false"
          :row-key="rowKey"
          :scroll-x="1350"
          flex-height
        >
          <template #empty>
            <n-empty :description="searchQuery.trim() ? '当前页没有匹配的素材' : '当前目录下没有素材'" />
          </template>
        </n-data-table>

        <div v-if="meta" class="tos-files-footer">
          <span class="muted">第 {{ currentPage }} 页 · 当前 {{ filteredRows.length }} 项</span>
          <n-space size="small">
            <n-button size="small" :disabled="pending || currentPage <= 1" @click="goFirstPage">第一页</n-button>
            <n-button size="small" :disabled="pending || currentPage <= 1" @click="goPreviousPage">上一页</n-button>
            <n-button size="small" type="primary" secondary :disabled="pending || !nextContinuationToken" @click="goNextPage">下一页</n-button>
          </n-space>
        </div>
      </div>

      <n-modal
        v-model:show="imagePreviewOpen"
        :auto-focus="false"
        @after-leave="resetImagePreview"
      >
        <div
          class="tos-image-viewer"
          :class="{
            'tos-image-viewer--pannable': imagePreviewScale > 1,
            'tos-image-viewer--dragging': imagePreviewDragging
          }"
          @click.self="closeImagePreview"
          @wheel.prevent="handleImagePreviewWheel"
          @mousedown="startImagePreviewDrag"
          @mousemove="moveImagePreviewDrag"
          @mouseup="stopImagePreviewDrag"
          @mouseleave="stopImagePreviewDrag"
        >
          <button
            class="tos-image-viewer__close"
            type="button"
            aria-label="关闭预览"
            @mousedown.stop
            @click="imagePreviewOpen = false"
          >
            x
          </button>
          <img
            v-if="imagePreviewUrl && previewMediaType === 'image'"
            class="tos-image-viewer__image"
            :src="imagePreviewUrl"
            :alt="imagePreviewName"
            :style="imagePreviewStyle"
            loading="lazy"
            draggable="false"
          >
          <video
            v-else-if="imagePreviewUrl"
            class="tos-image-viewer__video"
            :src="imagePreviewUrl"
            controls
            autoplay
            playsinline
            @mousedown.stop
          />
        </div>
      </n-modal>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NEllipsis, NSpace, NTag, useMessage } from 'naive-ui'

interface TosFile {
  key: string
  size: number
  lastModified: string
  storageClass: string
  etag: string
  url: string
}

interface TosFilesData {
  bucket: string
  configuredPrefix: string
  prefix: string
  delimiter?: string
  maxKeys: number
  isTruncated: boolean
  nextContinuationToken?: string
  commonPrefixes: string[]
  files: TosFile[]
}

type TosRowType = 'directory' | 'image' | 'video' | 'file'
type AssetDirectory = 'all' | 'images' | 'videos'

interface TosMember {
  id: string
  account: string
  displayName: string
  status: string
}

interface TosRow {
  id: string
  type: TosRowType
  key: string
  name: string
  size: number
  lastModified: string
  storageClass: string
  url: string
}

interface TosStorageConfigData {
  keyPrefix?: string
}

interface TosFilesViewState {
  selectedMemberAccount?: string
  activeAssetDirectory?: AssetDirectory
  delimiter?: string
  maxKeys?: number
}

const TOS_FILES_VIEW_STATE_KEY = 'playlet-admin-tos-files-view-state'
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['avi', 'flv', 'm3u8', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'])
const ASSET_DIRECTORIES = new Set<AssetDirectory>(['images', 'videos'])

const message = useMessage()
const pending = ref(false)
const loadError = ref('')
const searchQuery = ref('')
const prefixInput = ref('')
const activeAssetDirectory = ref<AssetDirectory>('all')
const members = ref<TosMember[]>([])
const membersLoading = ref(false)
const selectedMemberAccount = ref('__all__')
const storageConfiguredPrefix = ref('')
const delimiter = ref('/')
const maxKeys = ref(100)
const meta = ref<TosFilesData | null>(null)
const rows = ref<TosRow[]>([])
const nextContinuationToken = ref('')
const continuationToken = ref('')
const tokenHistory = ref<string[]>([])
const currentPage = ref(1)
const imagePreviewOpen = ref(false)
const imagePreviewUrl = ref('')
const imagePreviewName = ref('')
const previewMediaType = ref<'image' | 'video'>('image')
const imagePreviewScale = ref(1)
const imagePreviewDragging = ref(false)
const imagePreviewOffset = reactive({ x: 0, y: 0 })
const imagePreviewDragStart = reactive({ x: 0, y: 0, offsetX: 0, offsetY: 0 })

const delimiterOptions = [
  { label: '按目录浏览', value: '/' },
  { label: '平铺对象', value: '' }
]
const maxKeysOptions = [
  { label: '100 条', value: 100 },
  { label: '300 条', value: 300 },
  { label: '500 条', value: 500 },
  { label: '1000 条', value: 1000 }
]

const memberOptions = computed(() => [
  { label: `全部成员（${members.value.length}）`, value: '__all__' },
  ...members.value.map(member => ({
    label: `${member.displayName}（${member.account}）${member.status === 'active' ? '' : ' · 已停用'}`,
    value: member.account
  }))
])
const selectedMemberLabel = computed(() => {
  if (selectedMemberAccount.value === '__all__') return `按成员浏览，共 ${members.value.length} 位成员`
  const member = members.value.find(item => item.account === selectedMemberAccount.value)
  return member ? `正在查看 ${member.displayName} 的素材` : '正在查看成员素材'
})
const filteredRows = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase()
  if (!query) return rows.value
  return rows.value.filter(row =>
    row.name.toLocaleLowerCase().includes(query)
    || row.key.toLocaleLowerCase().includes(query)
  )
})

const canGoParent = computed(() => normalizePrefix(prefixInput.value) !== selectedMemberRootPrefix())
const imagePreviewStyle = computed(() => ({
  transform: `translate(${imagePreviewOffset.x}px, ${imagePreviewOffset.y}px) scale(${imagePreviewScale.value})`
}))
const breadcrumbItems = computed(() => {
  const full = normalizePrefix(prefixInput.value)
  const root = selectedMemberRootPrefix()
  const rootParts = root.split('/').filter(Boolean)
  const fullParts = full.split('/').filter(Boolean)
  const start = Math.max(0, rootParts.length - (selectedMemberAccount.value === '__all__' ? 1 : 2))
  return fullParts.slice(start).map((segment, relativeIndex) => {
    const index = start + relativeIndex
    let label = segment
    if (segment === 'users') label = '全部成员'
    else if (segment === 'images') label = '图片'
    else if (segment === 'videos') label = '视频'
    else if (index > 0 && fullParts[index - 1] === 'users') {
      const member = members.value.find(item => userScopeComponent(item.account) === segment)
      label = member?.displayName || segment
    }
    return { label, prefix: fullParts.slice(0, index + 1).join('/') }
  })
})

const columns = [
  {
    title: '预览',
    key: 'preview',
    width: 132,
    fixed: 'left' as const,
    render(row: TosRow) {
      return renderPreview(row)
    }
  },
  {
    title: '名称',
    key: 'name',
    width: 260,
    fixed: 'left' as const,
    render(row: TosRow) {
      const content = h(NEllipsis, { style: 'max-width: 190px' }, { default: () => row.name || '-' })
      if (row.type !== 'directory') return content
      return h(
        NButton,
        {
          size: 'small',
          text: true,
          type: 'primary',
          onClick: () => openDirectory(row.key)
        },
        { default: () => content }
      )
    }
  },
  {
    title: '类型',
    key: 'type',
    width: 96,
    render(row: TosRow) {
      const tag = rowTypeTag(row.type)
      return h(NTag, { size: 'small', type: tag.type }, { default: () => tag.label })
    }
  },
  {
    title: '对象 Key',
    key: 'key',
    minWidth: 360,
    render(row: TosRow) {
      return h(NEllipsis, { style: 'max-width: 520px' }, { default: () => row.key || '-' })
    }
  },
  {
    title: '大小',
    key: 'size',
    width: 120,
    render(row: TosRow) {
      return row.type === 'directory' ? '-' : formatSize(row.size)
    }
  },
  {
    title: '更新时间',
    key: 'lastModified',
    width: 180,
    render(row: TosRow) {
      return formatAdminDateTime(row.lastModified)
    }
  },
  {
    title: '存储类型',
    key: 'storageClass',
    width: 120,
    render(row: TosRow) {
      return row.storageClass || '-'
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 300,
    render(row: TosRow) {
      if (row.type === 'directory') {
        return h(NButton, { size: 'small', onClick: () => openDirectory(row.key) }, { default: () => '打开' })
      }
      return h(
        NSpace,
        { size: 8, wrap: false },
        {
          default: () => [
            h(
              NButton,
              {
                size: 'small',
                disabled: !row.url,
                onClick: () => openMediaPreview(row)
              },
              { default: () => '预览' }
            ),
            h(
              NButton,
              { size: 'small', quaternary: true, onClick: () => copyText(row.key, '对象 Key') },
              { default: () => '复制 Key' }
            ),
            h(
              NButton,
              { size: 'small', quaternary: true, disabled: !row.url, onClick: () => copyText(row.url, '素材地址') },
              { default: () => '复制 URL' }
            ),
            h(
              NButton,
              {
                size: 'small',
                type: 'primary',
                secondary: true,
                onClick: () => downloadFile(row)
              },
              { default: () => '下载' }
            )
          ]
        }
      )
    }
  }
]

function renderPreview(row: TosRow) {
  if (row.type === 'directory') {
    return h('div', { class: 'tos-media-preview tos-media-preview--folder' }, '目录')
  }
  if (!row.url) {
    return h('div', { class: 'tos-media-preview tos-media-preview--empty' }, '-')
  }
  if (row.type === 'image') {
    return h(
      'div',
      { class: 'tos-media-preview' },
      [
        h(
          'button',
          {
            class: 'tos-media-preview__button',
            type: 'button',
            onClick: () => openImagePreview(row)
          },
          [
            h('img', {
              class: 'tos-media-preview__image',
              src: row.url,
              alt: row.name,
              loading: 'lazy',
              draggable: false
            })
          ]
        )
      ]
    )
  }
  if (row.type === 'video') {
    return h(
      'div',
      { class: 'tos-media-preview tos-media-preview--video' },
      [
        h(
          'button',
          {
            class: 'tos-media-preview__button tos-media-preview__video-button',
            type: 'button',
            onClick: () => openMediaPreview(row)
          },
          '播放视频'
        )
      ]
    )
  }
  return h('div', { class: 'tos-media-preview tos-media-preview--file' }, '文件')
}

function errorText(error: unknown, fallback: string) {
  const data = (error as { data?: { statusMessage?: string, message?: string } })?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : fallback)
}

function normalizePrefix(value: string) {
  return value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .join('/')
}

function joinObjectPath(...parts: string[]) {
  return parts
    .map(part => normalizePrefix(part))
    .filter(Boolean)
    .join('/')
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '')
}

function configuredBasePrefix() {
  return normalizePrefix(meta.value?.configuredPrefix || storageConfiguredPrefix.value)
}

function userScopeComponent(account: string) {
  return account
    .replace(/[\\/]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
}

function membersRootPrefix(basePrefix = configuredBasePrefix()) {
  const normalized = normalizePrefix(basePrefix)
  return normalized === 'users' || normalized.endsWith('/users')
    ? normalized
    : joinObjectPath(normalized, 'users')
}

function selectedMemberRootPrefix(basePrefix = configuredBasePrefix()) {
  const root = membersRootPrefix(basePrefix)
  return selectedMemberAccount.value === '__all__'
    ? root
    : joinObjectPath(root, userScopeComponent(selectedMemberAccount.value))
}

function findLastAssetDirectoryIndex(parts: string[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (ASSET_DIRECTORIES.has(parts[index] as AssetDirectory)) return index
  }
  return -1
}

function activeAssetDirectoryFromPrefix(prefix: string) {
  const parts = normalizePrefix(prefix).split('/').filter(Boolean)
  const index = findLastAssetDirectoryIndex(parts)
  return index >= 0 ? parts[index] as AssetDirectory : null
}

function assetDirectoryPrefix(directory: AssetDirectory, fallbackBasePrefix: string) {
  const root = selectedMemberRootPrefix(fallbackBasePrefix)
  return directory === 'all' ? root : joinObjectPath(root, directory)
}

function relativeToConfiguredPrefix(prefix: string, configuredPrefix: string) {
  const normalized = normalizePrefix(prefix)
  const base = normalizePrefix(configuredPrefix)
  if (!base) return normalized
  if (normalized === base) return ''
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return normalized
}

function syncActiveAssetDirectory(data: TosFilesData) {
  const relativePrefix = relativeToConfiguredPrefix(data.prefix, data.configuredPrefix)
  const directory = activeAssetDirectoryFromPrefix(relativePrefix)
  if (directory) {
    activeAssetDirectory.value = directory
  }
}

function rowKey(row: TosRow) {
  return row.id
}

function fileTypeForKey(key: string): TosRowType {
  const extension = key.split('.').pop()?.toLowerCase() || ''
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  return 'file'
}

function rowTypeTag(type: TosRowType) {
  if (type === 'directory') return { label: '目录', type: 'info' as const }
  if (type === 'image') return { label: '图片', type: 'success' as const }
  if (type === 'video') return { label: '视频', type: 'warning' as const }
  return { label: '文件', type: 'default' as const }
}

function displayNameForKey(key: string) {
  const normalized = stripTrailingSlash(key)
  return normalized.split('/').filter(Boolean).pop() || normalized || '/'
}

function directoryDisplayName(prefix: string) {
  const name = displayNameForKey(prefix)
  const parent = normalizePrefix(stripTrailingSlash(prefix).split('/').slice(0, -1).join('/'))
  if (parent !== membersRootPrefix()) return `${name}/`
  const member = members.value.find(item => userScopeComponent(item.account) === name)
  return member ? `${member.displayName}（${member.account}）/` : `${name}/`
}

function buildRows(data: TosFilesData) {
  const directories: TosRow[] = data.commonPrefixes.map(prefix => ({
    id: `dir:${prefix}`,
    type: 'directory',
    key: prefix,
    name: directoryDisplayName(prefix),
    size: 0,
    lastModified: '',
    storageClass: '',
    url: ''
  }))
  const files: TosRow[] = data.files
    .filter(file => file.key && file.key !== data.prefix)
    .map(file => ({
      id: `file:${file.key}`,
      type: fileTypeForKey(file.key),
      key: file.key,
      name: displayNameForKey(file.key),
      size: file.size,
      lastModified: file.lastModified,
      storageClass: file.storageClass,
      url: file.url
    }))
  return [...directories, ...files]
}

function formatSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function optionValueExists(options: Array<{ value: number }>, value: unknown) {
  return typeof value === 'number' && options.some(option => option.value === value)
}

function readViewState() {
  if (!import.meta.client) return null
  try {
    const raw = localStorage.getItem(TOS_FILES_VIEW_STATE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TosFilesViewState>
    return {
      selectedMemberAccount: typeof parsed.selectedMemberAccount === 'string' ? parsed.selectedMemberAccount : '__all__',
      activeAssetDirectory: ['all', 'images', 'videos'].includes(String(parsed.activeAssetDirectory))
        ? parsed.activeAssetDirectory
        : 'all',
      delimiter: parsed.delimiter === '' || parsed.delimiter === '/' ? parsed.delimiter : undefined,
      maxKeys: optionValueExists(maxKeysOptions, parsed.maxKeys) ? parsed.maxKeys : undefined
    }
  } catch {
    return null
  }
}

function saveViewState() {
  if (!import.meta.client) return
  const state: TosFilesViewState = {
    selectedMemberAccount: selectedMemberAccount.value,
    activeAssetDirectory: activeAssetDirectory.value,
    delimiter: delimiter.value,
    maxKeys: maxKeys.value
  }
  localStorage.setItem(TOS_FILES_VIEW_STATE_KEY, JSON.stringify(state))
}

function restoreViewState() {
  const state = readViewState()
  if (!state) return false
  delimiter.value = state.delimiter ?? delimiter.value
  maxKeys.value = state.maxKeys ?? maxKeys.value
  selectedMemberAccount.value = state.selectedMemberAccount || '__all__'
  activeAssetDirectory.value = state.activeAssetDirectory || 'all'
  return true
}

async function loadMembers() {
  membersLoading.value = true
  try {
    const response = await $fetch<{ data: { members: TosMember[] } }>('/api/client/tos-members')
    members.value = response.data.members
  } catch (error) {
    const text = errorText(error, '加载成员列表失败')
    loadError.value = text
    message.error(text)
  } finally {
    membersLoading.value = false
  }
}

async function fetchFiles(options: { continuationToken?: string, preserveOnError?: boolean } = {}) {
  pending.value = true
  loadError.value = ''

  try {
    const query: Record<string, string | number> = {
      delimiter: delimiter.value,
      maxKeys: maxKeys.value
    }
    query.prefix = normalizePrefix(prefixInput.value)
    if (options.continuationToken) {
      query.continuationToken = options.continuationToken
    }

    const response = await $fetch<{ data: TosFilesData }>('/api/admin/tos-files', { query })
    meta.value = response.data
    storageConfiguredPrefix.value = normalizePrefix(response.data.configuredPrefix || storageConfiguredPrefix.value)
    syncActiveAssetDirectory(response.data)
    prefixInput.value = stripTrailingSlash(response.data.prefix || '')
    saveViewState()
    nextContinuationToken.value = response.data.nextContinuationToken || ''
    rows.value = buildRows(response.data)
    return true
  } catch (error) {
    const text = errorText(error, '加载云端素材失败')
    loadError.value = text
    message.error(text)
    if (!options.preserveOnError) {
      meta.value = null
      rows.value = []
    }
    return false
  } finally {
    pending.value = false
  }
}

function loadFromInput() {
  resetPagination()
  void fetchFiles()
}

function resetPagination() {
  continuationToken.value = ''
  tokenHistory.value = []
  currentPage.value = 1
  nextContinuationToken.value = ''
}

async function ensureStorageConfiguredPrefix() {
  const current = configuredBasePrefix()
  if (current) return current

  const response = await $fetch<{ data: TosStorageConfigData }>('/api/admin/tos-storage/config')
  storageConfiguredPrefix.value = normalizePrefix(response.data.keyPrefix || '')
  return storageConfiguredPrefix.value
}

async function openAssetDirectory(directory: AssetDirectory) {
  if (selectedMemberAccount.value === '__all__' && directory !== 'all') return
  activeAssetDirectory.value = directory
  pending.value = true
  loadError.value = ''
  try {
    const basePrefix = await ensureStorageConfiguredPrefix()
    prefixInput.value = assetDirectoryPrefix(directory, basePrefix)
    searchQuery.value = ''
    resetPagination()
    await fetchFiles()
  } catch (error) {
    const text = errorText(error, '加载云存储配置失败')
    loadError.value = text
    message.error(text)
  } finally {
    pending.value = false
  }
}

async function switchMember(account: string) {
  selectedMemberAccount.value = account
  activeAssetDirectory.value = 'all'
  pending.value = true
  loadError.value = ''
  try {
    const basePrefix = await ensureStorageConfiguredPrefix()
    prefixInput.value = assetDirectoryPrefix('all', basePrefix)
    searchQuery.value = ''
    resetPagination()
    await fetchFiles()
  } catch (error) {
    const text = errorText(error, '加载成员素材失败')
    loadError.value = text
    message.error(text)
  } finally {
    pending.value = false
  }
}

function openDirectory(prefix: string) {
  prefixInput.value = stripTrailingSlash(prefix)
  searchQuery.value = ''
  resetPagination()
  void fetchFiles()
}

async function goNextPage() {
  if (!nextContinuationToken.value) return
  const nextToken = nextContinuationToken.value
  const loaded = await fetchFiles({ continuationToken: nextToken, preserveOnError: true })
  if (!loaded) return
  tokenHistory.value.push(continuationToken.value)
  continuationToken.value = nextToken
  currentPage.value += 1
}

async function goPreviousPage() {
  if (currentPage.value <= 1) return
  const previousToken = tokenHistory.value.at(-1) || ''
  const loaded = await fetchFiles({ continuationToken: previousToken || undefined, preserveOnError: true })
  if (!loaded) return
  tokenHistory.value.pop()
  continuationToken.value = previousToken
  currentPage.value = Math.max(1, currentPage.value - 1)
}

async function goFirstPage() {
  if (currentPage.value <= 1) return
  const loaded = await fetchFiles({ preserveOnError: true })
  if (loaded) {
    continuationToken.value = ''
    tokenHistory.value = []
    currentPage.value = 1
  }
}

function downloadFile(row: TosRow) {
  if (!row.key || !import.meta.client) return
  const query = new URLSearchParams({ key: row.key, filename: row.name })
  window.location.assign(`/api/admin/tos-files/download?${query.toString()}`)
}

async function copyText(value: string, label: string) {
  if (!value || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(value)
    message.success(`${label}已复制`)
  } catch {
    message.error(`复制${label}失败`)
  }
}

function clampImageScale(value: number) {
  return Math.min(6, Math.max(0.25, value))
}

function resetImagePreviewView() {
  imagePreviewScale.value = 1
  imagePreviewOffset.x = 0
  imagePreviewOffset.y = 0
  imagePreviewDragging.value = false
}

function resetImagePreview() {
  imagePreviewUrl.value = ''
  imagePreviewName.value = ''
  previewMediaType.value = 'image'
  resetImagePreviewView()
}

function openImagePreview(row: TosRow) {
  if (!row.url) return
  imagePreviewUrl.value = row.url
  imagePreviewName.value = row.name || row.key
  previewMediaType.value = 'image'
  resetImagePreviewView()
  imagePreviewOpen.value = true
}

function openMediaPreview(row: TosRow) {
  if (!row.url) return
  if (row.type === 'image') {
    openImagePreview(row)
    return
  }
  if (row.type !== 'video') {
    window.open(row.url, '_blank', 'noopener,noreferrer')
    return
  }
  imagePreviewUrl.value = row.url
  imagePreviewName.value = row.name || row.key
  previewMediaType.value = 'video'
  resetImagePreviewView()
  imagePreviewOpen.value = true
}

function closeImagePreview() {
  imagePreviewOpen.value = false
}

function zoomImagePreview(delta: number) {
  const nextScale = clampImageScale(imagePreviewScale.value + delta)
  imagePreviewScale.value = nextScale
  if (nextScale <= 1) {
    imagePreviewOffset.x = 0
    imagePreviewOffset.y = 0
    imagePreviewDragging.value = false
  }
}

function handleImagePreviewWheel(event: WheelEvent) {
  const step = event.deltaY < 0 ? 0.25 : -0.25
  zoomImagePreview(step)
}

function startImagePreviewDrag(event: MouseEvent) {
  if (imagePreviewScale.value <= 1) return
  imagePreviewDragging.value = true
  imagePreviewDragStart.x = event.clientX
  imagePreviewDragStart.y = event.clientY
  imagePreviewDragStart.offsetX = imagePreviewOffset.x
  imagePreviewDragStart.offsetY = imagePreviewOffset.y
}

function moveImagePreviewDrag(event: MouseEvent) {
  if (!imagePreviewDragging.value) return
  imagePreviewOffset.x = imagePreviewDragStart.offsetX + event.clientX - imagePreviewDragStart.x
  imagePreviewOffset.y = imagePreviewDragStart.offsetY + event.clientY - imagePreviewDragStart.y
}

function stopImagePreviewDrag() {
  imagePreviewDragging.value = false
}

function goParent() {
  const normalized = normalizePrefix(prefixInput.value)
  const scopeRoot = selectedMemberRootPrefix()
  if (!normalized || normalized === scopeRoot) return
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  const parent = parts.join('/')
  prefixInput.value = parent === scopeRoot || parent.startsWith(`${scopeRoot}/`) ? parent : scopeRoot
  searchQuery.value = ''
  resetPagination()
  void fetchFiles()
}

function goRoot() {
  prefixInput.value = selectedMemberRootPrefix()
  searchQuery.value = ''
  resetPagination()
  void fetchFiles()
}

onMounted(async () => {
  restoreViewState()
  await loadMembers()
  if (selectedMemberAccount.value !== '__all__' && !members.value.some(member => member.account === selectedMemberAccount.value)) {
    selectedMemberAccount.value = '__all__'
    activeAssetDirectory.value = 'all'
  }
  await openAssetDirectory(activeAssetDirectory.value)
})
</script>

<style scoped>
.tos-files-shortcuts {
  display: flex;
  margin-left: auto;
  gap: 8px;
  align-items: center;
}

.tos-member-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tos-member-select {
  width: min(360px, 100%);
}

.tos-files-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 160px 120px auto;
  gap: 8px;
  align-items: center;
}

@media (max-width: 640px) {
  .tos-member-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .tos-member-select {
    width: 100%;
  }

  .tos-files-shortcuts {
    margin-left: 0;
  }

  .tos-files-toolbar {
    grid-template-columns: 1fr;
  }
}

.tos-files-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tos-breadcrumbs {
  display: flex;
  min-width: 0;
  align-items: center;
  overflow-x: auto;
  white-space: nowrap;
}

.tos-breadcrumbs__separator {
  margin: 0 6px;
  color: #98a2b3;
}

.tos-files-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tos-files-select-fallback {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: 34px;
  border: 1px solid rgb(224, 224, 230);
  border-radius: 3px;
  padding: 0 12px;
  background: #fff;
  color: rgb(51, 54, 57);
  font-size: 14px;
}

:deep(.tos-media-preview) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 104px;
  height: 72px;
  overflow: hidden;
  border: 1px solid rgb(239, 239, 245);
  border-radius: 6px;
  background: #f7f8fa;
  color: #667085;
  font-size: 12px;
}

:deep(.tos-media-preview__image) {
  display: block;
  width: 96px;
  height: 64px;
  max-width: 96px;
  max-height: 64px;
  object-fit: cover;
}

:deep(.tos-media-preview__button) {
  display: block;
  width: 96px;
  height: 64px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  cursor: zoom-in;
}

:deep(.tos-media-preview__video-button) {
  background: #eef1f5;
  color: #475467;
  font-size: 12px;
}

:deep(.tos-media-preview--folder),
:deep(.tos-media-preview--file),
:deep(.tos-media-preview--empty) {
  height: 48px;
}

.tos-image-viewer {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  padding: 28px;
  overflow: hidden;
  cursor: zoom-in;
  user-select: none;
}

.tos-image-viewer--pannable {
  cursor: grab;
}

.tos-image-viewer--dragging {
  cursor: grabbing;
}

.tos-image-viewer__close {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 1;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.38);
  color: #fff;
  cursor: pointer;
  font-size: 18px;
  line-height: 32px;
  opacity: 0;
}

.tos-image-viewer:hover .tos-image-viewer__close,
.tos-image-viewer__close:focus-visible,
.tos-image-viewer__close:hover {
  opacity: 0.9;
}

.tos-image-viewer__image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: auto;
  transform-origin: center center;
  transition: transform 0.08s ease;
  user-select: none;
}

.tos-image-viewer__video {
  display: block;
  width: min(1120px, 100%);
  max-height: calc(100vh - 56px);
  background: #000;
  object-fit: contain;
}

:deep(.n-data-table-th) {
  white-space: nowrap;
}

@media (max-width: 760px) {
  .tos-files-toolbar,
  .tos-files-meta {
    grid-template-columns: 1fr;
  }

  .tos-files-toolbar {
    display: grid;
  }

  .tos-files-meta {
    display: grid;
  }
}
</style>
