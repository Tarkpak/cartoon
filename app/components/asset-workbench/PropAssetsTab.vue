<script setup lang="ts">
import { AlertTriangle, AudioLines, Clapperboard, Image as ImageIcon, Package, Plus, Search } from 'lucide-vue-next'
import PropAssetCard from './PropAssetCard.vue'
import type {
  PropAsset,
  PropAssetCategory,
  PropAssetMediaType
} from '~/composables/useAssetWorkflowMeta'
import { resolvePropAssetMediaType } from '~/lib/asset-workbench-prop-media'
import { useIncrementalList } from '~/composables/useIncrementalList'

const props = withDefaults(defineProps<{
  propAssets: PropAsset[]
  autoRunning: boolean
  savingLibraryAssetKey?: string | null
  uploadingPropId: string | null
  uploadingPropVoiceId?: string | null
  uploadingPropVideoId?: string | null
  generatingPropId: string | null
  getPropUsageCount: (propId: string) => number
  /** 当前分镜视频模型是否支持视频参考；null 表示未知 */
  videoReferenceSupported?: boolean | null
  allowAdd?: boolean
  allowVoiceUpload?: boolean
  enableMediaSubTabs?: boolean
  addCategory?: PropAssetCategory
  assetLabel?: string
  addNamePlaceholder?: string
  addDescriptionPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
}>(), {
  allowAdd: true,
  addCategory: 'prop',
  allowVoiceUpload: false,
  enableMediaSubTabs: false,
  uploadingPropVoiceId: null,
  uploadingPropVideoId: null,
  videoReferenceSupported: null
})

const emit = defineEmits<{
  'save-to-library': [propId: string]
  'add-prop': [payload: {
    name: string
    description: string
    category: PropAssetCategory
    mediaType?: PropAssetMediaType
  }]
  'remove-prop': [propId: string]
  'generate-prop': [propId: string]
  'upload-image': [payload: { propId: string, event: Event }]
  'upload-voice': [payload: { propId: string, event: Event }]
  'upload-video': [payload: { propId: string, event: Event }]
  'update-voice-lock': [payload: { propId: string, locked: boolean }]
  'open-history': [propId: string]
  'preview-image': [payload: { src: string | undefined, alt: string }]
}>()

interface MediaTabCopy {
  label: string
  dialogDescription: string
  namePlaceholder: string
  descriptionPlaceholder: string
  emptyDescription: string
  usageHint: string
}

const MEDIA_TABS: Array<{ key: PropAssetMediaType, label: string, icon: typeof ImageIcon }> = [
  { key: 'image', label: '图片', icon: ImageIcon },
  { key: 'voice', label: '声音', icon: AudioLines },
  { key: 'video', label: '视频', icon: Clapperboard }
]

const MEDIA_TAB_COPY: Record<PropAssetMediaType, MediaTabCopy> = {
  image: {
    label: '图片资产',
    dialogDescription: '创建后可上传参考图或直接 AI 生成资产图。',
    namePlaceholder: '资产名称，如：手电筒',
    descriptionPlaceholder: '可选描述，如：金属外壳，冷白光',
    emptyDescription: '新增需要保持一致的图片素材，可上传参考图或 AI 生成。',
    usageHint: '在分镜描述中 @ 引用后，生成视频时作为参考图提交。'
  },
  voice: {
    label: '声音资产',
    dialogDescription: '创建后上传音频，锁定后含旁白的镜头会优先复用该音色。',
    namePlaceholder: '声音资产名称，如：旁白音色',
    descriptionPlaceholder: '可选描述，如：低沉、沉稳、温和',
    emptyDescription: '上传旁白或音色参考音频，锁定后含旁白的镜头会优先复用。',
    usageHint: '锁定的声音资产会作为含旁白镜头的音色参考。'
  },
  video: {
    label: '视频资产',
    dialogDescription: '创建后上传参考视频，在分镜描述中 @ 引用后会作为参考视频提交给支持视频参考的模型。',
    namePlaceholder: '视频资产名称，如：打斗动作参考',
    descriptionPlaceholder: '可选描述，如：参考运镜与动作节奏',
    emptyDescription: '上传动作、运镜或特效参考视频，供全模态视频模型参考。',
    usageHint: '在分镜描述中 @ 引用后，生成视频时作为参考视频提交。'
  }
}

const searchKeyword = ref('')
const addPropDialogOpen = ref(false)
const newPropName = ref('')
const newPropDescription = ref('')
const activeMediaTab = ref<PropAssetMediaType>('image')
const mediaTabItems = computed(() => MEDIA_TABS.map(tab => ({
  value: tab.key,
  label: tab.label,
  icon: tab.icon,
  badge: mediaTabCounts.value[tab.key]
})))

