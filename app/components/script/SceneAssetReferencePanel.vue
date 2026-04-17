<script setup lang="ts">
import type {
  AssetReferenceOption,
  DragDropZone
} from '~/lib/scene-edit-dialog'

defineProps<{
  assetReferenceOptions: AssetReferenceOption[]
  selectedAssetReferenceIds: string[]
  activeDropZone: DragDropZone | null
  draggingAssetId: string
  assetPoolReferences: AssetReferenceOption[]
  poolCharacterAssets: AssetReferenceOption[]
  poolEnvironmentAssets: AssetReferenceOption[]
  poolPropAssets: AssetReferenceOption[]
  selectedCharacterAssets: AssetReferenceOption[]
  selectedEnvironmentAssets: AssetReferenceOption[]
  selectedPropAssets: AssetReferenceOption[]
  selectedUnknownAssets: AssetReferenceOption[]
  handleAssetDragStart: (assetId: string, event: DragEvent) => void
  handleAssetDragEnd: () => void
  handleDropZoneDragOver: (zone: DragDropZone, event: DragEvent) => void
  handleDropZoneDrop: (zone: DragDropZone, event: DragEvent) => void
  handleDropZoneDragLeave: (zone: DragDropZone, event: DragEvent) => void
}>()
</script>

<template>
  <div
    v-if="assetReferenceOptions.length > 0"
    class="space-y-3 border-t pt-4"
  >
    <div class="flex items-center justify-between gap-2">
      <h4 class="text-sm font-medium">
        引用资产（拖拽增删）
      </h4>
      <Badge
        variant="outline"
        class="text-[10px]"
      >
        已选 {{ selectedAssetReferenceIds.length }}
      </Badge>
    </div>

    <p class="text-xs text-muted-foreground">
      拖动卡片到右侧可添加引用；拖回左侧可移除引用。
    </p>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div
        class="space-y-2 rounded-md border p-2 transition"
        :class="activeDropZone === 'pool' ? 'border-primary bg-primary/5' : 'border-input'"
        @dragover="handleDropZoneDragOver('pool', $event)"
        @dragleave="handleDropZoneDragLeave('pool', $event)"
        @drop="handleDropZoneDrop('pool', $event)"
      >
        <div class="text-xs font-medium text-muted-foreground">
          资产池（拖到右侧添加）
        </div>

        <div
          v-if="assetPoolReferences.length === 0"
          class="rounded border border-dashed px-2 py-4 text-center text-xs text-muted-foreground"
        >
          没有可添加的资产
        </div>

        <div
          v-else
          class="max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          <ScriptSceneAssetReferenceGroup
            title="角色"
            :assets="poolCharacterAssets"
            :dragging-asset-id="draggingAssetId"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />

          <ScriptSceneAssetReferenceGroup
            title="环境"
            :assets="poolEnvironmentAssets"
            :dragging-asset-id="draggingAssetId"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />

          <ScriptSceneAssetReferenceGroup
            title="道具"
            :assets="poolPropAssets"
            :dragging-asset-id="draggingAssetId"
            fallback-preview-label="道具"
            description-mode="description"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />
        </div>
      </div>

      <div
        class="space-y-2 rounded-md border p-2 transition"
        :class="activeDropZone === 'selected' ? 'border-primary bg-primary/5' : 'border-input'"
        @dragover="handleDropZoneDragOver('selected', $event)"
        @dragleave="handleDropZoneDragLeave('selected', $event)"
        @drop="handleDropZoneDrop('selected', $event)"
      >
        <div class="text-xs font-medium text-muted-foreground">
          已引用资产（拖回左侧移除）
        </div>

        <div
          v-if="selectedAssetReferenceIds.length === 0"
          class="rounded border border-dashed px-2 py-4 text-center text-xs text-muted-foreground"
        >
          暂无引用资产
        </div>

        <div
          v-else
          class="max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          <ScriptSceneAssetReferenceGroup
            title="角色"
            :assets="selectedCharacterAssets"
            :dragging-asset-id="draggingAssetId"
            badge-variant="secondary"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />

          <ScriptSceneAssetReferenceGroup
            title="环境"
            :assets="selectedEnvironmentAssets"
            :dragging-asset-id="draggingAssetId"
            badge-variant="secondary"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />

          <ScriptSceneAssetReferenceGroup
            title="道具"
            :assets="selectedPropAssets"
            :dragging-asset-id="draggingAssetId"
            badge-variant="secondary"
            fallback-preview-label="道具"
            description-mode="description"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />

          <ScriptSceneAssetReferenceGroup
            title="其他"
            :assets="selectedUnknownAssets"
            :dragging-asset-id="draggingAssetId"
            fallback-preview-label="未知"
            description-mode="missing"
            @drag-start="handleAssetDragStart"
            @drag-end="handleAssetDragEnd"
          />
        </div>
      </div>
    </div>
  </div>

  <div
    v-else
    class="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
  >
    当前没有可管理的引用资产，请先在工作流中准备角色/环境/道具资产。
  </div>
</template>
