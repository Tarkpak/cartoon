import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import type { EnvironmentAssetCard, EnvironmentPanoramaState } from '~/lib/asset-workbench-types'
import { useAssetWorkbenchEnvironmentAssets } from './useAssetWorkbenchEnvironmentAssets'

function createCard(id: string, referenceImage?: string): EnvironmentAssetCard {
  return {
    id,
    name: `环境 ${id}`,
    referenceImage,
    sceneIds: [],
    sceneTitles: [],
    representativeSceneId: '',
    referenceStatus: referenceImage ? 'done' : 'pending'
  }
}

function setup() {
  const cards = ref([createCard('street', 'https://cdn.test/street.png'), createCard('alley'), createCard('market')])
  const panoramaStates = ref<Record<string, EnvironmentPanoramaState>>({
    market: { panoramaImage: 'https://cdn.test/market-360.png' }
  })
  const environmentAssetCards = computed(() => cards.value)
  const environmentAssetGenerationStates = ref({})
  const environmentMotherAssetSelections = ref<Record<string, string>>({})
  const api = useAssetWorkbenchEnvironmentAssets({
    environmentAssetCards,
    environmentAssetGenerationStates,
    environmentMotherAssetSelections,
    resolveEnvironmentCard: id => cards.value.find(card => card.id === id),
    resolveEnvironmentPanoramaState: id => panoramaStates.value[id]
  })
  return { ...api, environmentMotherAssetSelections }
}

describe('useAssetWorkbenchEnvironmentAssets', () => {
  it('overlays live generation state on the cards until it is cleared', () => {
    const { displayEnvironmentAssetCards, setEnvironmentAssetGenerationState } = setup()
    setEnvironmentAssetGenerationState('alley', { status: 'error', error: '超时' })
    expect(displayEnvironmentAssetCards.value[1]).toMatchObject({ referenceStatus: 'error', referenceError: '超时' })

    setEnvironmentAssetGenerationState('alley', null)
    expect(displayEnvironmentAssetCards.value[1]!.referenceStatus).toBe('pending')
  })

  it('prefers the panorama over the card image as the reference', () => {
    const { resolveEnvironmentAssetReferenceImage } = setup()
    expect(resolveEnvironmentAssetReferenceImage('market')).toBe('https://cdn.test/market-360.png')
    expect(resolveEnvironmentAssetReferenceImage('street')).toBe('https://cdn.test/street.png')
    expect(resolveEnvironmentAssetReferenceImage('alley')).toBeUndefined()
  })

  it('offers only other environments with a reference as mother candidates', () => {
    const { resolveEnvironmentMotherCandidates } = setup()
    expect(resolveEnvironmentMotherCandidates(createCard('street')).map(item => item.id)).toEqual(['market'])
  })

  it('selects and clears a mother environment, ignoring ones without a reference', () => {
    const {
      handleEnvironmentMotherSelection,
      resolveEnvironmentSelectedMotherId,
      resolveEnvironmentSelectedMotherReferenceImage,
      environmentMotherAssetSelections
    } = setup()

    handleEnvironmentMotherSelection({ assetId: 'alley', motherAssetId: 'street' })
    expect(resolveEnvironmentSelectedMotherReferenceImage('alley')).toBe('https://cdn.test/street.png')

    environmentMotherAssetSelections.value = { alley: 'alley-missing' }
    expect(resolveEnvironmentSelectedMotherId('alley')).toBeUndefined()

    handleEnvironmentMotherSelection({ assetId: 'alley', motherAssetId: '' })
    expect(environmentMotherAssetSelections.value).toEqual({})
  })
})
