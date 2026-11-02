<script setup lang="ts">
import { AudioLines, Clapperboard, History, ImageUp, Loader2, Lock, Package, Plus, Sparkles, Trash2 } from 'lucide-vue-next'
import LazyImage from '~/components/LazyImage.vue'
import SaveToPersonalLibraryButton from './SaveToPersonalLibraryButton.vue'
import type {
  PropAsset,
  PropAssetCategory,
  PropAssetMediaType
} from '~/composables/useAssetWorkflowMeta'
import { buildAssetUploadInputId } from '~/lib/asset-workbench-types'
import { useIncrementalList } from '~/composables/useIncrementalList'

type OtherAssetMediaSubTab = PropAssetMediaType
const OTHER_ASSET_VOICE_HINT_REGEX = /(旁白|画外音|voiceover|narration|音色|声线|配音|旁述)/iu

const props = withDefaults(defineProps<{
  propAssets: PropAsset[]
  autoRunning: boolean
  savingLibraryAssetKey?: string | null
  uploadingPropId: string | null
  uploadingPropVoiceId?: string | null
  uploadingPropVideoId?: string | null
  generatingPropId: string | null
  getPropUsageCount: (propId: string) => number
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
  uploadingPropVideoId: null
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

const searchKeyword = ref('')
const addPropDialogOpen = ref(false)
const newPropName = ref('')
const newPropDescription = ref('')
const failedImageKeys = ref<Set<string>>(new Set())
const otherAssetMediaSubTab = ref<OtherAssetMediaSubTab>('image')

const showMediaSubTabs = computed(() => {
  return props.allowVoiceUpload && props.enableMediaSubTabs && props.addCategory === 'other'
})

function resolveOtherAssetMediaType(prop: PropAsset): OtherAssetMediaSubTab {
  if (prop.category !== 'other') return 'image'
  if (prop.mediaType) return prop.mediaType
  if (prop.voiceAsset?.audioUrl?.trim()) return 'voice'
  if (prop.videoAsset?.videoUrl?.trim()) return 'video'
  return OTHER_ASSET_VOICE_HINT_REGEX.test(`${prop.name || ''} ${prop.description || ''}`) ? 'voice' : 'image'
}

const MEDIA_SUB_TAB_OPTIONS: Array<{ key: OtherAssetMediaSubTab, label: string }> = [
  { key: 'image', label: '图片资产' },
  { key: 'voice', label: '声音资产' },
  { key: 'video', label: '视频资产' }
]

const MEDIA_SUB_TAB_COPY: Record<OtherAssetMediaSubTab, {
  label: string
  dialogDescription: string
  namePlaceholder: string
  descriptionPlaceholder: string
  emptyDescription: string
}> = {
  image: {
    label: '图片资产',
    dialogDescription: '创建后可上传参考图或直接生成资产图。',
    namePlaceholder: '资产名称，如：手电筒',
    descriptionPlaceholder: '可选描述，如：金属外壳，冷白光',
    emptyDescription: '可新增图片资产并上传参考图。'
  },
  voice: {
    label: '声音资产',
    dialogDescription: '创建后可上传/替换音频并锁定声音参考。',
    namePlaceholder: '声音资产名称，如：旁白音色',
    descriptionPlaceholder: '可选描述，如：低沉、沉稳、温和',
    emptyDescription: '可新增声音资产并上传音频，固定旁白音色。'
  },
  video: {
    label: '视频资产',
    dialogDescription: '创建后上传参考视频，在分镜描述中用 @ 引用后会作为参考视频提交给支持视频参考的模型。',
    namePlaceholder: '视频资产名称，如：打斗动作参考',
    descriptionPlaceholder: '可选描述，如：参考运镜与动作节奏',
    emptyDescription: '可新增视频资产并上传参考视频（动作、运镜、特效），供全模态视频模型参考。'
  }
}

const activeMediaCopy = computed(() => MEDIA_SUB_TAB_COPY[otherAssetMediaSubTab.value])
const showImageSection = computed(() => !showMediaSubTabs.value || otherAssetMediaSubTab.value === 'image')
const showVoiceSection = computed(() => props.allowVoiceUpload && (!showMediaSubTabs.value || otherAssetMediaSubTab.value === 'voice'))
const showVideoSection = computed(() => showMediaSubTabs.value && otherAssetMediaSubTab.value === 'video')

const normalizedSearchKeyword = computed(() => searchKeyword.value.trim().toLowerCase())

const tabFilteredPropAssets = computed(() => {
  if (!showMediaSubTabs.value) return props.propAssets

  return props.propAssets.filter(asset => resolveOtherAssetMediaType(asset) === otherAssetMediaSubTab.value)
})

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
  resetKey: () => [normalizedSearchKeyword.value, otherAssetMediaSubTab.value]
})

