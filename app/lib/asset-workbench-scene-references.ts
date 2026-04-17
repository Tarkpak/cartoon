import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { SceneVideoReferenceAsset } from '~/lib/asset-workbench-types'
import { resolveCharacterRefsFromScene } from '~/lib/asset-workbench-reference-detection'
import { uniqueSorted } from '~/lib/asset-workbench-strings'

interface SceneReferenceOptions {
  scene: SceneData
  characters: CharacterData[]
  propAssets: PropAsset[]
  sceneConfigs: Record<string, SceneConsistencyConfig>
}

export function findCharacterByAssetRefId(
  rawCharacterId: string,
  characters: CharacterData[]
): CharacterData | undefined {
  return characters.find(character => character.id === rawCharacterId)
    || characters.find(character => character.id.endsWith(`_${rawCharacterId}`))
}

export function resolveConfiguredCharacterReferences(
  options: Pick<SceneReferenceOptions, 'scene' | 'characters' | 'sceneConfigs'>
): CharacterData[] {
  const config = options.sceneConfigs[options.scene.id]
  if (!config) return []

  const characterIds = uniqueSorted(
    config.mustReferenceAssetIds
      .filter(assetId => assetId.startsWith('char:'))
      .map(assetId => assetId.slice('char:'.length))
      .filter(Boolean)
  )

  return characterIds
    .map(characterId => findCharacterByAssetRefId(characterId, options.characters))
    .filter((character): character is CharacterData => !!character)
}

function resolveConfiguredCharacterReferenceAssets(
  options: Pick<SceneReferenceOptions, 'scene' | 'characters' | 'sceneConfigs'>
): SceneVideoReferenceAsset[] {
  const assets: SceneVideoReferenceAsset[] = []
  const seen = new Set<string>()

  for (const character of resolveConfiguredCharacterReferences(options)) {
    const image = character.baseImage?.trim()
    if (!image) continue

    const assetId = `char:${character.id}`
    if (seen.has(assetId)) continue
    seen.add(assetId)
    assets.push({
      assetId,
      name: character.name.trim() || '角色',
      type: 'character',
      image,
      source: 'configured'
    })
  }

  return assets
}

function collectSceneCharacterReferenceAssets(
  options: Pick<SceneReferenceOptions, 'scene' | 'characters'>
): SceneVideoReferenceAsset[] {
  const { refs } = resolveCharacterRefsFromScene({
    scene: options.scene,
    characters: options.characters
  })
  const assets: SceneVideoReferenceAsset[] = []
  const seen = new Set<string>()

  for (const ref of refs) {
    const characterId = ref.replace('char:', '')
    const matched = options.characters.find(character => character.id === characterId)
    const image = matched?.baseImage?.trim()
    if (!matched || !image) continue

    const assetId = `char:${matched.id}`
    if (seen.has(assetId)) continue
    seen.add(assetId)
    assets.push({
      assetId,
      name: matched.name.trim() || '角色',
      type: 'character',
      image,
      source: 'fallback'
    })
  }

  return assets
}

function resolveConfiguredPropReferenceAssets(
  options: Pick<SceneReferenceOptions, 'scene' | 'propAssets' | 'sceneConfigs'>
): SceneVideoReferenceAsset[] {
  const config = options.sceneConfigs[options.scene.id]
  if (!config) return []

  const propIds = uniqueSorted(
    config.mustReferenceAssetIds
      .filter(assetId => assetId.startsWith('prop:'))
      .map(assetId => assetId.slice('prop:'.length))
      .filter(Boolean)
  )

  const assets: SceneVideoReferenceAsset[] = []
  const seen = new Set<string>()
  for (const propId of propIds) {
    const prop = options.propAssets.find(item => item.id === propId)
    const image = prop?.referenceImage?.trim()
    if (!image) continue

    const assetId = `prop:${propId}`
    if (seen.has(assetId)) continue
    seen.add(assetId)
    assets.push({
      assetId,
      name: prop?.name?.trim() || '道具',
      type: 'prop',
      image,
      source: 'configured'
    })
  }

  return assets
}

export function resolveSceneVideoReferenceAssets(
  options: SceneReferenceOptions
): SceneVideoReferenceAsset[] {
  const assets: SceneVideoReferenceAsset[] = []
  const seenImage = new Set<string>()

  const appendAsset = (asset: SceneVideoReferenceAsset) => {
    const image = asset.image?.trim()
    if (!image || seenImage.has(image)) return
    seenImage.add(image)
    assets.push({
      ...asset,
      image
    })
  }

  for (const asset of resolveConfiguredCharacterReferenceAssets(options)) {
    appendAsset(asset)
  }
  for (const asset of collectSceneCharacterReferenceAssets(options)) {
    appendAsset(asset)
  }
  for (const asset of resolveConfiguredPropReferenceAssets(options)) {
    appendAsset(asset)
  }

  return assets
}

export function resolveSceneVideoCharacterReferences(options: SceneReferenceOptions): string[] {
  return resolveSceneVideoReferenceAssets(options).map(item => item.image)
}