const showMediaSubTabs = computed(() => {
  return props.allowVoiceUpload && props.enableMediaSubTabs && props.addCategory === 'other'
})
const currentMediaType = computed<PropAssetMediaType>(() => showMediaSubTabs.value ? activeMediaTab.value : 'image')
const activeCopy = computed<MediaTabCopy>(() => {
  if (showMediaSubTabs.value) return MEDIA_TAB_COPY[activeMediaTab.value]
  const label = props.assetLabel || '道具'
  return {
    ...MEDIA_TAB_COPY.image,
    label,
    emptyDescription: props.emptyDescription || `手动新增需要保持一致的${label}，可上传参考图或 AI 生成。`
  }
})
const mentionTypeLabel = computed(() => props.addCategory === 'other' ? '其他' : '道具')
const showVideoCapabilityWarning = computed(() => {
  return showMediaSubTabs.value && activeMediaTab.value === 'video' && props.videoReferenceSupported === false
})

const mediaTabCounts = computed(() => {
  const counts: Record<PropAssetMediaType, number> = { image: 0, voice: 0, video: 0 }
  for (const asset of props.propAssets) {
    counts[resolvePropAssetMediaType(asset)] += 1
  }
  return counts
})

const tabFilteredPropAssets = computed(() => {
  if (!showMediaSubTabs.value) return props.propAssets
  return props.propAssets.filter(asset => resolvePropAssetMediaType(asset) === activeMediaTab.value)
})

const normalizedSearchKeyword = computed(() => searchKeyword.value.trim().toLowerCase())

const displayedPropAssets = computed(() => {
  const keyword = normalizedSearchKeyword.value
  if (!keyword) return tabFilteredPropAssets.value

  return tabFilteredPropAssets.value.filter((asset) => {
    return `${asset.name || ''} ${asset.description || ''}`.toLowerCase().includes(keyword)
  })
})

const {
  sentinel: propLoadMoreSentinel,
  visibleItems: visiblePropAssets,
  hasMore: hasMorePropAssets,
  loadMore: loadMorePropAssets
} = useIncrementalList(() => displayedPropAssets.value, {
  getKey: asset => asset.id,
  resetKey: () => [normalizedSearchKeyword.value, activeMediaTab.value]
})

watch(showMediaSubTabs, (enabled) => {
  if (enabled) return
  activeMediaTab.value = 'image'
})

watch(addPropDialogOpen, (open) => {
  if (open) return
  newPropName.value = ''
  newPropDescription.value = ''
})

function openAddPropDialog() {
  if (props.autoRunning || props.allowAdd === false) return
  addPropDialogOpen.value = true
}

function closeAddPropDialog() {
  addPropDialogOpen.value = false
}

function handleAddProp() {
  if (props.autoRunning) return

  const name = newPropName.value.trim()
  const description = newPropDescription.value.trim()
  if (!name) {
    useToast().toast.warning(`请先输入${activeCopy.value.label}名称`)
    return
  }

  emit('add-prop', {
    name,
    description,
    category: props.addCategory,
    mediaType: showMediaSubTabs.value ? activeMediaTab.value : undefined
  })
  closeAddPropDialog()
}

function resolveMentionToken(asset: PropAsset): string {
  const name = asset.name?.trim()
  return name ? `@${mentionTypeLabel.value}:${name}` : ''
}

function resolveLibraryAssetKey(asset: PropAsset): string {
  return `${asset.category === 'other' ? 'others' : 'props'}:${asset.id}`
}

function resolveHistoryCount(asset: PropAsset): number {
  return Array.isArray(asset.assetHistory) ? asset.assetHistory.length : 0
}

function isUploading(asset: PropAsset): boolean {
  if (currentMediaType.value === 'voice') return props.uploadingPropVoiceId === asset.id
  if (currentMediaType.value === 'video') return props.uploadingPropVideoId === asset.id
  return props.uploadingPropId === asset.id
}

const uploadBusy = computed(() => {
  if (currentMediaType.value === 'voice') return !!props.uploadingPropVoiceId
  if (currentMediaType.value === 'video') return !!props.uploadingPropVideoId
  return !!props.uploadingPropId
})

function handleUpload(asset: PropAsset, event: Event) {
  const payload = { propId: asset.id, event }
  if (currentMediaType.value === 'voice') emit('upload-voice', payload)
  else if (currentMediaType.value === 'video') emit('upload-video', payload)
  else emit('upload-image', payload)
}

function updateField(assetId: string, field: 'name' | 'description', value: string) {
  const target = props.propAssets.find(item => item.id === assetId)
  if (!target) return
  target[field] = value
}
</script>