watch(showMediaSubTabs, (enabled) => {
  if (enabled) return
  otherAssetMediaSubTab.value = 'image'
})

watch(addPropDialogOpen, (open) => {
  if (open) return
  newPropName.value = ''
  newPropDescription.value = ''
})

watch(
  () => props.propAssets.map(prop => `${prop.id}:${prop.referenceImage || ''}`).join('|'),
  () => {
    failedImageKeys.value = new Set(
      Array.from(failedImageKeys.value).filter((key) => {
        return props.propAssets.some(prop => buildImageLoadKey(prop) === key)
      })
    )
  }
)

function openAddPropDialog() {
  if (props.autoRunning || props.allowAdd === false) return
  addPropDialogOpen.value = true
}

function closeAddPropDialog() {
  addPropDialogOpen.value = false
  newPropName.value = ''
  newPropDescription.value = ''
}

function handleAddProp() {
  if (props.autoRunning) return

  const name = newPropName.value.trim()
  const description = newPropDescription.value.trim()
  if (!name) {
    useToast().toast.warning(showMediaSubTabs.value
      ? `请先输入${activeMediaCopy.value.label}名称`
      : '请先输入资产名称')
    return
  }

  emit('add-prop', {
    name,
    description,
    category: props.addCategory,
    mediaType: showMediaSubTabs.value ? otherAssetMediaSubTab.value : undefined
  })
  closeAddPropDialog()
}

function triggerUploadInput(propId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('prop', propId)) as HTMLInputElement | null
  input?.click()
}

function triggerVoiceUploadInput(propId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('prop_voice', propId)) as HTMLInputElement | null
  input?.click()
}

function triggerVideoUploadInput(propId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('prop_video', propId)) as HTMLInputElement | null
  input?.click()
}

