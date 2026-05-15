<script setup lang="ts">
import { ArrowRight, History, Image, Loader2, Pencil, RefreshCw, ScanSearch, Sparkles, Upload } from 'lucide-vue-next'
import type { EnvironmentAssetCard, EnvironmentCropCaptureMode } from '~/lib/asset-workbench-types'
import { buildAssetUploadInputId } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  environmentAssetCards: EnvironmentAssetCard[]
  autoRunning: boolean
  uploadingEnvironmentAssetId: string | null
  getEnvironmentSceneSummary: (asset: EnvironmentAssetCard) => string
  getEnvironmentMotherCandidates: (asset: EnvironmentAssetCard) => Array<{ id: string, label: string }>
  getEnvironmentSelectedMotherId: (assetId: string) => string | undefined
  hasEnvironmentRepresentativeScene: (assetId: string) => boolean
}>()

const emit = defineEmits<{
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

function triggerUploadInput(assetId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('env', assetId)) as HTMLInputElement | null
  input?.click()
}

function resolveStatusColor(status: string): string {
  if (status === 'done') return 'bg-emerald-500'
  if (status === 'error') return 'bg-destructive'
  if (status === 'generating') return 'bg-blue-500'
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

function resolveEnvironmentHistoryImageByView(
  asset: EnvironmentAssetCard,
  viewMode: EnvironmentCropCaptureMode
): string {
  const history = Array.isArray(asset.assetHistory) ? asset.assetHistory : []
  const typed = history.find(entry => entry.viewMode === viewMode && !!entry.image?.trim())
  if (typed?.image?.trim()) return typed.image.trim()

  const legacy = history.find(entry => !entry.viewMode && !!entry.image?.trim())
  return legacy?.image?.trim() || ''
}

function resolveEnvironmentViewImage(
  asset: EnvironmentAssetCard,
  viewMode: EnvironmentCropCaptureMode
): string | undefined {
  if (viewMode === 'single') {
    const singleViewImage = asset.singleViewImage?.trim()
      || resolveEnvironmentHistoryImageByView(asset, 'single')
      || (asset.captureMode !== 'four_view' ? asset.referenceImage?.trim() || '' : '')
    return singleViewImage || undefined
  }

  const fourViewImage = asset.fourViewImage?.trim()
    || resolveEnvironmentHistoryImageByView(asset, 'four_view')
    || (asset.captureMode === 'four_view' ? asset.referenceImage?.trim() || '' : '')
  return fourViewImage || undefined
}

function resolveEnvironmentViewLabel(viewMode: EnvironmentCropCaptureMode): string {
  return viewMode === 'four_view' ? '四视图' : '单视图'
}

function hasEnvironmentImage(asset: EnvironmentAssetCard): boolean {
  return !!resolveEnvironmentViewImage(asset, 'single')
    || !!resolveEnvironmentViewImage(asset, 'four_view')
    || !!asset.referenceImage?.trim()
    || !!asset.panoramaImage?.trim()
}

function canOpenEnvironmentCrop(asset: EnvironmentAssetCard): boolean {
  return !!asset.panoramaImage?.trim()
    || !!asset.referenceImage?.trim()
    || hasEnvironmentImage(asset)
}

function canGenerateEnvironmentAsset(assetId: string): boolean {
  return props.environmentAssetCards.some(asset => asset.id === assetId)
}

function resolveEnvironmentGenerateLabel(asset: EnvironmentAssetCard): string {
  if (asset.referenceStatus === 'generating') return '生成中'
  return hasEnvironmentImage(asset) ? '重新生成' : '生成'
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

    <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <div
        v-for="(asset, idx) in environmentAssetCards"
        :key="`asset_env_${asset.id}`"
        class="group overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/30"
      >
        <!-- Image area -->
        <div class="relative overflow-hidden bg-muted/30">
          <div class="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-2">
            <div
              v-for="viewMode in ['single', 'four_view'] as const"
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
                <img
                  v-if="resolveEnvironmentViewImage(asset, viewMode)"
                  :src="toImageSrc(resolveEnvironmentViewImage(asset, viewMode))"
                  :alt="`${asset.name} ${resolveEnvironmentViewLabel(viewMode)}`"
                  class="h-full w-full object-cover"
                >
                <div
                  v-else
                  class="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/45"
                >
                  <Image class="h-6 w-6" />
                  <span class="text-[10px]">暂无{{ resolveEnvironmentViewLabel(viewMode) }}</span>
                </div>
              </Button>
              <span
                class="absolute left-2 top-2 rounded border bg-background/90 px-1 py-0.5 text-[10px] text-muted-foreground"
              >
                {{ resolveEnvironmentViewLabel(viewMode) }}
              </span>
              <Button
                size="sm"
                variant="secondary"
                class="absolute bottom-2 right-2 h-6 px-2 text-[10px]"
                :disabled="asset.referenceStatus === 'generating' || !canOpenEnvironmentCrop(asset)"
                @click.stop="emit('open-crop', { assetId: asset.id, captureMode: viewMode })"
              >
                <ScanSearch class="mr-1 h-3 w-3" />
                取景
              </Button>
            </div>
          </div>
          <!-- Status pill -->
          <span
            class="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm"
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
              <p class="truncate text-[11px] text-muted-foreground/70">
                {{ getEnvironmentSceneSummary(asset) }}
              </p>
            </div>
            <span class="shrink-0 text-[10px] text-muted-foreground/50">{{ idx + 1 }}</span>
          </div>
          <p
            v-if="asset.referenceError"
            class="mt-1 line-clamp-2 text-[11px] text-destructive"
          >
            {{ asset.referenceError }}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-1 border-t px-3 py-1.5">
          <Select
            :model-value="getEnvironmentSelectedMotherId(asset.id) || '__none__'"
            @update:model-value="emit('update-mother', { assetId: asset.id, motherAssetId: $event === '__none__' ? '' : String($event) })"
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
                v-for="candidate in getEnvironmentMotherCandidates(asset)"
                :key="`env_mother_${asset.id}_${candidate.id}`"
                :value="candidate.id"
              >
                {{ candidate.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
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
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="autoRunning || asset.referenceStatus === 'generating' || !!uploadingEnvironmentAssetId"
            @click="triggerUploadInput(asset.id)"
          >
            <Loader2
              v-if="uploadingEnvironmentAssetId === asset.id"
              class="mr-1 h-3 w-3 animate-spin"
            />
            <Upload
              v-else
              class="mr-1 h-3 w-3"
            />
            上传
          </Button>
          <Button
            v-if="hasEnvironmentImage(asset)"
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="asset.referenceStatus === 'generating'"
            @click="emit('open-regenerate', asset.id)"
          >
            <Sparkles class="mr-1 h-3 w-3" />
            定向修改
          </Button>
          <Button
            v-if="resolveHistoryCount(asset) > 1"
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="asset.referenceStatus === 'generating'"
            @click="emit('open-history', asset.id)"
          >
            <History class="mr-1 h-3 w-3" />
            历史 {{ resolveHistoryCount(asset) }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            :disabled="!hasEnvironmentRepresentativeScene(asset.id)"
            @click="emit('edit-scene', asset.id)"
          >
            <Pencil class="mr-1 h-3 w-3" />
            编辑
          </Button>
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
  </div>
</template>