<template>
  <div class="space-y-3">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center gap-2">
      <SegmentedTabs
        v-if="showMediaSubTabs"
        v-model="activeMediaTab"
        :items="mediaTabItems"
        size="sm"
        aria-label="素材类型"
      />

      <div class="relative min-w-[12rem] flex-1">
        <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          v-model="searchKeyword"
          class="h-8 pl-8 text-xs"
          :placeholder="`筛选${activeCopy.label}（名称/描述）`"
        />
      </div>
      <Button
        v-if="allowAdd !== false"
        type="button"
        size="sm"
        class="h-8 gap-1.5 px-3 text-xs"
        :disabled="autoRunning"
        @click="openAddPropDialog"
      >
        <Plus class="h-3.5 w-3.5" />
        新增{{ showMediaSubTabs ? activeCopy.label.replace('资产', '') : '' }}
      </Button>
    </div>

    <div
      v-if="showVideoCapabilityWarning"
      class="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <AlertTriangle class="mt-px h-3.5 w-3.5 shrink-0" />
      当前分镜视频模型不支持视频参考，视频资产不会提交给模型。可在设置中切换到支持全模态参考的视频模型。
    </div>
    <p
      v-else-if="showMediaSubTabs && tabFilteredPropAssets.length > 0"
      class="text-xs text-muted-foreground"
    >
      {{ activeCopy.usageHint }}
    </p>

    <Dialog
      :open="addPropDialogOpen"
      @update:open="addPropDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增{{ activeCopy.label }}</DialogTitle>
          <DialogDescription>{{ activeCopy.dialogDescription }}</DialogDescription>
        </DialogHeader>
        <form
          class="space-y-3 py-2"
          @submit.prevent="handleAddProp"
        >
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground">名称</label>
            <Input
              v-model="newPropName"
              class="h-9 text-sm"
              :placeholder="addNamePlaceholder || activeCopy.namePlaceholder"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground">描述（可选）</label>
            <Input
              v-model="newPropDescription"
              class="h-9 text-sm"
              :placeholder="addDescriptionPlaceholder || activeCopy.descriptionPlaceholder"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              :disabled="autoRunning"
              @click="closeAddPropDialog"
            >
              取消
            </Button>
            <Button
              type="submit"
              :disabled="autoRunning"
            >
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Empty state -->
    <div
      v-if="tabFilteredPropAssets.length === 0"
      class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-muted-foreground/20 py-12 text-center text-muted-foreground"
    >
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
        <component
          :is="MEDIA_TABS.find(tab => tab.key === currentMediaType)?.icon || Package"
          class="h-5 w-5 opacity-60"
        />
      </div>
      <p class="text-sm font-medium text-foreground">
        暂无{{ activeCopy.label }}
      </p>
      <p class="max-w-sm text-xs">
        {{ activeCopy.emptyDescription }}
      </p>
      <Button
        v-if="allowAdd !== false"
        type="button"
        size="sm"
        variant="outline"
        class="mt-1 h-8 gap-1.5 text-xs"
        :disabled="autoRunning"
        @click="openAddPropDialog"
      >
        <Plus class="h-3.5 w-3.5" />
        新增{{ activeCopy.label }}
      </Button>
    </div>

    <div
      v-else-if="displayedPropAssets.length === 0"
      class="rounded-xl bg-muted/15 py-10 text-center text-xs text-muted-foreground"
    >
      没有匹配「{{ searchKeyword.trim() }}」的{{ activeCopy.label }}
    </div>

    <!-- Cards -->
    <div
      v-else
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
    >
      <PropAssetCard
        v-for="asset in visiblePropAssets"
        :key="asset.id"
        :asset="asset"
        :media-type="currentMediaType"
        :usage-count="getPropUsageCount(asset.id)"
        :mention-token="resolveMentionToken(asset)"
        :asset-label="showMediaSubTabs ? activeCopy.label.replace('资产', '素材') : (assetLabel || '道具')"
        :auto-running="autoRunning"
        :uploading="isUploading(asset)"
        :upload-busy="uploadBusy"
        :generating="generatingPropId === asset.id"
        :generate-busy="!!generatingPropId || !!uploadingPropId"
        :history-count="resolveHistoryCount(asset)"
        :library-asset-key="resolveLibraryAssetKey(asset)"
        :saving-library-asset-key="savingLibraryAssetKey"
        @update-field="updateField(asset.id, $event.field, $event.value)"
        @upload="handleUpload(asset, $event)"
        @generate="emit('generate-prop', asset.id)"
        @remove="emit('remove-prop', asset.id)"
        @open-history="emit('open-history', asset.id)"
        @save-to-library="emit('save-to-library', asset.id)"
        @preview-image="emit('preview-image', $event)"
        @update-voice-lock="emit('update-voice-lock', { propId: asset.id, locked: $event })"
      />

      <button
        v-if="allowAdd !== false && !hasMorePropAssets && !normalizedSearchKeyword"
        type="button"
        class="flex min-h-[12rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-muted-foreground/20 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="autoRunning"
        @click="openAddPropDialog"
      >
        <Plus class="h-5 w-5" />
        新增{{ activeCopy.label }}
      </button>
    </div>

    <div
      v-if="displayedPropAssets.length > 0 && hasMorePropAssets"
      ref="propLoadMoreSentinel"
      class="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
    >
      已显示 {{ visiblePropAssets.length }} / {{ displayedPropAssets.length }}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs"
        @click="loadMorePropAssets"
      >
        加载更多
      </Button>
    </div>
  </div>
</template>
