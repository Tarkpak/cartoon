<script setup lang="ts">
import type {
  LibraryAsset,
  LibraryAssetCategory,
  LibraryAssetShare,
  LibraryAssetVersion,
  LibraryMediaType
} from '#shared/types/library'
import { LIBRARY_CATEGORY_LABELS, libraryCategoryMediaType } from '#shared/types/library'
import {
  AlertTriangle,
  AudioLines,
  Check,
  Clock3,
  Copy,
  FileAudio,
  FileImage,
  FolderOpen,
  Heart,
  History,
  ImageIcon,
  Link,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Tags,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-vue-next'
import AppPage from '@/components/layout/AppPage.vue'
import AppPageContent from '@/components/layout/AppPageContent.vue'
import AppPageHeader from '@/components/layout/AppPageHeader.vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  batchUpdateLibraryAssets,
  createLibraryAsset,
  deleteLibraryAsset,
  fileSha256,
  fileToLibraryDataUrl,
  getLibraryAsset,
  listAllLibraryAssets,
  listLibraryMembers,
  perceptualHashDistance,
  readAudioDuration,
  readImageMetadata,
  readRemoteLibraryMetadata,
  updateLibraryAsset
} from '@/lib/library-api'

definePageMeta({ layout: 'default' })

const categories: Array<{ id: LibraryAssetCategory | 'all', label: string, mediaType?: LibraryMediaType }> = [
  { id: 'all', label: '全部资源' },
  { id: 'character', label: '角色图', mediaType: 'image' },
  { id: 'environment', label: '场景图', mediaType: 'image' },
  { id: 'prop', label: '道具图', mediaType: 'image' },
  { id: 'style', label: '画风参考', mediaType: 'image' },
  { id: 'character_voice', label: '角色音色', mediaType: 'audio' },
  { id: 'narration', label: '旁白', mediaType: 'audio' },
  { id: 'bgm', label: '背景音乐', mediaType: 'audio' },
  { id: 'sfx', label: '音效', mediaType: 'audio' },
  { id: 'other', label: '其他' }
]

interface PendingLibraryImport {
  fileName: string
  name: string
  mediaType: LibraryMediaType
  category: LibraryAssetCategory
  mediaData: string
  mimeType: string
  sizeBytes: number
  durationMs?: number
  width?: number
  height?: number
  contentHash?: string
  perceptualHash?: string
}

const assets = ref<LibraryAsset[]>([])
const loading = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const selectedCategory = ref<LibraryAssetCategory | 'all'>('all')
const selectedMediaType = ref<LibraryMediaType | 'all'>('all')
const favoritesOnly = ref(false)
const recentOnly = ref(false)
const showRecycleBin = ref(false)
const selectedIds = ref<string[]>([])
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref({ current: 0, total: 0, name: '' })
const isDragging = ref(false)
const urlDialogOpen = ref(false)
const urlForm = reactive({
  url: '',
  name: '',
  category: 'character' as LibraryAssetCategory,
  tagsText: '',
  copyrightNote: '',
  licenseExpiresAt: ''
})
const pendingImportDialogOpen = ref(false)
const pendingImports = shallowRef<PendingLibraryImport[]>([])
const importSharedForm = reactive({ tagsText: '', sourceUrl: '', copyrightNote: '', licenseExpiresAt: '' })
const editDialogOpen = ref(false)
const editingAsset = ref<LibraryAsset | null>(null)
const editForm = reactive({
  name: '',
  description: '',
  category: 'other' as LibraryAssetCategory,
  tagsText: '',
  sourceUrl: '',
  copyrightNote: '',
  licenseExpiresAt: '',
  visibility: 'private' as 'private' | 'shared',
  characterName: '',
  appearance: '',
  generationPrompt: '',
  gender: '',
  age: '',
  clothing: '',
  frontAssetId: '',
  sideAssetId: '',
  backAssetId: '',
  expressionAssetIds: [] as string[],
  poseAssetIds: [] as string[],
  voiceAssetId: ''
})
const members = ref<Array<{ id: string, account: string, displayName: string, role: string }>>([])
const memberPermissions = ref<Record<string, '' | 'view' | 'use' | 'edit'>>({})
const batchDialogOpen = ref(false)
const batchTagsText = ref('')
const batchCategory = ref<LibraryAssetCategory>('character')
const previewAsset = ref<LibraryAsset | null>(null)
const saving = ref(false)
const versions = ref<LibraryAssetVersion[]>([])
const versionLoading = ref(false)
const replacementInput = ref<HTMLInputElement | null>(null)
const replacementFile = ref<File | null>(null)
const replacementChangeNote = ref('')

const { toast } = useToast()

const filteredAssets = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return assets.value.filter((asset) => {
    if (showRecycleBin.value !== !!asset.deletedAt) return false
    if (selectedCategory.value !== 'all' && asset.category !== selectedCategory.value) return false
    if (selectedMediaType.value !== 'all' && asset.mediaType !== selectedMediaType.value) return false
    if (favoritesOnly.value && !asset.favorite) return false
    if (recentOnly.value && !asset.lastUsedAt) return false
    if (!query) return true
    return [asset.name, asset.description, asset.sourceUrl, ...asset.tags]
      .filter(Boolean)
      .some(value => value?.toLocaleLowerCase().includes(query))
  }).sort((left, right) => recentOnly.value
    ? Date.parse(right.lastUsedAt || '') - Date.parse(left.lastUsedAt || '')
    : Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
})

const groupedCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const asset of assets.value) {
    if (!!asset.deletedAt !== showRecycleBin.value) continue
    counts.set(asset.category, (counts.get(asset.category) || 0) + 1)
  }
  return counts
})

