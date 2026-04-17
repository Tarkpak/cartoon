<script setup lang="ts">
import { Loader2, Pencil, RefreshCw, Sparkles, Upload } from 'lucide-vue-next'
import type { EnvironmentAssetCard } from '~/lib/asset-workbench-types'
import { buildAssetUploadInputId } from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

defineProps<{
  environmentAssetCards: EnvironmentAssetCard[]
  autoRunning: boolean
  uploadingEnvironmentAssetId: string | null
  getEnvironmentSceneSummary: (asset: EnvironmentAssetCard) => string
  hasEnvironmentRepresentativeScene: (assetId: string) => boolean
}>()

const emit = defineEmits<{
  'go-videos': []
  'preview-image': [payload: { src: string | undefined, alt: string }]
  'edit-scene': [assetId: string]
  'upload-image': [payload: { assetId: string, event: Event }]
  'open-regenerate': [assetId: string]
  'regenerate': [assetId: string]
}>()

function triggerUploadInput(assetId: string) {
  if (typeof document === 'undefined') return
  const input = document.getElementById(buildAssetUploadInputId('env', assetId)) as HTMLInputElement | null
  input?.click()
}
</script>

<template>
  <div class="space-y-3 rounded-md border p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="text-sm font-medium">
        环境资产总览
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 px-2 text-xs"
        @click="emit('go-videos')"
      >
        去场景视频步骤
      </Button>
    </div>

    <p class="text-xs text-muted-foreground">
      {{ environmentAssetCards.length }} 个环境，按剧本环境聚合展示，可直接编辑并重生成环境图。
    </p>

    <div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
      <div
        v-for="(asset, idx) in environmentAssetCards"
        :key="`asset_env_${asset.id}`"
        class="space-y-2 rounded-lg border bg-card p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="text-[11px] text-muted-foreground">
              环境 {{ idx + 1 }}
            </div>
            <div class="truncate text-sm font-medium">
              {{ asset.name }}
            </div>
          </div>
          <Badge
            :variant="asset.frameStatus === 'done' ? 'secondary' : asset.frameStatus === 'error' ? 'destructive' : asset.frameStatus === 'generating' ? 'default' : 'outline'"
            class="text-[11px]"
          >
            {{ asset.frameStatus === 'done' ? '环境图就绪' : asset.frameStatus === 'error' ? '环境图失败' : asset.frameStatus === 'generating' ? '生成中' : '待生成' }}
          </Badge>
        </div>

        <p class="truncate text-[11px] text-muted-foreground">
          {{ getEnvironmentSceneSummary(asset) }}
        </p>

        <div>
          <Button
            type="button"
            variant="ghost"
            class="relative flex aspect-video h-auto items-center justify-center overflow-hidden rounded border bg-muted/30 p-0"
            :class="asset.referenceImage ? 'cursor-zoom-in hover:border-primary/50' : 'cursor-not-allowed opacity-70'"
            :disabled="!asset.referenceImage"
            @click="emit('preview-image', { src: asset.referenceImage, alt: `${asset.name} - 环境图` })"
          >
            <img
              v-if="asset.referenceImage"
              :src="toImageSrc(asset.referenceImage)"
              :alt="`${asset.name} 环境图`"
              class="h-full w-full object-cover"
            >
            <span
              v-else
              class="text-[10px] text-muted-foreground"
            >暂无环境图</span>
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            :disabled="!hasEnvironmentRepresentativeScene(asset.id)"
            @click="emit('edit-scene', asset.id)"
          >
            <Pencil class="mr-1 h-3.5 w-3.5" />
            编辑代表场景
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            :disabled="autoRunning || asset.frameStatus === 'generating' || !!uploadingEnvironmentAssetId"
            @click="triggerUploadInput(asset.id)"
          >
            <Loader2
              v-if="uploadingEnvironmentAssetId === asset.id"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            <Upload
              v-else
              class="mr-1 h-3.5 w-3.5"
            />
            上传环境图
          </Button>
          <Button
            v-if="asset.referenceImage"
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            :disabled="asset.frameStatus === 'generating'"
            @click="emit('open-regenerate', asset.id)"
          >
            <Sparkles class="mr-1 h-3.5 w-3.5" />
            二次生成
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 px-2 text-xs"
            :disabled="asset.frameStatus === 'generating'"
            @click="emit('regenerate', asset.id)"
          >
            <Loader2
              v-if="asset.frameStatus === 'generating'"
              class="mr-1 h-3.5 w-3.5 animate-spin"
            />
            <RefreshCw
              v-else
              class="mr-1 h-3.5 w-3.5"
            />
            重生成环境图
          </Button>
          <input
            :id="buildAssetUploadInputId('env', asset.id)"
            type="file"
            accept="image/*"
            class="hidden"
            @change="emit('upload-image', { assetId: asset.id, event: $event })"
          >
        </div>
      </div>
    </div>
  </div>
</template>
