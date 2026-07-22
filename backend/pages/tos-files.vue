<template>
  <AdminShell content-mode="fixed">
    <div class="page tos-files-page fixed-table-page">
      <div class="tos-files-content fixed-table-content">
        <div class="tos-files-shortcuts">
          <n-button
            size="small"
            :type="activeAssetDirectory === 'images' ? 'primary' : 'default'"
            :disabled="pending"
            @click="openAssetDirectory('images')"
          >
            images
          </n-button>
          <n-button
            size="small"
            :type="activeAssetDirectory === 'videos' ? 'primary' : 'default'"
            :disabled="pending"
            @click="openAssetDirectory('videos')"
          >
            videos
          </n-button>
        </div>

        <div class="tos-files-toolbar">
          <n-input
            v-model:value="prefixInput"
            clearable
            placeholder="对象前缀，留空查看 bucket 根目录"
            @keyup.enter="loadFromInput"
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
              <div class="tos-files-select-fallback">100 条</div>
            </template>
          </ClientOnly>
          <n-button type="primary" :loading="pending" @click="loadFromInput">查询</n-button>
        </div>

        <n-alert v-if="loadError" type="warning">
          {{ loadError }}
        </n-alert>

        <div v-if="meta" class="tos-files-meta">
          <n-space size="small" align="center">
            <n-tag size="small">Bucket: {{ meta.bucket || '-' }}</n-tag>
            <n-tag size="small" :type="meta.configuredPrefix ? 'info' : 'default'">
              配置前缀: {{ meta.configuredPrefix || '无' }}
            </n-tag>
            <n-tag size="small">
              当前前缀: {{ meta.prefix || '根目录' }}
            </n-tag>
          </n-space>
          <n-space size="small">
            <n-button size="small" :disabled="!canGoParent || pending" @click="goParent">上一级</n-button>
            <n-button size="small" :disabled="!meta.configuredPrefix || pending" @click="goConfiguredPrefix">
              配置前缀
            </n-button>
            <n-button size="small" :disabled="!prefixInput || pending" @click="goRoot">根目录</n-button>
          </n-space>
        </div>

        <n-data-table
          class="fixed-data-table"
          :columns="columns"
          :data="rows"
          :loading="pending"
          :pagination="tablePagination"
          :row-key="rowKey"
          :scroll-x="1220"
          flex-height
        />

        <div v-if="nextContinuationToken" class="tos-files-footer">
          <n-button :loading="loadingMore" @click="loadMore">加载更多</n-button>
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
            v-if="imagePreviewUrl"
            class="tos-image-viewer__image"
            :src="imagePreviewUrl"
            :alt="imagePreviewName"
            :style="imagePreviewStyle"
            loading="lazy"
            draggable="false"
          >
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
type AssetDirectory = 'images' | 'videos'

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
  prefix: string
  delimiter?: string
  maxKeys?: number
  tablePageSize?: number
}