const exactDuplicateIds = computed(() => {
  const duplicate = new Set<string>()
  for (let leftIndex = 0; leftIndex < assets.value.length; leftIndex += 1) {
    const left = assets.value[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < assets.value.length; rightIndex += 1) {
      const right = assets.value[rightIndex]!
      const exact = !!left.contentHash && left.contentHash === right.contentHash
      if (exact) {
        duplicate.add(left.id)
        duplicate.add(right.id)
      }
    }
  }
  return duplicate
})

const similarImageIds = computed(() => {
  const similar = new Set<string>()
  for (let leftIndex = 0; leftIndex < assets.value.length; leftIndex += 1) {
    const left = assets.value[leftIndex]!
    for (let rightIndex = leftIndex + 1; rightIndex < assets.value.length; rightIndex += 1) {
      const right = assets.value[rightIndex]!
      if (left.contentHash && left.contentHash === right.contentHash) continue
      const distance = left.mediaType === 'image' && right.mediaType === 'image'
        ? perceptualHashDistance(left.perceptualHash, right.perceptualHash)
        : undefined
      if (distance !== undefined && distance <= 8) {
        similar.add(left.id)
        similar.add(right.id)
      }
    }
  }
  return similar
})

const imageAssets = computed(() => assets.value.filter(asset => asset.mediaType === 'image'))
const voiceAssets = computed(() => assets.value.filter(asset => asset.category === 'character_voice'))
const editableFilteredAssets = computed(() => filteredAssets.value.filter(asset => asset.permission === 'edit'))
const allSelected = computed(() => editableFilteredAssets.value.length > 0 && editableFilteredAssets.value.every(asset => selectedIds.value.includes(asset.id)))
const selectedAssets = computed(() => assets.value.filter(asset => selectedIds.value.includes(asset.id)))
const batchCategoryOptions = computed(() => {
  const mediaTypes = new Set(selectedAssets.value.map(asset => asset.mediaType))
  if (mediaTypes.size !== 1) return []
  const mediaType = selectedAssets.value[0]?.mediaType
  return categories.filter((category): category is typeof categories[number] & { id: LibraryAssetCategory } => (
    category.id !== 'all' && libraryCategoryMediaType(category.id) === mediaType
  ))
})

function categoryCount(category: LibraryAssetCategory | 'all') {
  return category === 'all'
    ? assets.value.filter(asset => !!asset.deletedAt === showRecycleBin.value).length
    : groupedCounts.value.get(category) || 0
}

const recycleBinCount = computed(() => assets.value.filter(asset => !!asset.deletedAt).length)

function tagsFromText(value: string) {
  return Array.from(new Set(value.split(/[,，\n]/u).map(tag => tag.trim()).filter(Boolean))).slice(0, 30)
}

function inferNameFromUrl(value: string) {
  try {
    const pathName = new URL(value).pathname.split('/').filter(Boolean).at(-1) || ''
    return decodeURIComponent(pathName).replace(/\.[^.]+$/, '')
  } catch {
    return ''
  }
}

watch(() => urlForm.url, (value) => {
  if (!urlForm.name.trim()) urlForm.name = inferNameFromUrl(value)
})

