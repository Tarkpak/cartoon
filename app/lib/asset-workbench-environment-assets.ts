import type { SceneData } from '~/composables/useAssetWorkbench'
import type { DisplayAsset, EnvironmentAssetCard } from '~/lib/asset-workbench-types'
import {
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentLabel,
  resolveSceneReferenceImage
} from '~/lib/asset-workbench-environment-core'

function mergeEnvironmentFrameStatus(
  current: EnvironmentAssetCard['frameStatus'],
  next: SceneData['frameStatus']
): EnvironmentAssetCard['frameStatus'] {
  if (current !== 'generating' && next === 'generating') {
    return 'generating'
  }

  if (current !== 'generating' && current !== 'done' && next === 'done') {
    return 'done'
  }

  if (current === 'pending' && next === 'error') {
    return 'error'
  }

  return current
}

export function buildEnvironmentAssetCards(options: {
  scenes: SceneData[]
  resolveSceneDescriptionWithoutAssetMentions: (description?: string) => string
}): EnvironmentAssetCard[] {
  const map = new Map<string, EnvironmentAssetCard>()

  for (const scene of options.scenes) {
    const assetId = resolveSceneEnvironmentAssetId(scene)
    const existing = map.get(assetId)
    const sceneImage = resolveSceneReferenceImage(scene)

    if (!existing) {
      map.set(assetId, {
        id: assetId,
        name: resolveSceneEnvironmentLabel(scene),
        description: scene.setting?.mood?.trim()
          || options.resolveSceneDescriptionWithoutAssetMentions(scene.description)?.trim()
          || undefined,
        referenceImage: sceneImage,
        sceneIds: [scene.id],
        sceneTitles: [scene.title || scene.id],
        representativeSceneId: scene.id,
        frameStatus: scene.frameStatus
      })
      continue
    }

    existing.sceneIds.push(scene.id)
    existing.sceneTitles.push(scene.title || scene.id)

    if (!existing.referenceImage && sceneImage) {
      existing.referenceImage = sceneImage
      existing.representativeSceneId = scene.id
    }

    existing.frameStatus = mergeEnvironmentFrameStatus(existing.frameStatus, scene.frameStatus)
  }

  return Array.from(map.values())
}

export function buildEnvironmentDisplayAssets(
  environmentAssetCards: EnvironmentAssetCard[]
): DisplayAsset[] {
  return environmentAssetCards.map(asset => ({
    id: asset.id,
    name: asset.name,
    type: 'environment',
    description: asset.description,
    referenceImage: asset.referenceImage
  }))
}

export function resolveEnvironmentCard(
  assetId: string,
  environmentAssetCards: EnvironmentAssetCard[]
): EnvironmentAssetCard | undefined {
  return environmentAssetCards.find(item => item.id === assetId)
}

export function resolveEnvironmentRepresentativeScene(
  assetId: string,
  environmentAssetCards: EnvironmentAssetCard[],
  scenes: SceneData[]
): SceneData | undefined {
  const card = resolveEnvironmentCard(assetId, environmentAssetCards)
  if (!card) return undefined
  return scenes.find(scene => scene.id === card.representativeSceneId)
}

export function resolveEnvironmentSceneSummary(asset: EnvironmentAssetCard): string {
  if (asset.sceneTitles.length <= 2) {
    return `覆盖场景：${asset.sceneTitles.join('、')}`
  }
  return `覆盖场景：${asset.sceneTitles.slice(0, 2).join('、')} 等 ${asset.sceneTitles.length} 场`
}

export function hasEnvironmentRepresentativeScene(
  assetId: string,
  environmentAssetCards: EnvironmentAssetCard[],
  scenes: SceneData[]
): boolean {
  return !!resolveEnvironmentRepresentativeScene(assetId, environmentAssetCards, scenes)
}
