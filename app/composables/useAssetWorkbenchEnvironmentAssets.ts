import { computed, type ComputedRef, type Ref } from 'vue'
import type { EnvironmentAssetCard, EnvironmentPanoramaState } from '~/lib/asset-workbench-types'

type EnvironmentGenerationState = { status: 'error' | 'done' | 'pending' | 'generating', error?: string }

/**
 * Environment asset cards as shown in the UI: live generation status overlaid
 * on the cards, their current reference image, and the "mother" environment
 * each one may borrow a reference from.
 */
export function useAssetWorkbenchEnvironmentAssets(options: {
  environmentAssetCards: ComputedRef<EnvironmentAssetCard[]>
  environmentAssetGenerationStates: Ref<Record<string, EnvironmentGenerationState>>
  environmentMotherAssetSelections: Ref<Record<string, string>>
  resolveEnvironmentCard: (assetId: string) => EnvironmentAssetCard | undefined
  resolveEnvironmentPanoramaState: (assetId: string) => EnvironmentPanoramaState | undefined
}) {
  const {
    environmentAssetCards,
    environmentAssetGenerationStates,
    environmentMotherAssetSelections,
    resolveEnvironmentCard,
    resolveEnvironmentPanoramaState
  } = options

  const displayEnvironmentAssetCards = computed<EnvironmentAssetCard[]>(() => {
    return environmentAssetCards.value.map((asset) => {
      const state = environmentAssetGenerationStates.value[asset.id]
      if (!state) return asset

      return {
        ...asset,
        referenceStatus: state.status,
        referenceError: state.error || asset.referenceError
      }
    })
  })

  function setEnvironmentAssetGenerationState(
    assetId: string,
    state: {
      status: EnvironmentAssetCard['referenceStatus']
      error?: string
    } | null
  ) {
    if (!state) {
      environmentAssetGenerationStates.value = Object.fromEntries(
        Object.entries(environmentAssetGenerationStates.value).filter(([id]) => id !== assetId)
      )
      return
    }

    environmentAssetGenerationStates.value = {
      ...environmentAssetGenerationStates.value,
      [assetId]: state
    }
  }

  function computeEnvironmentAssetReferenceImage(assetId: string): string | undefined {
    const card = resolveEnvironmentCard(assetId)
    return resolveEnvironmentPanoramaState(assetId)?.panoramaImage?.trim()
      || card?.panoramaImage?.trim()
      || card?.referenceImage?.trim()
      || undefined
  }

  // Cached once per asset/panorama change; the asset grid reads it per card on
  // every render, so recomputing it inline made large projects O(n^2) or worse.
  const environmentAssetReferenceImageById = computed(() => {
    const map = new Map<string, string>()
    for (const asset of environmentAssetCards.value) {
      const image = computeEnvironmentAssetReferenceImage(asset.id)
      if (image) map.set(asset.id, image)
    }
    return map
  })

  function resolveEnvironmentAssetReferenceImage(assetId: string): string | undefined {
    return environmentAssetReferenceImageById.value.get(assetId)
      ?? computeEnvironmentAssetReferenceImage(assetId)
  }

  const environmentMotherCandidatePool = computed(() => {
    return displayEnvironmentAssetCards.value
      .filter(item => environmentAssetReferenceImageById.value.has(item.id))
      .map(item => ({ id: item.id, label: item.name }))
  })

  function resolveEnvironmentMotherCandidates(asset: EnvironmentAssetCard): Array<{ id: string, label: string }> {
    return environmentMotherCandidatePool.value.filter(item => item.id !== asset.id)
  }

  function resolveEnvironmentSelectedMotherId(assetId: string): string | undefined {
    const selectedId = environmentMotherAssetSelections.value[assetId]?.trim() || ''
    if (!selectedId) return undefined
    if (!resolveEnvironmentAssetReferenceImage(selectedId)) return undefined
    return selectedId
  }

  function resolveEnvironmentSelectedMotherReferenceImage(assetId: string): string | undefined {
    const selectedId = resolveEnvironmentSelectedMotherId(assetId)
    if (!selectedId) return undefined
    return resolveEnvironmentAssetReferenceImage(selectedId)
  }

  function handleEnvironmentMotherSelection(payload: { assetId: string, motherAssetId: string }) {
    const assetId = payload.assetId?.trim() || ''
    if (!assetId) return

    const motherAssetId = payload.motherAssetId?.trim() || ''
    if (!motherAssetId) {
      const { [assetId]: _removed, ...remaining } = environmentMotherAssetSelections.value
      environmentMotherAssetSelections.value = remaining
      return
    }

    environmentMotherAssetSelections.value = {
      ...environmentMotherAssetSelections.value,
      [assetId]: motherAssetId
    }
  }

  return {
    displayEnvironmentAssetCards,
    setEnvironmentAssetGenerationState,
    resolveEnvironmentAssetReferenceImage,
    resolveEnvironmentMotherCandidates,
    resolveEnvironmentSelectedMotherId,
    resolveEnvironmentSelectedMotherReferenceImage,
    handleEnvironmentMotherSelection
  }
}
