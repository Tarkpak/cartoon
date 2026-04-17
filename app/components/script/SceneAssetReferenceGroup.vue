<script setup lang="ts">
import type { AssetReferenceOption } from '~/lib/scene-edit-dialog'

withDefaults(defineProps<{
  title: string
  assets: AssetReferenceOption[]
  draggingAssetId: string
  badgeVariant?: 'outline' | 'secondary'
  fallbackPreviewLabel?: string
  descriptionMode?: 'none' | 'description' | 'missing'
}>(), {
  badgeVariant: 'outline',
  fallbackPreviewLabel: '无图',
  descriptionMode: 'none'
})

const emit = defineEmits<{
  'drag-start': [assetId: string, event: DragEvent]
  'drag-end': []
}>()

function forwardDragStart(assetId: string, event: DragEvent) {
  emit('drag-start', assetId, event)
}
</script>

<template>
  <div
    v-if="assets.length > 0"
    class="space-y-1"
  >
    <div class="text-[11px] text-muted-foreground">
      {{ title }}
    </div>
    <div class="space-y-1">
      <ScriptSceneAssetReferenceCard
        v-for="asset in assets"
        :key="`${title}_${asset.id}`"
        :asset="asset"
        :dragging-asset-id="draggingAssetId"
        :badge-variant="badgeVariant"
        :fallback-preview-label="fallbackPreviewLabel"
        :description-mode="descriptionMode"
        @drag-start="forwardDragStart"
        @drag-end="emit('drag-end')"
      />
    </div>
  </div>
</template>
