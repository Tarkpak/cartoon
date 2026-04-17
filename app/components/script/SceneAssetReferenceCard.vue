<script setup lang="ts">
import { toImageSrc } from '~/lib/media'
import type { AssetReferenceOption } from '~/lib/scene-edit-dialog'
import { resolveAssetTypeLabel } from '~/lib/scene-edit-dialog'

const props = withDefaults(defineProps<{
  asset: AssetReferenceOption
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

const previewLabel = computed(() => {
  if (props.asset.referenceImage) return ''
  return props.fallbackPreviewLabel
})

const secondaryText = computed(() => {
  if (props.descriptionMode === 'description') {
    return props.asset.description?.trim() || ''
  }
  if (props.descriptionMode === 'missing') {
    return '该资产已不在当前资产池中'
  }
  return ''
})
</script>

<template>
  <div
    draggable="true"
    class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
    :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
    @dragstart="emit('drag-start', asset.id, $event)"
    @dragend="emit('drag-end')"
  >
    <img
      v-if="asset.referenceImage"
      :src="toImageSrc(asset.referenceImage)"
      :alt="`${asset.name} 参考图`"
      class="h-8 w-8 rounded border object-cover"
    >
    <div
      v-else
      class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
    >
      {{ previewLabel }}
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate">
        {{ asset.name }}
      </p>
      <p
        v-if="secondaryText"
        class="truncate text-[10px] text-muted-foreground"
      >
        {{ secondaryText }}
      </p>
    </div>
    <Badge
      :variant="badgeVariant"
      class="text-[10px]"
    >
      {{ resolveAssetTypeLabel(asset.type) }}
    </Badge>
  </div>
</template>
