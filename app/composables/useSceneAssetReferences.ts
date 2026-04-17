import type { Ref } from 'vue'
import type {
  AssetReferenceOption,
  DragDropZone
} from '~/lib/scene-edit-dialog'
import {
  resolveSceneAssetReferenceCollections
} from '~/lib/scene-edit-dialog'

interface UseSceneAssetReferencesOptions {
  assetReferenceOptions: Ref<AssetReferenceOption[]>
  selectedAssetReferenceIds: Ref<string[]>
}

export function useSceneAssetReferences(options: UseSceneAssetReferencesOptions) {
  const draggingAssetId = ref('')
  const activeDropZone = ref<DragDropZone | null>(null)

  const assetReferenceCollections = computed(() => {
    return resolveSceneAssetReferenceCollections({
      assetReferenceOptions: options.assetReferenceOptions.value,
      selectedAssetReferenceIds: options.selectedAssetReferenceIds.value
    })
  })

  function writeDraggedAssetId(assetId: string, event: DragEvent) {
    const transfer = event.dataTransfer
    if (!transfer) return

    transfer.effectAllowed = 'move'
    transfer.setData('application/x-scene-asset-id', assetId)
    transfer.setData('text/plain', assetId)
  }

  function readDraggedAssetId(event: DragEvent): string {
    const transfer = event.dataTransfer
    if (!transfer) return draggingAssetId.value

    return transfer.getData('application/x-scene-asset-id')
      || transfer.getData('text/plain')
      || draggingAssetId.value
  }

  function moveAssetReference(assetId: string, targetZone: DragDropZone) {
    const existsInPool = options.assetReferenceOptions.value.some(asset => asset.id === assetId)
    const existsInSelected = assetReferenceCollections.value.selectedAssetReferenceIdSet.has(assetId)
    if (!existsInPool && !existsInSelected) return

    const next = new Set(options.selectedAssetReferenceIds.value)

    if (targetZone === 'selected') {
      next.add(assetId)
    } else {
      next.delete(assetId)
    }

    options.selectedAssetReferenceIds.value = Array.from(next)
  }

  function handleAssetDragStart(assetId: string, event: DragEvent) {
    draggingAssetId.value = assetId
    writeDraggedAssetId(assetId, event)
  }

  function handleAssetDragEnd() {
    draggingAssetId.value = ''
    activeDropZone.value = null
  }

  function handleDropZoneDragOver(zone: DragDropZone, event: DragEvent) {
    event.preventDefault()
    activeDropZone.value = zone
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
  }

  function handleDropZoneDrop(zone: DragDropZone, event: DragEvent) {
    event.preventDefault()
    const assetId = readDraggedAssetId(event)
    if (!assetId) return

    moveAssetReference(assetId, zone)
    draggingAssetId.value = ''
    activeDropZone.value = null
  }

  function handleDropZoneDragLeave(zone: DragDropZone, event: DragEvent) {
    const target = event.currentTarget as HTMLElement | null
    const related = event.relatedTarget as Node | null
    if (target && related && target.contains(related)) return
    if (activeDropZone.value === zone) {
      activeDropZone.value = null
    }
  }

  return {
    draggingAssetId,
    activeDropZone,
    selectedAssetReferenceIdSet: computed(() => assetReferenceCollections.value.selectedAssetReferenceIdSet),
    selectedAssetReferences: computed(() => assetReferenceCollections.value.selectedAssetReferences),
    assetPoolReferences: computed(() => assetReferenceCollections.value.assetPoolReferences),
    poolCharacterAssets: computed(() => assetReferenceCollections.value.poolCharacterAssets),
    poolEnvironmentAssets: computed(() => assetReferenceCollections.value.poolEnvironmentAssets),
    poolPropAssets: computed(() => assetReferenceCollections.value.poolPropAssets),
    selectedCharacterAssets: computed(() => assetReferenceCollections.value.selectedCharacterAssets),
    selectedEnvironmentAssets: computed(() => assetReferenceCollections.value.selectedEnvironmentAssets),
    selectedPropAssets: computed(() => assetReferenceCollections.value.selectedPropAssets),
    selectedUnknownAssets: computed(() => assetReferenceCollections.value.selectedUnknownAssets),
    moveAssetReference,
    handleAssetDragStart,
    handleAssetDragEnd,
    handleDropZoneDragOver,
    handleDropZoneDrop,
    handleDropZoneDragLeave
  }
}
