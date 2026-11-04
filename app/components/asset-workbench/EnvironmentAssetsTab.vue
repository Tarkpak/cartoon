<script setup lang="ts">
import { ArrowRight, History, Image, ImageUp, Loader2, Pencil, RefreshCw, ScanSearch, WandSparkles } from 'lucide-vue-next'
import LazyImage from '~/components/LazyImage.vue'
import SaveToPersonalLibraryButton from './SaveToPersonalLibraryButton.vue'
import type { EnvironmentAssetCard, EnvironmentCropCaptureMode } from '~/lib/asset-workbench-types'
import { buildAssetUploadInputId } from '~/lib/asset-workbench-types'
import { resolveEnvironmentViewImageForCard } from '~/lib/asset-workbench-environment-views'
import { useIncrementalList } from '~/composables/useIncrementalList'

const props = defineProps<{
  environmentAssetCards: EnvironmentAssetCard[]
  autoRunning: boolean
  savingLibraryAssetKey?: string | null
  uploadingEnvironmentAssetId: string | null
  getEnvironmentSceneSummary: (asset: EnvironmentAssetCard) => string
  getEnvironmentMotherCandidates: (asset: EnvironmentAssetCard) => Array<{ id: string, label: string }>
  getEnvironmentSelectedMotherId: (assetId: string) => string | undefined
  hasEnvironmentRepresentativeScene: (assetId: string) => boolean
}>()

const emit = defineEmits<{
  'save-to-library': [assetId: string]
  'go-videos': []
  'preview-image': [payload: { src: string | undefined, alt: string }]
  'edit-scene': [assetId: string]
  'upload-image': [payload: { assetId: string, event: Event }]
  'open-regenerate': [assetId: string]
  'open-history': [assetId: string]
  'open-crop': [payload: { assetId: string, captureMode: EnvironmentCropCaptureMode }]
  'regenerate': [assetId: string]
  'update-mother': [payload: { assetId: string, motherAssetId: string }]
}>()

const {
  sentinel: environmentLoadMoreSentinel,
  visibleItems: visibleEnvironmentAssetCards,
  hasMore: hasMoreEnvironmentAssets,
  loadMore: loadMoreEnvironmentAssets
} = useIncrementalList(() => props.environmentAssetCards, { getKey: asset => asset.id })

function triggerUploadInput(assetId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('env', assetId)) as HTMLInputElement | null
  input?.click()
}

function resolveStatusColor(status: string): string {
  if (status === 'done') return 'bg-success'
  if (status === 'error') return 'bg-destructive'
  if (status === 'generating') return 'bg-info'
  return 'bg-muted-foreground/40'
}

function resolveStatusText(status: string): string {
  if (status === 'done') return '就绪'
  if (status === 'error') return '失败'
  if (status === 'generating') return '生成中'
  return '待生成'
}

function resolveHistoryCount(asset: EnvironmentAssetCard): number {
  return Array.isArray(asset.assetHistory) ? asset.assetHistory.length : 0
}

function resolveEnvironmentViewImage(
  asset: EnvironmentAssetCard,
  viewMode: EnvironmentCropCaptureMode
): string | undefined {
  return resolveEnvironmentViewImageForCard(asset, viewMode)
}

function resolveEnvironmentViewLabel(viewMode: EnvironmentCropCaptureMode): string {
  return viewMode === '四视角' ? '四视图' : '单视图'
}

function hasEnvironmentImage(asset: EnvironmentAssetCard): boolean {
  return !!resolveEnvironmentViewImage(asset, '单视角')
    || !!resolveEnvironmentViewImage(asset, '四视角')
    || !!asset.referenceImage?.trim()
    || !!asset.panoramaImage?.trim()
}

function hasEnvironmentPanorama(asset: EnvironmentAssetCard): boolean {
  return !!asset.panoramaImage?.trim()
}

function resolveDirectEnvironmentImage(asset: EnvironmentAssetCard): string | undefined {
  return asset.referenceImage?.trim()
    || resolveEnvironmentViewImage(asset, '单视角')
    || resolveEnvironmentViewImage(asset, '四视角')
    || undefined
}

function canGenerateEnvironmentAsset(assetId: string): boolean {
  return props.environmentAssetCards.some(asset => asset.id === assetId)
}

function resolveEnvironmentGenerateLabel(asset: EnvironmentAssetCard): string {
  if (asset.referenceStatus === 'generating') return '生成中'
  return hasEnvironmentImage(asset) ? '重新生成' : '生成'
}