function formatDuration(durationMs?: number) {
  if (!durationMs) return ''
  const seconds = Math.round(durationMs / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function formatDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

function licenseState(asset: LibraryAsset): 'expired' | 'soon' | null {
  if (!asset.licenseExpiresAt) return null
  const remaining = Date.parse(asset.licenseExpiresAt) - Date.now()
  if (!Number.isFinite(remaining)) return null
  if (remaining < 0) return 'expired'
  if (remaining <= 30 * 24 * 60 * 60 * 1000) return 'soon'
  return null
}

async function loadAssets() {
  loading.value = true
  errorMessage.value = ''
  try {
    assets.value = await listAllLibraryAssets({ includeDeleted: true })
    selectedIds.value = selectedIds.value.filter(id => assets.value.some(asset => asset.id === id && asset.permission === 'edit'))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '资源库加载失败'
  } finally {
    loading.value = false
  }
}

async function ensureMembers() {
  if (members.value.length > 0) return
  try {
    members.value = await listLibraryMembers()
  } catch {
    members.value = []
  }
}

function inferCategory(file: File): LibraryAssetCategory {
  if (file.type.startsWith('audio/')) return 'character_voice'
  return selectedCategory.value !== 'all' && libraryCategoryMediaType(selectedCategory.value) === 'image'
    ? selectedCategory.value
    : 'character'
}

async function uploadFiles(files: File[]) {
  const supported = files.filter(file => file.type.startsWith('image/') || file.type.startsWith('audio/'))
  if (supported.length === 0) {
    toast.warning('请选择图片或音频文件')
    return
  }
  uploading.value = true
  uploadProgress.value = { current: 0, total: supported.length, name: '' }
  const prepared: PendingLibraryImport[] = []
  for (const [index, file] of supported.entries()) {
    uploadProgress.value = { current: index + 1, total: supported.length, name: file.name }
    try {
      const mediaType: LibraryMediaType = file.type.startsWith('audio/') ? 'audio' : 'image'
      const [mediaData, contentHash, imageMetadata, durationMs] = await Promise.all([
        fileToLibraryDataUrl(file),
        fileSha256(file),
        readImageMetadata(file).catch(() => ({})),
        readAudioDuration(file).catch(() => undefined)
      ])
      prepared.push({
        fileName: file.name,
        mediaType,
        category: inferCategory(file),
        name: file.name.replace(/\.[^.]+$/, ''),
        mediaData,
        mimeType: file.type,
        sizeBytes: file.size,
        contentHash,
        durationMs,
        ...imageMetadata
      })
    } catch (error) {
      toast.error(`${file.name}: ${error instanceof Error ? error.message : '读取失败'}`)
    }
  }
  uploading.value = false
  if (prepared.length === 0) return
  pendingImports.value = prepared
  Object.assign(importSharedForm, { tagsText: '', sourceUrl: '', copyrightNote: '', licenseExpiresAt: '' })
  pendingImportDialogOpen.value = true
}

async function submitFileImports() {
  if (pendingImports.value.length === 0 || pendingImports.value.some(item => !item.name.trim())) return
  saving.value = true
  uploadProgress.value = { current: 0, total: pendingImports.value.length, name: '' }
  let succeeded = 0
  try {
    for (const [index, item] of pendingImports.value.entries()) {
      uploadProgress.value = { current: index + 1, total: pendingImports.value.length, name: item.fileName }
      try {
        await createLibraryAsset({
          mediaType: item.mediaType,
          category: item.category,
          name: item.name.trim(),
          mediaData: item.mediaData,
          sourceType: 'upload',
          sourceUrl: importSharedForm.sourceUrl.trim() || undefined,
          tags: tagsFromText(importSharedForm.tagsText),
          copyrightNote: importSharedForm.copyrightNote.trim(),
          licenseExpiresAt: importSharedForm.licenseExpiresAt || undefined,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          durationMs: item.durationMs,
          width: item.width,
          height: item.height,
          contentHash: item.contentHash,
          perceptualHash: item.perceptualHash
        })
        succeeded += 1
      } catch (error) {
        toast.error(`${item.fileName}: ${error instanceof Error ? error.message : '上传失败'}`)
      }
    }
    pendingImportDialogOpen.value = false
    pendingImports.value = []
    await loadAssets()
    if (succeeded > 0) toast.success(`已导入 ${succeeded} 个资源`)
  } finally {
    saving.value = false
  }
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadFiles(Array.from(input.files || []))
  input.value = ''
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  void uploadFiles(Array.from(event.dataTransfer?.files || []))
}

async function submitUrlImport() {
  if (!urlForm.url.trim() || !urlForm.name.trim()) return
  saving.value = true
  try {
    const created = await createLibraryAsset({
      mediaType: libraryCategoryMediaType(urlForm.category),
      category: urlForm.category,
      name: urlForm.name.trim(),
      sourceUrl: urlForm.url.trim(),
      sourceType: 'url',
      tags: tagsFromText(urlForm.tagsText),
      copyrightNote: urlForm.copyrightNote.trim(),
      licenseExpiresAt: urlForm.licenseExpiresAt || undefined
    })
    try {
      const metadata = await readRemoteLibraryMetadata(created.url, created.mediaType)
      await updateLibraryAsset(created.id, metadata)
    } catch {
      toast.warning('素材已保存，但无法读取完整格式或时长信息')
    }
    urlDialogOpen.value = false
    Object.assign(urlForm, { url: '', name: '', category: 'character', tagsText: '', copyrightNote: '', licenseExpiresAt: '' })
    await loadAssets()
    toast.success('网络资源已存入资源库')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '网络资源导入失败')
  } finally {
    saving.value = false
  }
}

function openEdit(asset: LibraryAsset) {
  editingAsset.value = asset
  Object.assign(editForm, {
    name: asset.name,
    description: asset.description,
    category: asset.category,
    tagsText: asset.tags.join('，'),
    sourceUrl: asset.sourceUrl || '',
    copyrightNote: asset.copyrightNote,
    licenseExpiresAt: asset.licenseExpiresAt?.slice(0, 10) || '',
    visibility: asset.visibility,
    characterName: asset.bundle?.characterName || '',
    appearance: asset.bundle?.appearance || '',
    generationPrompt: asset.bundle?.generationPrompt || '',
    gender: asset.bundle?.gender || '',
    age: asset.bundle?.age ? String(asset.bundle.age) : '',
    clothing: asset.bundle?.clothing || '',
    frontAssetId: asset.bundle?.viewAssetIds?.front || '',
    sideAssetId: asset.bundle?.viewAssetIds?.side || '',
    backAssetId: asset.bundle?.viewAssetIds?.back || '',
    expressionAssetIds: asset.bundle?.expressionAssetIds || [],
    poseAssetIds: asset.bundle?.poseAssetIds || [],
    voiceAssetId: asset.bundle?.voiceAssetId || ''
  })
  memberPermissions.value = Object.fromEntries(asset.shares.map(share => [share.userId, share.permission]))
  versions.value = []
  replacementFile.value = null
  replacementChangeNote.value = ''
  editDialogOpen.value = true
  void ensureMembers()
  versionLoading.value = true
  void getLibraryAsset(asset.id)
    .then((detail) => {
      if (editingAsset.value?.id === asset.id) versions.value = detail.versions
    })
    .catch(() => {
      if (editingAsset.value?.id === asset.id) versions.value = []
    })
    .finally(() => {
      if (editingAsset.value?.id === asset.id) versionLoading.value = false
    })
}

function handleReplacementInput(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !editingAsset.value) return
  const expectedPrefix = editingAsset.value.mediaType === 'image' ? 'image/' : 'audio/'
  if (!file.type.startsWith(expectedPrefix)) {
    toast.warning(editingAsset.value.mediaType === 'image' ? '请选择图片文件' : '请选择音频文件')
    return
  }
  replacementFile.value = file
}