function resolveVideoUpdatedText(prop: PropAsset): string {
  const updatedAt = prop.videoAsset?.updatedAt
  if (!updatedAt) return ''
  const parsed = new Date(updatedAt)
  if (Number.isNaN(parsed.getTime())) return ''
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

function resolveHistoryCount(prop: PropAsset): number {
  return Array.isArray(prop.assetHistory) ? prop.assetHistory.length : 0
}

function resolveGenerateLabel(prop: PropAsset): string {
  if (props.generatingPropId === prop.id) return '生成中'
  return prop.referenceImage ? '重新生成' : '生成'
}

function resolveVoiceSourceLabel(prop: PropAsset): string {
  if (!prop.voiceAsset?.audioUrl) return '暂无旁白参考音频'
  if (prop.voiceAsset.sourceSceneId || prop.voiceAsset.sourceTaskId) return '自动提取'
  return '手动上传'
}

function resolveVoiceUpdatedText(prop: PropAsset): string {
  const updatedAt = prop.voiceAsset?.updatedAt
  if (!updatedAt) return ''
  const parsed = new Date(updatedAt)
  if (Number.isNaN(parsed.getTime())) return ''
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  const hours = String(parsed.getHours()).padStart(2, '0')
  const minutes = String(parsed.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

function hasImageLoadFailed(propId: string): boolean {
  const prop = props.propAssets.find(item => item.id === propId)
  return !!prop && failedImageKeys.value.has(buildImageLoadKey(prop))
}

function markImageLoadFailed(propId: string) {
  const prop = props.propAssets.find(item => item.id === propId)
  if (!prop) return
  const next = new Set(failedImageKeys.value)
  next.add(buildImageLoadKey(prop))
  failedImageKeys.value = next
}

function buildImageLoadKey(prop: PropAsset): string {
  return `${prop.id}:${prop.referenceImage || ''}`
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="showMediaSubTabs"
      class="rounded-xl bg-muted/20 p-1"
    >
      <div class="grid grid-cols-3 gap-1">
        <Button
          v-for="option in MEDIA_SUB_TAB_OPTIONS"
          :key="option.key"
          type="button"
          size="sm"
          variant="ghost"
          class="h-7 text-xs"
          :class="otherAssetMediaSubTab === option.key
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'"
          @click="otherAssetMediaSubTab = option.key"
        >
          {{ option.label }}
        </Button>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Input
        v-model="searchKeyword"
        class="h-8 flex-1 text-xs"
        :placeholder="showMediaSubTabs
          ? `筛选${activeMediaCopy.label}（名称/描述）`
          : `筛选${assetLabel || '道具'}（名称/描述）`"
      />
      <Button
        v-if="allowAdd !== false"
        type="button"
        size="sm"
        class="h-8 gap-1.5 px-3 text-xs"
        :disabled="autoRunning"
        @click="openAddPropDialog"
      >
        <Plus class="h-3 w-3" />
        添加
      </Button>
    </div>

    <Dialog
      :open="addPropDialogOpen"
      @update:open="addPropDialogOpen = $event"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {{ showMediaSubTabs ? `新增${activeMediaCopy.label}` : `新增${assetLabel || '资产'}` }}
          </DialogTitle>
          <DialogDescription>
            {{ showMediaSubTabs ? activeMediaCopy.dialogDescription : '创建后可上传参考图或直接生成资产图。' }}
          </DialogDescription>
        </DialogHeader>
        <form
          class="space-y-3 py-2"
          @submit.prevent="handleAddProp"
        >
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground">
              名称
            </label>
            <Input
              v-model="newPropName"
              class="h-9 text-sm"
              :placeholder="addNamePlaceholder || (showMediaSubTabs ? activeMediaCopy.namePlaceholder : '资产名称，如：手电筒')"
            />
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground">
              描述（可选）
            </label>
            <Input
              v-model="newPropDescription"
              class="h-9 text-sm"
              :placeholder="addDescriptionPlaceholder || (showMediaSubTabs ? activeMediaCopy.descriptionPlaceholder : '可选描述，如：金属外壳，冷白光')"
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
      v-if="displayedPropAssets.length === 0"
      class="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/15 py-10 text-muted-foreground"
    >
      <Package class="h-8 w-8 opacity-40" />
      <p class="text-sm">
        {{ showMediaSubTabs ? `暂无${activeMediaCopy.label}` : (emptyTitle || `暂无${assetLabel || '道具'}资产`) }}
      </p>
      <p class="text-xs">
        {{ showMediaSubTabs ? activeMediaCopy.emptyDescription : (emptyDescription || `手动新增需要保持一致的${assetLabel || '道具'}`) }}
      </p>
    </div>

    <!-- Prop cards -->
    <div
      v-else
      class="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3"
    >
      <div
        v-for="prop in visiblePropAssets"
        :key="prop.id"
        class="group rounded-xl bg-muted/25 transition-colors hover:bg-muted/35"
      >
        <div class="flex items-start gap-3 p-3">
          <!-- Thumbnail -->
          <div
            class="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40"
            :class="prop.referenceImage ? 'cursor-zoom-in' : ''"
            @click="prop.referenceImage && emit('preview-image', { src: prop.referenceImage, alt: `${prop.name} 参考图` })"
          >
            <LazyImage
              v-if="prop.referenceImage && !hasImageLoadFailed(prop.id)"
              :image="prop.referenceImage"
              :alt="`${prop.name} 参考图`"
              class="h-full w-full object-cover"
              @error="markImageLoadFailed(prop.id)"
            />
            <div
              v-else-if="prop.referenceImage"
              class="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center"
            >
              <Package class="h-4 w-4 text-destructive/60" />
              <span class="text-xs leading-tight text-destructive/80">图片加载失败</span>
            </div>
            <Clapperboard
              v-else-if="showVideoSection"
              class="h-5 w-5 text-muted-foreground/40"
            />
            <Package
              v-else
              class="h-5 w-5 text-muted-foreground/40"
            />
          </div>

          <!-- Info -->
          <div class="min-w-0 flex-1 space-y-1.5">
            <Input
              v-model="prop.name"
              class="h-7 text-xs"
              :placeholder="`${assetLabel || '道具'}名称`"
            />
            <Input
              v-model="prop.description"
              class="h-7 text-xs"
              :placeholder="`${assetLabel || '道具'}描述（可选）`"
            />
          </div>
        </div>

        <div
          v-if="showVideoSection"
          class="border-t px-3 py-2.5"
        >
          <div class="flex items-center gap-2">
            <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Clapperboard class="h-3.5 w-3.5" />
            </div>
            <div class="min-w-0">
              <p class="text-xs font-medium">
                参考视频
              </p>
              <p class="text-xs text-muted-foreground">
                {{ prop.videoAsset?.videoUrl ? '手动上传' : '暂无参考视频' }}
                <span v-if="resolveVideoUpdatedText(prop)"> · {{ resolveVideoUpdatedText(prop) }}</span>
              </p>
            </div>
          </div>
          <video
            v-if="prop.videoAsset?.videoUrl"
            :src="prop.videoAsset.videoUrl"
            class="mt-2 max-h-48 w-full rounded-md bg-black"
            controls
            preload="metadata"
          />
          <div
            v-else
            class="mt-2 rounded-xl bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          >
            上传后在分镜描述中 @ 引用，生成视频时会作为参考视频提交（需当前视频模型支持视频参考）。
          </div>
        </div>

        <div
          v-if="showVoiceSection"
          class="border-t px-3 py-2.5"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <AudioLines class="h-3.5 w-3.5" />
              </div>
              <div class="min-w-0">
                <p class="text-xs font-medium">
                  旁白参考音频
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ resolveVoiceSourceLabel(prop) }}
                  <span v-if="resolveVoiceUpdatedText(prop)"> · {{ resolveVoiceUpdatedText(prop) }}</span>
                </p>
              </div>
            </div>
            <div
              v-if="prop.voiceAsset?.audioUrl"
              class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs text-muted-foreground"
            >
              <Lock
                v-if="prop.voiceAsset.locked"
                class="h-3 w-3 text-primary"
              />
              {{ prop.voiceAsset.locked ? '已锁定参考' : '未锁定' }}
            </div>
          </div>

          <div
            v-if="prop.voiceAsset?.audioUrl"
            class="mt-2 space-y-2"
          >
            <audio
              :src="prop.voiceAsset.audioUrl"
              class="w-full"
              controls
              preload="none"
            />
            <div class="flex items-center justify-end gap-2 rounded-md bg-muted/35 px-2.5 py-2">
              <span class="text-xs text-muted-foreground">锁定参考</span>
              <Switch
                :checked="!!prop.voiceAsset.locked"
                :disabled="autoRunning || uploadingPropVoiceId === prop.id"
                @update:checked="emit('update-voice-lock', { propId: prop.id, locked: !!$event })"
              />
            </div>
          </div>
          <div
            v-else
            class="mt-2 rounded-xl bg-muted/15 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          >
            上传固定旁白音频后，后续含旁白的镜头将优先复用该音色。
          </div>
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap items-center justify-between gap-1 border-t px-3 py-1.5">
          <span class="text-xs text-muted-foreground/60">
            {{ getPropUsageCount(prop.id) }} 个场景引用
          </span>
          <div class="flex flex-wrap items-center gap-0.5">
            <Button
              v-if="showImageSection"
              type="button"
              size="sm"
              :variant="prop.referenceImage ? 'outline' : 'default'"
              class="h-7 px-2.5 text-xs"
              :disabled="autoRunning || !!uploadingPropId || !!generatingPropId || !prop.name.trim()"
              @click="emit('generate-prop', prop.id)"
            >
              <Loader2
                v-if="generatingPropId === prop.id"
                class="mr-1 h-3 w-3 animate-spin"
              />
              <Sparkles
                v-else
                class="mr-1 h-3 w-3"
              />
              {{ resolveGenerateLabel(prop) }}
            </Button>
            <IconActionButton
              v-if="showImageSection"
              :label="prop.referenceImage ? '更换图片' : '上传图片'"
              :disabled="autoRunning || !!uploadingPropId"
              :loading="uploadingPropId === prop.id"
              @click="triggerUploadInput(prop.id)"
            >
              <ImageUp class="h-3.5 w-3.5" />
            </IconActionButton>
            <IconActionButton
              v-if="showVoiceSection"
              :label="prop.voiceAsset?.audioUrl ? '替换音频' : '上传音频'"
              :disabled="autoRunning || !!uploadingPropVoiceId"
              :loading="uploadingPropVoiceId === prop.id"
              @click="triggerVoiceUploadInput(prop.id)"
            >
              <AudioLines class="h-3.5 w-3.5" />
            </IconActionButton>
            <IconActionButton
              v-if="showVideoSection"
              :label="prop.videoAsset?.videoUrl ? '替换视频' : '上传视频'"
              :disabled="autoRunning || !!uploadingPropVideoId"
              :loading="uploadingPropVideoId === prop.id"
              @click="triggerVideoUploadInput(prop.id)"
            >
              <Clapperboard class="h-3.5 w-3.5" />
            </IconActionButton>
            <IconActionButton
              v-if="resolveHistoryCount(prop) > 1"
              :label="`历史版本（${resolveHistoryCount(prop)}）`"
              :badge="resolveHistoryCount(prop)"
              @click="emit('open-history', prop.id)"
            >
              <History class="h-3.5 w-3.5" />
            </IconActionButton>
            <SaveToPersonalLibraryButton
              icon-only
              :asset-key="`${prop.category === 'other' ? 'others' : 'props'}:${prop.id}`"
              :available="!!(prop.referenceImage || prop.voiceAsset?.audioUrl)"
              :busy="!!savingLibraryAssetKey"
              :saving="savingLibraryAssetKey === `${prop.category === 'other' ? 'others' : 'props'}:${prop.id}`"
              @save="emit('save-to-library', prop.id)"
            />
            <IconActionButton
              :label="`删除${assetLabel || '道具'}`"
              destructive
              @click="emit('remove-prop', prop.id)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </IconActionButton>
          </div>
          <Input
            :id="buildAssetUploadInputId('prop', prop.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { propId: prop.id, event: $event })"
          />
          <Input
            v-if="allowVoiceUpload"
            :id="buildAssetUploadInputId('prop_voice', prop.id)"
            type="file"
            accept="audio/*"
            class="hidden"
            @change="emit('upload-voice', { propId: prop.id, event: $event })"
          />
          <Input
            v-if="showMediaSubTabs"
            :id="buildAssetUploadInputId('prop_video', prop.id)"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
            class="hidden"
            @change="emit('upload-video', { propId: prop.id, event: $event })"
          />
        </div>
      </div>
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