const TOS_FILES_VIEW_STATE_KEY = 'playlet-admin-tos-files-view-state'
const IMAGE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])
const VIDEO_EXTENSIONS = new Set(['avi', 'flv', 'm3u8', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'])
const ASSET_DIRECTORIES = new Set<AssetDirectory>(['images', 'videos'])

const message = useMessage()
const pending = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const prefixInput = ref('')
const activeAssetDirectory = ref<AssetDirectory>('images')
const storageConfiguredPrefix = ref('')
const delimiter = ref('/')
const maxKeys = ref(100)
const meta = ref<TosFilesData | null>(null)
const rows = ref<TosRow[]>([])
const nextContinuationToken = ref('')
const tablePage = ref(1)
const tablePageSize = ref(10)
const imagePreviewOpen = ref(false)
const imagePreviewUrl = ref('')
const imagePreviewName = ref('')
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

const canGoParent = computed(() => Boolean(normalizePrefix(prefixInput.value)))
const imagePreviewStyle = computed(() => ({
  transform: `translate(${imagePreviewOffset.x}px, ${imagePreviewOffset.y}px) scale(${imagePreviewScale.value})`
}))
const tablePagination = computed(() => ({
  page: tablePage.value,
  pageSize: tablePageSize.value,
  pageSizes: [10, 20, 50, 100],
  showSizePicker: true,
  itemCount: rows.value.length,
  prefix: ({ itemCount }: { itemCount: number }) => `已加载 ${itemCount} 项`,
  onUpdatePage: (page: number) => {
    tablePage.value = page
  },
  onUpdatePageSize: (pageSize: number) => {
    tablePageSize.value = pageSize
    tablePage.value = 1
    saveViewState()
  }
}))

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
    width: 170,
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
                onClick: () => openFile(row.url)
              },
              { default: () => '查看' }
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
      { class: 'tos-media-preview' },
      [
        h('video', {
          class: 'tos-media-preview__video',
          src: row.url,
          controls: true,
          muted: true,
          playsinline: true,
          preload: 'metadata'
        })
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
  const currentParts = normalizePrefix(prefixInput.value || meta.value?.prefix || '').split('/').filter(Boolean)
  const index = findLastAssetDirectoryIndex(currentParts)
  if (index >= 0) {
    currentParts[index] = directory
    return currentParts.join('/')
  }
  return joinObjectPath(fallbackBasePrefix, directory)
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

function buildRows(data: TosFilesData) {
  const directories: TosRow[] = data.commonPrefixes.map(prefix => ({
    id: `dir:${prefix}`,
    type: 'directory',
    key: prefix,
    name: `${displayNameForKey(prefix)}/`,
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
    if (!Object.prototype.hasOwnProperty.call(parsed, 'prefix')) return null
    return {
      prefix: normalizePrefix(typeof parsed.prefix === 'string' ? parsed.prefix : ''),
      delimiter: parsed.delimiter === '' || parsed.delimiter === '/' ? parsed.delimiter : undefined,
      maxKeys: optionValueExists(maxKeysOptions, parsed.maxKeys) ? parsed.maxKeys : undefined,
      tablePageSize: optionValueExists(tablePagination.value.pageSizes.map(value => ({ value })), parsed.tablePageSize)
        ? parsed.tablePageSize
        : undefined
    }
  } catch {
    return null
  }
}

function saveViewState(prefix = prefixInput.value) {
  if (!import.meta.client) return
  const state: TosFilesViewState = {
    prefix: normalizePrefix(prefix),
    delimiter: delimiter.value,
    maxKeys: maxKeys.value,
    tablePageSize: tablePageSize.value
  }
  localStorage.setItem(TOS_FILES_VIEW_STATE_KEY, JSON.stringify(state))
}

function restoreViewState() {
  const state = readViewState()
  if (!state) return false
  delimiter.value = state.delimiter ?? delimiter.value
  maxKeys.value = state.maxKeys ?? maxKeys.value
  tablePageSize.value = state.tablePageSize ?? tablePageSize.value
  prefixInput.value = state.prefix
  void fetchFiles()
  return true
}

async function fetchFiles(options: { append?: boolean, useInputPrefix?: boolean, continuationToken?: string } = {}) {
  const append = Boolean(options.append)
  if (append) {
    loadingMore.value = true
  } else {
    pending.value = true
    nextContinuationToken.value = ''
  }
  loadError.value = ''

  try {
    const query: Record<string, string | number> = {
      delimiter: delimiter.value,
      maxKeys: maxKeys.value
    }
    if (options.useInputPrefix !== false) {
      query.prefix = normalizePrefix(prefixInput.value)
    }
    if (options.continuationToken) {
      query.continuationToken = options.continuationToken
    }

    const response = await $fetch<{ data: TosFilesData }>('/api/admin/tos-files', { query })
    meta.value = response.data
    storageConfiguredPrefix.value = normalizePrefix(response.data.configuredPrefix || storageConfiguredPrefix.value)
    syncActiveAssetDirectory(response.data)
    prefixInput.value = stripTrailingSlash(response.data.prefix || '')
    saveViewState(prefixInput.value)
    nextContinuationToken.value = response.data.nextContinuationToken || ''
    rows.value = append
      ? [...rows.value, ...buildRows(response.data)]
      : buildRows(response.data)
    if (!append) {
      tablePage.value = 1
    }
  } catch (error) {
    const text = errorText(error, '加载云端素材失败')
    loadError.value = text
    message.error(text)
    if (!append) {
      meta.value = null
      rows.value = []
    }
  } finally {
    pending.value = false
    loadingMore.value = false
  }
}

function loadFromInput() {
  void fetchFiles()
}

async function ensureStorageConfiguredPrefix() {
  const current = configuredBasePrefix()
  if (current) return current

  const response = await $fetch<{ data: TosStorageConfigData }>('/api/admin/tos-storage/config')
  storageConfiguredPrefix.value = normalizePrefix(response.data.keyPrefix || '')
  return storageConfiguredPrefix.value
}

async function openAssetDirectory(directory: AssetDirectory) {
  activeAssetDirectory.value = directory
  pending.value = true
  loadError.value = ''
  try {
    const basePrefix = await ensureStorageConfiguredPrefix()
    prefixInput.value = assetDirectoryPrefix(directory, basePrefix)
    await fetchFiles()
  } catch (error) {
    const text = errorText(error, '加载云存储配置失败')
    loadError.value = text
    message.error(text)
  } finally {
    pending.value = false
  }
}

function loadMore() {
  if (!nextContinuationToken.value) return
  void fetchFiles({
    append: true,
    continuationToken: nextContinuationToken.value
  })
}

function openDirectory(prefix: string) {
  prefixInput.value = stripTrailingSlash(prefix)
  void fetchFiles()
}

function openFile(url: string) {
  if (!url || !import.meta.client) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

function downloadFile(row: TosRow) {
  if (!row.key || !import.meta.client) return
  const query = new URLSearchParams({ key: row.key, filename: row.name })
  window.location.assign(`/api/admin/tos-files/download?${query.toString()}`)
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
  resetImagePreviewView()
}

function openImagePreview(row: TosRow) {
  if (!row.url) return
  imagePreviewUrl.value = row.url
  imagePreviewName.value = row.name || row.key
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
  const parts = normalized.split('/').filter(Boolean)
  parts.pop()
  prefixInput.value = parts.join('/')
  void fetchFiles()
}

function goConfiguredPrefix() {
  if (!meta.value?.configuredPrefix) return
  prefixInput.value = meta.value.configuredPrefix
  void fetchFiles()
}

function goRoot() {
  prefixInput.value = ''
  void fetchFiles()
}

onMounted(() => {
  if (!restoreViewState()) {
    void openAssetDirectory('images')
  }
})
</script>

<style scoped>
.tos-files-shortcuts {
  display: flex;
  gap: 8px;
  align-items: center;
}

.tos-files-toolbar {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) 132px 104px auto;
  gap: 8px;
  align-items: center;
}

.tos-files-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tos-files-footer {
  display: flex;
  justify-content: flex-end;
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

:deep(.tos-media-preview__video) {
  display: block;
  width: 104px;
  height: 72px;
  max-width: 104px;
  max-height: 72px;
  background: #111827;
  object-fit: contain;
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