async function replaceAssetFile() {
  const asset = editingAsset.value
  const file = replacementFile.value
  if (!asset || !file) return
  saving.value = true
  try {
    const [mediaData, contentHash, imageMetadata, durationMs] = await Promise.all([
      fileToLibraryDataUrl(file),
      fileSha256(file),
      readImageMetadata(file).catch(() => ({})),
      readAudioDuration(file).catch(() => undefined)
    ])
    await updateLibraryAsset(asset.id, {
      mediaData,
      mimeType: file.type,
      sizeBytes: file.size,
      contentHash,
      durationMs,
      changeNote: replacementChangeNote.value.trim(),
      ...imageMetadata
    })
    const detail = await getLibraryAsset(asset.id)
    editingAsset.value = detail.asset
    versions.value = detail.versions
    replacementFile.value = null
    replacementChangeNote.value = ''
    const index = assets.value.findIndex(item => item.id === asset.id)
    if (index >= 0) assets.value[index] = detail.asset
    toast.success(`已更新为版本 ${detail.asset.version}`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '替换文件失败')
  } finally {
    saving.value = false
  }
}

async function saveEdit() {
  if (!editingAsset.value || !editForm.name.trim()) return
  saving.value = true
  try {
    const shares: LibraryAssetShare[] = members.value.flatMap((member) => {
      const permission = memberPermissions.value[member.id]
      return permission ? [{ userId: member.id, account: member.account, displayName: member.displayName, permission }] : []
    })
    const viewAssetIds = Object.fromEntries([
      ['front', editForm.frontAssetId],
      ['side', editForm.sideAssetId],
      ['back', editForm.backAssetId]
    ].filter(([, id]) => id))
    await updateLibraryAsset(editingAsset.value.id, {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      category: editForm.category,
      tags: tagsFromText(editForm.tagsText),
      sourceUrl: editForm.sourceUrl.trim() || undefined,
      copyrightNote: editForm.copyrightNote.trim(),
      licenseExpiresAt: editForm.licenseExpiresAt || undefined,
      visibility: shares.length > 0 ? 'shared' : editForm.visibility,
      shares,
      bundle: editForm.category === 'character'
        ? {
            characterName: editForm.characterName.trim() || editForm.name.trim(),
            appearance: editForm.appearance.trim() || undefined,
            generationPrompt: editForm.generationPrompt.trim() || undefined,
            gender: editForm.gender.trim() || undefined,
            age: Number.isFinite(Number(editForm.age)) && Number(editForm.age) > 0 ? Number(editForm.age) : undefined,
            clothing: editForm.clothing.trim() || undefined,
            baseImageAssetId: editingAsset.value.id,
            viewAssetIds: Object.keys(viewAssetIds).length > 0 ? viewAssetIds : undefined,
            expressionAssetIds: editForm.expressionAssetIds.length > 0 ? editForm.expressionAssetIds : undefined,
            poseAssetIds: editForm.poseAssetIds.length > 0 ? editForm.poseAssetIds : undefined,
            voiceAssetId: editForm.voiceAssetId || undefined
          }
        : undefined
    })
    editDialogOpen.value = false
    await loadAssets()
    toast.success('资源信息已更新')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleFavorite(asset: LibraryAsset) {
  try {
    const updated = await updateLibraryAsset(asset.id, { favorite: !asset.favorite })
    const index = assets.value.findIndex(item => item.id === asset.id)
    if (index >= 0) assets.value[index] = updated
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '收藏失败')
  }
}

async function removeAsset(asset: LibraryAsset) {
  if (!confirm(`确认将“${asset.name}”移入回收站？`)) return
  try {
    await deleteLibraryAsset(asset.id)
    assets.value = assets.value.filter(item => item.id !== asset.id)
    selectedIds.value = selectedIds.value.filter(id => id !== asset.id)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '删除失败')
  }
}

async function restoreAsset(asset: LibraryAsset) {
  try {
    await updateLibraryAsset(asset.id, { restore: true })
    await loadAssets()
    toast.success('资源已恢复')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '恢复失败')
  }
}

function toggleSelected(id: string) {
  if (assets.value.find(asset => asset.id === id)?.permission !== 'edit') return
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(item => item !== id)
    : [...selectedIds.value, id]
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value
    ? selectedIds.value.filter(id => !editableFilteredAssets.value.some(asset => asset.id === id))
    : Array.from(new Set([...selectedIds.value, ...editableFilteredAssets.value.map(asset => asset.id)]))
}

async function applyBatchTags() {
  saving.value = true
  try {
    await batchUpdateLibraryAssets({ ids: selectedIds.value, action: 'tags', tags: tagsFromText(batchTagsText.value) })
    batchDialogOpen.value = false
    selectedIds.value = []
    await loadAssets()
  } finally {
    saving.value = false
  }
}

async function batchFavorite() {
  await batchUpdateLibraryAssets({ ids: selectedIds.value, action: 'favorite', favorite: true })
  selectedIds.value = []
  await loadAssets()
}

async function applyBatchCategory() {
  if (!batchCategoryOptions.value.some(category => category.id === batchCategory.value)) return
  saving.value = true
  try {
    await batchUpdateLibraryAssets({ ids: selectedIds.value, action: 'category', category: batchCategory.value })
    selectedIds.value = []
    await loadAssets()
  } finally {
    saving.value = false
  }
}

watch(batchCategoryOptions, (options) => {
  if (options.length > 0 && !options.some(option => option.id === batchCategory.value)) {
    batchCategory.value = options[0]!.id
  }
})

async function batchDelete() {
  if (!confirm(`确认将所选 ${selectedIds.value.length} 个资源移入回收站？`)) return
  saving.value = true
  try {
    await batchUpdateLibraryAssets({ ids: selectedIds.value, action: 'delete' })
    selectedIds.value = []
    await loadAssets()
  } finally {
    saving.value = false
  }
}

