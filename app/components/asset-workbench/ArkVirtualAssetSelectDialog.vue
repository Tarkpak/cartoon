<script setup lang="ts">
import { Check, ImageIcon, Loader2, RefreshCw, Search } from 'lucide-vue-next'
import type {
  ArkVirtualAssetGroup,
  ArkVirtualAssetListItem
} from '~/lib/ark-virtual-assets'
import {
  listArkVirtualAssetGroups,
  listArkVirtualAssets
} from '~/lib/ark-virtual-assets'
import type { ArkVirtualAssetBinding } from '~/lib/asset-workbench-types'

const props = defineProps<{
  open: boolean
  characterName?: string
  currentAssetId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [asset: ArkVirtualAssetBinding]
}>()

const { toast } = useToast()

const groupNameFilter = ref('')
const projectNameFilter = ref('')
const assetNameFilter = ref('')
const selectedGroupId = ref('')
const groups = ref<ArkVirtualAssetGroup[]>([])
const assets = ref<ArkVirtualAssetListItem[]>([])
const loadingGroups = ref(false)
const loadingAssets = ref(false)
const credentialFingerprint = ref<string>()

const selectedGroup = computed(() => {
  return groups.value.find(group => group.Id === selectedGroupId.value)
})

function assetPreviewUrl(asset: ArkVirtualAssetListItem): string {
  const url = typeof asset.URL === 'string' ? asset.URL.trim() : ''
  if (!url) return ''
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) {
    return url
  }
  return ''
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

async function refreshGroups() {
  loadingGroups.value = true
  try {
    const page = await listArkVirtualAssetGroups({
      name: groupNameFilter.value.trim() || undefined,
      projectName: projectNameFilter.value.trim() || undefined,
      pageNumber: 1,
      pageSize: 50
    })
    groups.value = page.items
    if (!selectedGroupId.value || !groups.value.some(group => group.Id === selectedGroupId.value)) {
      selectedGroupId.value = groups.value[0]?.Id || ''
    }
    await refreshAssets()
  } catch (error) {
    toast.error('查询素材组失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    loadingGroups.value = false
  }
}

async function refreshAssets() {
  loadingAssets.value = true
  try {
    const page = await listArkVirtualAssets({
      groupId: selectedGroupId.value || undefined,
      name: assetNameFilter.value.trim() || undefined,
      status: 'Active',
      projectName: projectNameFilter.value.trim() || selectedGroup.value?.ProjectName || undefined,
      pageNumber: 1,
      pageSize: 80
    })
    assets.value = page.items.filter(asset => asset.Status === 'Active')
    credentialFingerprint.value = page.credentialFingerprint
  } catch (error) {
    toast.error('查询素材失败', {
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    loadingAssets.value = false
  }
}

function selectAsset(asset: ArkVirtualAssetListItem) {
  emit('select', {
    provider: 'volcengine',
    libraryType: 'virtual_human',
    projectName: asset.ProjectName || selectedGroup.value?.ProjectName || projectNameFilter.value.trim() || 'default',
    groupId: asset.GroupId || selectedGroupId.value,
    assetId: asset.Id,
    assetType: asset.AssetType || 'Image',
    sourceUrl: asset.URL,
    name: asset.Name || props.characterName,
    status: 'Active',
    credentialFingerprint: credentialFingerprint.value,
    updatedAt: new Date().toISOString()
  })
  emit('update:open', false)
}

watch(selectedGroupId, () => {
  if (props.open) void refreshAssets()
})

watch(
  () => props.open,
  (open) => {
    if (open) void refreshGroups()
  }
)
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent class="max-h-[82vh] sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>选择火山虚拟人像</DialogTitle>
        <DialogDescription>
          绑定到{{ characterName ? `「${characterName}」` : '当前角色' }}后，火山生成会自动使用 asset URI。
        </DialogDescription>
      </DialogHeader>

      <div class="grid min-h-[520px] gap-3 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
        <section class="flex min-h-0 flex-col rounded-md border">
          <div class="space-y-2 border-b p-3">
            <Input
              v-model="groupNameFilter"
              class="h-8 text-xs"
              placeholder="搜索素材组"
              @keydown.enter="refreshGroups"
            />
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <Input
                v-model="projectNameFilter"
                class="h-8 text-xs"
                placeholder="方舟项目：默认 default"
                @keydown.enter="refreshGroups"
              />
              <Button
                size="sm"
                variant="outline"
                class="h-8 px-2"
                :disabled="loadingGroups"
                @click="refreshGroups"
              >
                <Search class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <button
              v-for="group in groups"
              :key="group.Id"
              type="button"
              class="w-full border-b px-3 py-3 text-left transition-colors hover:bg-muted/40"
              :class="selectedGroupId === group.Id ? 'bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]' : ''"
              @click="selectedGroupId = group.Id"
            >
              <p class="truncate text-sm font-medium">{{ group.Name || group.Title || group.Id }}</p>
              <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{{ group.Id }}</p>
              <p class="mt-1 truncate text-xs text-muted-foreground">
                {{ group.ProjectName || 'default' }} · {{ formatDateTime(group.UpdateTime || group.CreateTime) }}
              </p>
            </button>
            <div
              v-if="loadingGroups"
              class="flex h-24 items-center justify-center text-sm text-muted-foreground"
            >
              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              查询素材组
            </div>
            <div
              v-else-if="groups.length === 0"
              class="px-4 py-10 text-center text-sm text-muted-foreground"
            >
              没有素材组
            </div>
          </div>
        </section>

        <section class="flex min-h-0 flex-col rounded-md border">
          <div class="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-medium">
                {{ selectedGroup ? (selectedGroup.Name || selectedGroup.Id) : 'Active 素材' }}
              </h3>
              <p class="mt-1 text-xs text-muted-foreground">仅显示可用于生成的 Active 图片素材</p>
            </div>
            <div class="flex gap-2">
              <Input
                v-model="assetNameFilter"
                class="h-8 w-48 text-xs"
                placeholder="搜索素材"
                @keydown.enter="refreshAssets"
              />
              <Button
                size="sm"
                variant="outline"
                class="h-8 gap-2"
                :disabled="loadingAssets"
                @click="refreshAssets"
              >
                <RefreshCw
                  class="h-3.5 w-3.5"
                  :class="loadingAssets ? 'animate-spin' : ''"
                />
                刷新
              </Button>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <div
              v-if="loadingAssets"
              class="flex h-32 items-center justify-center text-sm text-muted-foreground"
            >
              <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              查询素材
            </div>
            <div
              v-else-if="assets.length === 0"
              class="flex h-full min-h-56 flex-col items-center justify-center text-center text-muted-foreground"
            >
              <ImageIcon class="h-8 w-8 opacity-40" />
              <p class="mt-2 text-sm">没有可绑定的 Active 素材</p>
            </div>
            <div v-else>
              <button
                v-for="asset in assets"
                :key="asset.Id"
                type="button"
                class="grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-muted/40"
                :class="currentAssetId === asset.Id ? 'bg-primary/10' : ''"
                @click="selectAsset(asset)"
              >
                <div class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
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
                  <p class="mt-1 truncate text-xs text-muted-foreground">
                    {{ asset.GroupId || selectedGroupId }} · {{ formatDateTime(asset.UpdateTime || asset.CreateTime) }}
                  </p>
                </div>
                <div
                  v-if="currentAssetId === asset.Id"
                  class="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
                >
                  <Check class="h-4 w-4" />
                </div>
              </button>
            </div>
          </div>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
