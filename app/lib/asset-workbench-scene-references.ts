import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { SceneVideoReferenceAsset } from '~/lib/asset-workbench-types'
import { resolveCharacterRefsFromScene } from '~/lib/asset-workbench-reference-detection'
import { extractSceneDescriptionMentionTokens } from '~/lib/asset-workbench-mentions'
import { normalizeToken, uniqueSorted } from '~/lib/asset-workbench-strings'

interface SceneReferenceOptions {
  scene: SceneData
  characters: CharacterData[]
  propAssets: PropAsset[]
  sceneConfigs: Record<string, SceneConsistencyConfig>
}

function hasSceneConfig(sceneId: string, sceneConfigs: Record<string, SceneConsistencyConfig>): boolean {
  return Object.prototype.hasOwnProperty.call(sceneConfigs, sceneId)
}

function resolveMentionedCharacterNames(scene: SceneData): string[] {
  const mentionTokens = extractSceneDescriptionMentionTokens(scene.description || '')
  if (mentionTokens.length === 0) return []

  const names: string[] = []
  for (const rawToken of mentionTokens) {
    const token = rawToken.trim()
    if (!token.startsWith('@')) continue

    const explicitCharacterPrefix = token.match(/^@角色[:：](.+)$/u)
    if (explicitCharacterPrefix?.[1]) {
      names.push(explicitCharacterPrefix[1].trim())
      continue
    }

    const typedPrefix = token.match(/^@([^:：]+)[:：](.+)$/u)
    if (typedPrefix) {
      continue
    }

    names.push(token.slice(1).trim())
  }

  return uniqueSorted(names.filter(Boolean))
}

function resolveMentionedCharacterReferences(scene: SceneData, characters: CharacterData[]): CharacterData[] {
  const mentionedNames = resolveMentionedCharacterNames(scene)
  if (mentionedNames.length === 0) return []

  const matched = new Map<string, CharacterData>()
  for (const mentionedName of mentionedNames) {
    const normalizedMentionedName = normalizeToken(mentionedName)
    if (!normalizedMentionedName) continue

    for (const character of characters) {
      const normalizedCharacterName = normalizeToken(character.name)
      if (!normalizedCharacterName || normalizedCharacterName !== normalizedMentionedName) {
        continue
      }
      matched.set(character.id, character)
    }
  }

  return Array.from(matched.values())
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
  const mentionedCharacters = resolveMentionedCharacterReferences(options.scene, options.characters)
  const sceneHasConfig = hasSceneConfig(options.scene.id, options.sceneConfigs)
  if (sceneHasConfig) {
    return mentionedCharacters
  }
  return []
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
    const referenceType = prop?.category === 'other' ? 'other' as const : 'prop' as const
    assets.push({
      assetId,
      name: prop?.name?.trim() || (referenceType === 'other' ? '其他资产' : '道具'),
      type: referenceType,
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
  const sceneHasConfig = hasSceneConfig(options.scene.id, options.sceneConfigs)

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
  // 当场景已有配置时，角色引用仅来自场景描述中的显式 @角色 资产，避免对白提及被补回。
  if (!sceneHasConfig) {
    for (const asset of collectSceneCharacterReferenceAssets(options)) {
      appendAsset(asset)
    }
  }
  for (const asset of resolveConfiguredPropReferenceAssets(options)) {
    appendAsset(asset)
  }

  return assets
}

export function resolveSceneVideoCharacterReferences(options: SceneReferenceOptions): string[] {
  return resolveSceneVideoReferenceAssets(options).map(item => item.image)
}