onMounted(() => void loadAssets())
</script>

<template>
  <AppPage>
    <AppPageHeader title="个人资源库" description="收藏并复用角色、场景、声音和制作素材。">
      <template #actions>
        <input ref="uploadInput" type="file" multiple accept="image/*,audio/*" class="hidden" @change="handleFileInput">
        <Button variant="outline" class="gap-2" @click="urlDialogOpen = true">
          <Link class="h-4 w-4" />
          网址导入
        </Button>
        <Button class="gap-2" @click="uploadInput?.click()">
          <Upload class="h-4 w-4" />
          上传资源
        </Button>
      </template>
    </AppPageHeader>

    <AppPageContent class="min-h-0" inner-class="flex h-full min-h-0 gap-0">
      <aside class="hidden w-52 shrink-0 overflow-y-auto border-r pr-3 lg:block">
        <nav class="space-y-1 py-3" aria-label="资源分类">
          <button
            v-for="category in categories"
            :key="category.id"
            type="button"
            class="flex h-9 w-full items-center justify-between rounded-md px-3 text-sm transition-colors"
            :class="selectedCategory === category.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="selectedCategory = category.id"
          >
            <span>{{ category.label }}</span>
            <span class="text-xs tabular-nums">{{ categoryCount(category.id) }}</span>
          </button>
        </nav>
        <div class="mt-3 border-t pt-3">
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors"
            :class="favoritesOnly ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="favoritesOnly = !favoritesOnly"
          >
            <Heart class="h-4 w-4" :class="favoritesOnly ? 'fill-current' : ''" />
            我的收藏
          </button>
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors"
            :class="recentOnly ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="recentOnly = !recentOnly; showRecycleBin = false"
          >
            <Clock3 class="h-4 w-4" />
            最近使用
          </button>
          <button
            type="button"
            class="flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm transition-colors"
            :class="showRecycleBin ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="showRecycleBin = !showRecycleBin; recentOnly = false; favoritesOnly = false; selectedIds = []"
          >
            <Trash2 class="h-4 w-4" />
            <span class="flex-1 text-left">回收站</span>
            <span class="text-xs tabular-nums">{{ recycleBinCount }}</span>
          </button>
        </div>
      </aside>

      <main
        class="relative flex min-w-0 flex-1 flex-col"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent
        @dragleave.self="isDragging = false"
        @drop.prevent="handleDrop"
      >
        <div class="flex flex-wrap items-center gap-2 border-b px-3 py-3 md:px-5">
          <div class="relative min-w-[220px] flex-1 md:max-w-md">
            <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input v-model="keyword" class="pl-9" placeholder="搜索名称、标签或来源" />
          </div>
          <div class="flex rounded-md border bg-muted/50 p-0.5" aria-label="媒体类型">
            <button v-for="option in [['all', '全部'], ['image', '图片'], ['audio', '音频']]" :key="option[0]" type="button" class="h-8 rounded px-3 text-sm" :class="selectedMediaType === option[0] ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'" @click="selectedMediaType = option[0] as typeof selectedMediaType">
              {{ option[1] }}
            </button>
          </div>
          <Button variant="ghost" size="icon" title="刷新" @click="loadAssets">
            <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
          </Button>
        </div>

        <div v-if="selectedIds.length" class="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 md:px-5">
          <button type="button" class="text-sm font-medium" @click="toggleSelectAll">
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <span class="text-sm text-muted-foreground">已选 {{ selectedIds.length }} 项</span>
          <Button size="sm" variant="outline" class="gap-1.5" @click="batchFavorite"><Heart class="h-3.5 w-3.5" />收藏</Button>
          <Button size="sm" variant="outline" class="gap-1.5" @click="batchDialogOpen = true"><Tags class="h-3.5 w-3.5" />标签</Button>
          <select v-model="batchCategory" :disabled="batchCategoryOptions.length === 0" class="h-8 rounded-md border bg-background px-2 text-xs">
            <option v-for="category in batchCategoryOptions" :key="category.id" :value="category.id">{{ category.label }}</option>
          </select>
          <Button size="sm" variant="outline" :disabled="saving || batchCategoryOptions.length === 0" @click="applyBatchCategory">分类</Button>
          <Button v-if="!showRecycleBin" size="sm" variant="destructive" class="gap-1.5" :disabled="saving" @click="batchDelete"><Trash2 class="h-3.5 w-3.5" />删除</Button>
          <Button size="sm" variant="ghost" class="ml-auto" @click="selectedIds = []"><X class="mr-1 h-3.5 w-3.5" />取消</Button>
        </div>

        <div v-if="errorMessage" class="m-5 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {{ errorMessage }}
        </div>

        <div v-if="loading && assets.length === 0" class="grid flex-1 auto-rows-max grid-cols-2 gap-3 overflow-hidden p-3 md:grid-cols-3 md:p-5 xl:grid-cols-4 2xl:grid-cols-5">
          <div v-for="index in 10" :key="index" class="aspect-[4/5] animate-pulse rounded-md border bg-muted/60" />
        </div>

        <div v-else-if="filteredAssets.length === 0" class="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <FolderOpen class="mb-4 h-10 w-10 text-muted-foreground" />
          <h2 class="text-base font-semibold">暂无匹配资源</h2>
          <p class="mt-1 max-w-sm text-sm text-muted-foreground">上传图片或音频，也可以将网上的资源地址导入为稳定的云端文件。</p>
          <Button class="mt-4 gap-2" @click="uploadInput?.click()"><Plus class="h-4 w-4" />添加资源</Button>
        </div>

        <div v-else class="grid flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto p-3 md:grid-cols-3 md:p-5 xl:grid-cols-4 2xl:grid-cols-5">
          <article v-for="asset in filteredAssets" :key="asset.id" class="group relative min-w-0 overflow-hidden rounded-md border bg-card transition-colors hover:border-primary/50">
            <button v-if="asset.permission === 'edit'" type="button" class="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded border bg-background/90 shadow-sm" :aria-label="selectedIds.includes(asset.id) ? '取消选择' : '选择资源'" @click.stop="toggleSelected(asset.id)">
              <Check v-if="selectedIds.includes(asset.id)" class="h-4 w-4 text-primary" />
            </button>
            <button v-if="!asset.deletedAt && asset.permission === 'edit'" type="button" class="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-background/90 shadow-sm" :title="asset.favorite ? '取消收藏' : '收藏'" @click.stop="toggleFavorite(asset)">
              <Heart class="h-4 w-4" :class="asset.favorite ? 'fill-primary text-primary' : ''" />
            </button>

            <button type="button" class="relative block aspect-square w-full overflow-hidden bg-muted text-left" @click="previewAsset = asset">
              <img v-if="asset.mediaType === 'image'" :src="asset.url" :alt="asset.name" class="h-full w-full object-cover" loading="lazy">
              <div v-else class="flex h-full flex-col items-center justify-center bg-[linear-gradient(145deg,hsl(var(--muted)),hsl(var(--accent)))] px-4">
                <span class="flex h-12 w-12 items-center justify-center rounded-full bg-background/80 shadow-sm"><Play class="ml-0.5 h-5 w-5" /></span>
                <span class="mt-3 text-sm font-medium">{{ formatDuration(asset.durationMs) || '音频预览' }}</span>
              </div>
            </button>

            <div class="space-y-2 p-3">
              <div class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <h3 class="truncate text-sm font-semibold" :title="asset.name">{{ asset.name }}</h3>
                  <p class="mt-0.5 text-xs text-muted-foreground">{{ LIBRARY_CATEGORY_LABELS[asset.category] }}<span v-if="asset.ownerDisplayName && asset.permission !== 'edit'"> / {{ asset.ownerDisplayName }}</span></p>
                </div>
                <button v-if="!asset.deletedAt && asset.permission === 'edit'" type="button" class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑" @click="openEdit(asset)"><MoreHorizontal class="h-4 w-4" /></button>
                <button v-else-if="asset.deletedAt && asset.permission === 'edit'" type="button" class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="恢复" @click="restoreAsset(asset)"><RotateCcw class="h-4 w-4" /></button>
              </div>
              <div v-if="asset.tags.length" class="flex min-h-5 flex-wrap gap-1">
                <span v-for="tag in asset.tags.slice(0, 3)" :key="tag" class="max-w-24 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{{ tag }}</span>
              </div>
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span v-if="asset.permission !== 'edit'">{{ asset.permission === 'use' ? '可使用' : '仅查看' }}</span>
                <span>使用 {{ asset.useCount }} 次</span>
                <span v-if="asset.lastUsedAt">最近 {{ formatDate(asset.lastUsedAt) }}</span>
                <span v-if="asset.sizeBytes">{{ (asset.sizeBytes / 1024 / 1024).toFixed(asset.sizeBytes >= 1024 * 1024 ? 1 : 2) }} MB</span>
                <span v-if="asset.mimeType">{{ asset.mimeType.split('/').at(-1)?.toUpperCase() }}</span>
              </div>
              <div v-if="exactDuplicateIds.has(asset.id) || similarImageIds.has(asset.id) || licenseState(asset)" class="flex flex-wrap gap-1.5 text-[11px]">
                <span v-if="exactDuplicateIds.has(asset.id)" class="inline-flex items-center gap-1 text-destructive"><Copy class="h-3 w-3" />重复素材</span>
                <span v-else-if="similarImageIds.has(asset.id)" class="inline-flex items-center gap-1 text-warning"><Copy class="h-3 w-3" />相似图片</span>
                <span v-if="licenseState(asset)" class="inline-flex items-center gap-1" :class="licenseState(asset) === 'expired' ? 'text-destructive' : 'text-warning'"><AlertTriangle class="h-3 w-3" />{{ licenseState(asset) === 'expired' ? '授权已到期' : '授权即将到期' }}</span>
              </div>
            </div>
          </article>
        </div>

        <div v-if="isDragging" class="absolute inset-3 z-30 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/95">
          <div class="text-center"><Upload class="mx-auto h-9 w-9 text-primary" /><p class="mt-3 font-medium">松开即可导入图片或音频</p></div>
        </div>
        <div v-if="uploading" class="absolute bottom-4 right-4 z-40 w-72 rounded-md border bg-background p-4 shadow-lg">
          <div class="flex items-center gap-3"><Loader2 class="h-5 w-5 animate-spin text-primary" /><div class="min-w-0"><p class="text-sm font-medium">正在导入 {{ uploadProgress.current }}/{{ uploadProgress.total }}</p><p class="truncate text-xs text-muted-foreground">{{ uploadProgress.name }}</p></div></div>
        </div>
      </main>
    </AppPageContent>

    <Dialog v-model:open="pendingImportDialogOpen">
      <DialogContent class="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>补充素材信息</DialogTitle><DialogDescription>确认名称和分类后再保存原始文件。</DialogDescription></DialogHeader>
        <div class="space-y-3">
          <div v-for="(item, index) in pendingImports" :key="`${item.fileName}-${index}`" class="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <label class="min-w-0 space-y-1"><span class="text-xs text-muted-foreground">素材名称</span><Input v-model="item.name" /></label>
            <label class="space-y-1"><span class="text-xs text-muted-foreground">分类</span><select v-model="item.category" class="h-10 w-full rounded-md border bg-background px-3 text-sm"><option v-for="category in categories.filter(option => option.id !== 'all' && libraryCategoryMediaType(option.id as LibraryAssetCategory) === item.mediaType)" :key="category.id" :value="category.id">{{ category.label }}</option></select></label>
            <p class="truncate text-xs text-muted-foreground sm:col-span-2" :title="item.fileName">{{ item.fileName }} · {{ item.mimeType || '未知格式' }} · {{ (item.sizeBytes / 1024 / 1024).toFixed(2) }} MB<span v-if="item.durationMs"> · {{ formatDuration(item.durationMs) }}</span></p>
          </div>
        </div>
        <div class="grid gap-4 border-t pt-4 md:grid-cols-2">
          <label class="space-y-2"><span class="text-sm font-medium">标签</span><Input v-model="importSharedForm.tagsText" placeholder="用逗号分隔" /></label>
          <label class="space-y-2"><span class="text-sm font-medium">授权到期日</span><Input v-model="importSharedForm.licenseExpiresAt" type="date" /></label>
          <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">原始来源网址</span><Input v-model="importSharedForm.sourceUrl" type="url" placeholder="https://" /></label>
          <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">作者或版权备注</span><textarea v-model="importSharedForm.copyrightNote" rows="3" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
        </div>
        <DialogFooter><Button variant="outline" @click="pendingImportDialogOpen = false">取消</Button><Button :disabled="saving || pendingImports.length === 0 || pendingImports.some(item => !item.name.trim())" @click="submitFileImports"><Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />保存 {{ pendingImports.length }} 个素材</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="urlDialogOpen">
      <DialogContent>
        <DialogHeader><DialogTitle>从网址导入</DialogTitle><DialogDescription>文件会下载并重新保存到 TOS，避免原链接失效。</DialogDescription></DialogHeader>
        <div class="space-y-4">
          <label class="block space-y-2"><span class="text-sm font-medium">网络地址</span><Input v-model="urlForm.url" type="url" placeholder="https://" /></label>
          <label class="block space-y-2"><span class="text-sm font-medium">资源名称</span><Input v-model="urlForm.name" /></label>
          <label class="block space-y-2"><span class="text-sm font-medium">分类</span><select v-model="urlForm.category" class="h-10 w-full rounded-md border bg-background px-3 text-sm"><option v-for="category in categories.filter(item => item.id !== 'all')" :key="category.id" :value="category.id">{{ category.label }}</option></select></label>
          <label class="block space-y-2"><span class="text-sm font-medium">标签</span><Input v-model="urlForm.tagsText" placeholder="用逗号分隔" /></label>
          <label class="block space-y-2"><span class="text-sm font-medium">授权到期日</span><Input v-model="urlForm.licenseExpiresAt" type="date" /></label>
          <label class="block space-y-2"><span class="text-sm font-medium">作者或版权备注</span><textarea v-model="urlForm.copyrightNote" rows="3" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
        </div>
        <DialogFooter><Button variant="outline" @click="urlDialogOpen = false">取消</Button><Button :disabled="saving || !urlForm.url.trim() || !urlForm.name.trim()" @click="submitUrlImport"><Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />导入</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="editDialogOpen">
      <DialogContent class="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>编辑资源</DialogTitle><DialogDescription>管理分类、标签、角色包、授权信息和团队权限。</DialogDescription></DialogHeader>
        <div class="grid gap-4 md:grid-cols-2">
          <label class="space-y-2"><span class="text-sm font-medium">名称</span><Input v-model="editForm.name" /></label>
          <label class="space-y-2"><span class="text-sm font-medium">分类</span><select v-model="editForm.category" class="h-10 w-full rounded-md border bg-background px-3 text-sm"><option v-for="category in categories.filter(item => item.id !== 'all')" :key="category.id" :value="category.id">{{ category.label }}</option></select></label>
          <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">描述</span><textarea v-model="editForm.description" rows="3" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
          <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">标签</span><Input v-model="editForm.tagsText" placeholder="用逗号分隔" /></label>
          <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">原始来源网址</span><Input v-model="editForm.sourceUrl" type="url" placeholder="https://" /></label>
          <label class="space-y-2"><span class="text-sm font-medium">授权到期日</span><Input v-model="editForm.licenseExpiresAt" type="date" /></label>
          <label class="space-y-2"><span class="text-sm font-medium">可见性</span><select v-model="editForm.visibility" class="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="private">仅自己</option><option value="shared">指定成员</option></select></label>
          <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">来源与授权备注</span><textarea v-model="editForm.copyrightNote" rows="3" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>

          <div v-if="editingAsset?.permission === 'edit'" class="space-y-3 border-t pt-4 md:col-span-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2"><History class="h-4 w-4" /><h3 class="text-sm font-semibold">文件版本</h3><span class="text-xs text-muted-foreground">当前 v{{ editingAsset.version }}</span></div>
              <input ref="replacementInput" type="file" :accept="editingAsset.mediaType === 'image' ? 'image/*' : 'audio/*'" class="hidden" @change="handleReplacementInput">
              <Button type="button" size="sm" variant="outline" class="gap-1.5" @click="replacementInput?.click()"><Upload class="h-3.5 w-3.5" />选择替换文件</Button>
            </div>
            <div v-if="replacementFile" class="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
              <p class="truncate text-sm font-medium" :title="replacementFile.name">{{ replacementFile.name }}</p>
              <Input v-model="replacementChangeNote" placeholder="版本说明（可选）" />
              <Button type="button" size="sm" :disabled="saving" @click="replaceAssetFile"><Loader2 v-if="saving" class="mr-2 h-3.5 w-3.5 animate-spin" />替换并新增版本</Button>
            </div>
            <div v-if="versionLoading" class="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 class="h-4 w-4 animate-spin" />正在读取版本</div>
            <div v-else class="max-h-36 space-y-1 overflow-y-auto">
              <div v-for="version in versions" :key="version.id" class="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded border px-3 py-2 text-xs">
                <strong>v{{ version.version }}</strong>
                <span class="truncate text-muted-foreground">{{ version.changeNote || '文件更新' }}</span>
                <span class="text-muted-foreground">{{ formatDate(version.createdAt) }}</span>
              </div>
              <p v-if="versions.length === 0" class="py-2 text-sm text-muted-foreground">暂无版本记录</p>
            </div>
          </div>

          <template v-if="editForm.category === 'character'">
            <div class="md:col-span-2 border-t pt-4"><div class="flex items-center gap-2"><Package class="h-4 w-4" /><h3 class="text-sm font-semibold">角色包</h3></div></div>
            <label class="space-y-2"><span class="text-sm font-medium">角色名</span><Input v-model="editForm.characterName" /></label>
            <label class="space-y-2"><span class="text-sm font-medium">关联音色</span><select v-model="editForm.voiceAssetId" class="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">不关联</option><option v-for="asset in voiceAssets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
            <label class="space-y-2"><span class="text-sm font-medium">性别</span><Input v-model="editForm.gender" /></label>
            <label class="space-y-2"><span class="text-sm font-medium">年龄感</span><Input v-model="editForm.age" type="number" min="1" /></label>
            <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">服装</span><Input v-model="editForm.clothing" /></label>
            <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">外观描述</span><textarea v-model="editForm.appearance" rows="3" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
            <label class="space-y-2 md:col-span-2"><span class="text-sm font-medium">生成提示词</span><textarea v-model="editForm.generationPrompt" rows="3" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
            <label v-for="view in [['frontAssetId', '正面'], ['sideAssetId', '侧面'], ['backAssetId', '背面']]" :key="view[0]" class="space-y-2"><span class="text-sm font-medium">{{ view[1] }}图</span><select v-model="editForm[view[0] as 'frontAssetId']" class="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">未设置</option><option v-for="asset in imageAssets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
            <label class="space-y-2"><span class="text-sm font-medium">表情参考</span><select v-model="editForm.expressionAssetIds" multiple class="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"><option v-for="asset in imageAssets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
            <label class="space-y-2"><span class="text-sm font-medium">动作参考</span><select v-model="editForm.poseAssetIds" multiple class="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"><option v-for="asset in imageAssets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select></label>
          </template>

          <div v-if="editingAsset?.permission === 'edit'" class="md:col-span-2 border-t pt-4">
            <div class="mb-3 flex items-center gap-2"><Users class="h-4 w-4" /><h3 class="text-sm font-semibold">团队共享</h3></div>
            <div v-if="members.length === 0" class="text-sm text-muted-foreground">暂无可共享成员</div>
            <div v-else class="grid gap-2 sm:grid-cols-2">
              <label v-for="member in members" :key="member.id" class="flex items-center gap-3 rounded-md border p-3"><div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{{ member.displayName }}</p><p class="truncate text-xs text-muted-foreground">{{ member.account }}</p></div><select v-model="memberPermissions[member.id]" class="h-8 rounded border bg-background px-2 text-xs"><option value="">不共享</option><option value="view">查看</option><option value="use">使用</option><option value="edit">编辑</option></select></label>
            </div>
          </div>
        </div>
        <DialogFooter class="sm:justify-between"><Button v-if="editingAsset?.permission === 'edit'" variant="destructive" class="gap-2" @click="editingAsset && removeAsset(editingAsset); editDialogOpen = false"><Trash2 class="h-4 w-4" />移入回收站</Button><div class="flex gap-2"><Button variant="outline" @click="editDialogOpen = false">取消</Button><Button :disabled="saving || !editForm.name.trim()" @click="saveEdit"><Loader2 v-if="saving" class="mr-2 h-4 w-4 animate-spin" />保存</Button></div></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!previewAsset" @update:open="value => { if (!value) previewAsset = null }">
      <DialogContent class="max-w-4xl">
        <DialogHeader><DialogTitle>{{ previewAsset?.name }}</DialogTitle><DialogDescription>{{ previewAsset ? LIBRARY_CATEGORY_LABELS[previewAsset.category] : '' }}</DialogDescription></DialogHeader>
        <img v-if="previewAsset?.mediaType === 'image'" :src="previewAsset.url" :alt="previewAsset.name" class="max-h-[70vh] w-full rounded-md bg-muted object-contain">
        <div v-else-if="previewAsset" class="rounded-md border bg-muted/40 p-6"><audio :src="previewAsset.url" controls autoplay class="w-full" /></div>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="batchDialogOpen">
      <DialogContent><DialogHeader><DialogTitle>批量设置标签</DialogTitle><DialogDescription>将覆盖所选 {{ selectedIds.length }} 个资源的标签。</DialogDescription></DialogHeader><Input v-model="batchTagsText" placeholder="用逗号分隔" /><DialogFooter><Button variant="outline" @click="batchDialogOpen = false">取消</Button><Button :disabled="saving" @click="applyBatchTags">应用</Button></DialogFooter></DialogContent>
    </Dialog>
  </AppPage>
</template>
