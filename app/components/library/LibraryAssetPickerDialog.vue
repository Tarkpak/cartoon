<script setup lang="ts">
import type { LibraryAsset, LibraryAssetCategory } from '#shared/types/library'
import { LIBRARY_CATEGORY_LABELS, libraryPermissionCanUse } from '#shared/types/library'
import { AudioLines, Check, ImageIcon, Loader2, Search } from 'lucide-vue-next'
import { listAllLibraryAssets } from '@/lib/library-api'

const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  categories: LibraryAssetCategory[]
  targets?: Array<{ id: string, name: string }>
  allowCreate?: boolean
}>(), {
  title: '从资源库选择',
  targets: () => [],
  allowCreate: true
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  'select': [payload: { asset: LibraryAsset, targetId?: string, createNew: boolean }]
}>()

const loading = ref(false)
const assets = ref<LibraryAsset[]>([])
const keyword = ref('')
const selectedId = ref('')
const targetId = ref('')
const createNew = ref(props.allowCreate)

const filteredAssets = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  return assets.value.filter((asset) => {
    if (!libraryPermissionCanUse(asset.permission)) return false
    if (!props.categories.includes(asset.category)) return false
    if (!query) return true
    return [asset.name, asset.description, ...asset.tags]
      .some(value => value.toLocaleLowerCase().includes(query))
  })
})

const selectedAsset = computed(() => assets.value.find(asset => asset.id === selectedId.value))

async function load() {
  loading.value = true
  try {
    assets.value = await listAllLibraryAssets()
  } finally {
    loading.value = false
  }
}

function confirmSelection() {
  if (!selectedAsset.value) return
  emit('select', {
    asset: selectedAsset.value,
    targetId: createNew.value ? undefined : targetId.value || undefined,
    createNew: createNew.value
  })
  emit('update:open', false)
}

watch(() => props.open, (open) => {
  if (!open) return
  selectedId.value = ''
  targetId.value = props.targets[0]?.id || ''
  createNew.value = props.allowCreate
  void load()
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex max-h-[86vh] max-w-4xl flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>选择资源后会保留来源关联，项目中同时保存当前版本快照。</DialogDescription>
      </DialogHeader>
      <div class="relative">
        <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="keyword" class="pl-9" placeholder="搜索资源" />
      </div>
      <div v-if="loading" class="flex min-h-64 items-center justify-center"><Loader2 class="h-6 w-6 animate-spin text-primary" /></div>
      <div v-else-if="filteredAssets.length === 0" class="flex min-h-64 items-center justify-center text-sm text-muted-foreground">资源库中没有可使用的匹配素材</div>
      <div v-else class="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
        <button v-for="asset in filteredAssets" :key="asset.id" type="button" class="relative overflow-hidden rounded-xl bg-muted/25 text-left transition-colors" :class="selectedId === asset.id ? 'bg-primary/8 ring-2 ring-primary/20' : 'hover:bg-muted/30'" @click="selectedId = asset.id">
          <div class="aspect-square overflow-hidden bg-muted">
            <img v-if="asset.mediaType === 'image'" :src="asset.url" :alt="asset.name" class="h-full w-full object-cover">
            <div v-else class="flex h-full items-center justify-center"><AudioLines class="h-9 w-9 text-muted-foreground" /></div>
          </div>
          <div class="p-2.5"><p class="truncate text-sm font-medium">{{ asset.name }}</p><p class="mt-0.5 text-xs text-muted-foreground">{{ LIBRARY_CATEGORY_LABELS[asset.category] }}</p></div>
          <span v-if="selectedId === asset.id" class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check class="h-4 w-4" /></span>
        </button>
      </div>
      <div v-if="selectedAsset && targets.length" class="grid gap-3 border-t pt-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <label v-if="allowCreate" class="flex items-center gap-2 text-sm"><input v-model="createNew" type="checkbox" class="h-4 w-4 rounded border-0 bg-muted"> 作为新资产加入</label>
        <select v-if="!createNew" v-model="targetId" class="h-9 rounded-xl bg-muted/25 px-3 text-sm"><option v-for="target in targets" :key="target.id" :value="target.id">替换：{{ target.name }}</option></select>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">取消</Button>
        <Button :disabled="!selectedAsset || (!createNew && targets.length > 0 && !targetId)" @click="confirmSelection">使用资源</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