// reka-ui Select renders its items into a detached fragment even while closed.
// With one mother picker per card, that was N cards x N candidates mounted at
// all times. Only mount the full candidate list for the picker that is open;
// a closed picker keeps just the selected item so SelectValue can show it.
const openMotherSelectAssetId = ref<string | null>(null)

const environmentNameById = computed(() => {
  return new Map(props.environmentAssetCards.map(asset => [asset.id, asset.name]))
})

function handleMotherSelectOpenChange(assetId: string, open: boolean) {
  if (open) {
    openMotherSelectAssetId.value = assetId
  } else if (openMotherSelectAssetId.value === assetId) {
    openMotherSelectAssetId.value = null
  }
}

function resolveRenderedMotherCandidates(asset: EnvironmentAssetCard): Array<{ id: string, label: string }> {
  if (openMotherSelectAssetId.value === asset.id) {
    return props.getEnvironmentMotherCandidates(asset)
  }
  const selectedId = props.getEnvironmentSelectedMotherId(asset.id)
  if (!selectedId) return []
  return [{ id: selectedId, label: environmentNameById.value.get(selectedId) || selectedId }]
}

function resolveEnvironmentGenerateTitle(asset: EnvironmentAssetCard): string {
  if (asset.referenceStatus === 'generating') return '环境图生成中'
  if (!canGenerateEnvironmentAsset(asset.id)) return '未找到环境资产'
  if (!props.hasEnvironmentRepresentativeScene(asset.id)) return '根据环境资产描述生成环境图'
  return hasEnvironmentImage(asset) ? '重新生成环境图' : '生成环境图'
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-xs text-muted-foreground">
        {{ environmentAssetCards.length }} 个环境，按剧本聚合展示
      </p>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        @click="emit('go-videos')"
      >
        分镜视频
        <ArrowRight class="h-3 w-3" />
      </Button>
    </div>

    <div class="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
      <div
        v-for="(asset, idx) in visibleEnvironmentAssetCards"
        :key="`asset_env_${asset.id}`"
        data-ai-asset-type="environment"
        :data-ai-asset-id="asset.id"
        class="group overflow-hidden rounded-xl bg-muted/25 transition-colors hover:bg-muted/35"
      >
        <!-- Image area -->
        <div class="relative overflow-hidden bg-muted/30">
          <div
            v-if="hasEnvironmentPanorama(asset)"
            class="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2"
          >
            <div
              v-for="viewMode in ['单视角', '四视角'] as const"
              :key="`${asset.id}_${viewMode}`"
              class="relative aspect-video overflow-hidden bg-muted/30"
            >
              <Button
                type="button"
                variant="ghost"
                class="h-full w-full rounded-none p-0 hover:bg-transparent"
                :disabled="!resolveEnvironmentViewImage(asset, viewMode)"
                @click="emit('preview-image', {
                  src: resolveEnvironmentViewImage(asset, viewMode),
                  alt: `${asset.name} - ${resolveEnvironmentViewLabel(viewMode)}`
                })"
              >
                <LazyImage
                  v-if="resolveEnvironmentViewImage(asset, viewMode)"
                  :image="resolveEnvironmentViewImage(asset, viewMode)"
                  :alt="`${asset.name} ${resolveEnvironmentViewLabel(viewMode)}`"
                  class="h-full w-full object-cover"
                />
                <div
                  v-else
                  class="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/45"
                >
                  <Image class="h-6 w-6" />
                  <span class="text-xs">暂无{{ resolveEnvironmentViewLabel(viewMode) }}</span>
                </div>
              </Button>
              <span
                class="absolute left-2 top-2 rounded border bg-background/90 px-1 py-0.5 text-xs text-muted-foreground"
              >
                {{ resolveEnvironmentViewLabel(viewMode) }}
              </span>
              <Button
                size="sm"
                variant="secondary"
                class="absolute bottom-2 right-2 h-6 px-2 text-xs"
                :disabled="asset.referenceStatus === 'generating'"
                @click.stop="emit('open-crop', { assetId: asset.id, captureMode: viewMode })"
              >
                <ScanSearch class="mr-1 h-3 w-3" />
                取景
              </Button>
            </div>
          </div>
          <div
            v-else
            class="relative aspect-video overflow-hidden bg-muted/30 sm:aspect-[32/9]"
          >
            <Button
              type="button"
              variant="ghost"
              class="absolute inset-0 h-full w-full rounded-none p-0 hover:bg-transparent"
              :disabled="!resolveDirectEnvironmentImage(asset)"
              @click="emit('preview-image', {
                src: resolveDirectEnvironmentImage(asset),
                alt: asset.name
              })"
            >
              <LazyImage
                v-if="resolveDirectEnvironmentImage(asset)"
                :image="resolveDirectEnvironmentImage(asset)"
                :alt="asset.name"
                class="h-full min-h-0 w-full min-w-0 object-contain"
              />
              <div
                v-else
                class="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/45"
              >
                <Image class="h-6 w-6" />
                <span class="text-xs">暂无环境图</span>
              </div>
            </Button>
          </div>
          <!-- Status pill -->
          <span
            class="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium backdrop-blur-sm"
          >
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              :class="resolveStatusColor(asset.referenceStatus)"
            />
            {{ resolveStatusText(asset.referenceStatus) }}
          </span>
        </div>

        <!-- Info -->
        <div class="px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">
                {{ asset.name }}
              </div>
              <p class="truncate text-xs text-muted-foreground/70">
                {{ getEnvironmentSceneSummary(asset) }}
              </p>
            </div>
            <span class="shrink-0 text-xs text-muted-foreground/50">{{ idx + 1 }}</span>
          </div>
          <p
            v-if="asset.referenceError"
            class="mt-1 line-clamp-2 text-xs text-destructive"
          >
            {{ asset.referenceError }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap items-center gap-1 border-t px-3 py-1.5">
          <Button
            size="sm"
            :variant="hasEnvironmentImage(asset) ? 'outline' : 'default'"
            class="h-7 px-2.5 text-xs"
            :title="resolveEnvironmentGenerateTitle(asset)"
            :disabled="asset.referenceStatus === 'generating' || !canGenerateEnvironmentAsset(asset.id)"
            @click="emit('regenerate', asset.id)"
          >
            <Loader2
              v-if="asset.referenceStatus === 'generating'"
              class="mr-1 h-3 w-3 animate-spin"
            />
            <RefreshCw
              v-else
              class="mr-1 h-3 w-3"
            />
            {{ resolveEnvironmentGenerateLabel(asset) }}
          </Button>
          <IconActionButton
            v-if="hasEnvironmentImage(asset)"
            label="定向修改"
            :disabled="asset.referenceStatus === 'generating'"
            @click="emit('open-regenerate', asset.id)"
          >
            <WandSparkles class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            label="上传环境图"
            :disabled="autoRunning || asset.referenceStatus === 'generating' || !!uploadingEnvironmentAssetId"
            :loading="uploadingEnvironmentAssetId === asset.id"
            @click="triggerUploadInput(asset.id)"
          >
            <ImageUp class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            v-if="resolveHistoryCount(asset) > 1"
            :label="`历史版本（${resolveHistoryCount(asset)}）`"
            :badge="resolveHistoryCount(asset)"
            :disabled="asset.referenceStatus === 'generating'"
            @click="emit('open-history', asset.id)"
          >
            <History class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            label="编辑代表场景"
            :disabled="!hasEnvironmentRepresentativeScene(asset.id)"
            @click="emit('edit-scene', asset.id)"
          >
            <Pencil class="h-3.5 w-3.5" />
          </IconActionButton>
          <Select
            :model-value="getEnvironmentSelectedMotherId(asset.id) || '__none__'"
            @update:model-value="emit('update-mother', { assetId: asset.id, motherAssetId: $event === '__none__' ? '' : String($event) })"
            @update:open="handleMotherSelectOpenChange(asset.id, $event)"
          >
            <SelectTrigger
              class="h-7 w-[160px] px-2 text-xs text-muted-foreground"
              :disabled="asset.referenceStatus === 'generating'"
            >
              <SelectValue placeholder="选择母体（可选）" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                不使用母体
              </SelectItem>
              <SelectItem
                v-for="candidate in resolveRenderedMotherCandidates(asset)"
                :key="`env_mother_${asset.id}_${candidate.id}`"
                :value="candidate.id"
              >
                {{ candidate.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <div class="ml-auto flex items-center">
            <SaveToPersonalLibraryButton
              icon-only
              :asset-key="`environments:${asset.id}`"
              :available="!!(asset.referenceImage || asset.singleViewImage || asset.fourViewImage)"
              :busy="!!savingLibraryAssetKey"
              :saving="savingLibraryAssetKey === `environments:${asset.id}`"
              @save="emit('save-to-library', asset.id)"
            />
          </div>
          <Input
            :id="buildAssetUploadInputId('env', asset.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { assetId: asset.id, event: $event })"
          />
        </div>
      </div>
    </div>

    <div
      v-if="hasMoreEnvironmentAssets"
      ref="environmentLoadMoreSentinel"
      class="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
    >
      已显示 {{ visibleEnvironmentAssetCards.length }} / {{ environmentAssetCards.length }}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs"
        @click="loadMoreEnvironmentAssets"
      >
        加载更多
      </Button>
    </div>
  </div>
</template>
