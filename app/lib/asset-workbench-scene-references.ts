import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type { DisplayAsset, SceneVideoReferenceAsset } from '~/lib/asset-workbench-types'
import {
  extractSceneDescriptionMentionTokens,
  resolveAssetMentionTokenMap
} from '~/lib/asset-workbench-mentions'
import { normalizeToken } from '~/lib/asset-workbench-strings'

interface SceneReferenceOptions {
  scene: SceneData
  characters: CharacterData[]
  propAssets: PropAsset[]
  sceneConfigs: Record<string, SceneConsistencyConfig>
}

type MentionAssetTypeHint = DisplayAsset['type'] | null

function buildMentionableSceneAssets(
  characters: CharacterData[],
  propAssets: PropAsset[]
): DisplayAsset[] {
  return [
    ...characters.map(character => ({
      id: `char:${character.id}`,
      name: character.name || '角色',
      type: 'character' as const,
      referenceImage: character.baseImage
    })),
    ...propAssets.map(prop => ({
      id: `prop:${prop.id}`,
      name: prop.name || '道具',
      type: prop.category === 'other' ? 'other' as const : 'prop' as const,
      referenceImage: prop.referenceImage
    }))
  ]
}

function resolveMentionTokenTypeHint(rawType: string): MentionAssetTypeHint {
  const type = normalizeToken(rawType)
  if (!type) return null
  if (type === '角色' || type === 'character') return 'character'
  if (type === '环境' || type === 'environment') return 'environment'
  if (type === '道具' || type === 'prop') return 'prop'
  if (type === '其他' || type === 'other') return 'other'
  return null
}

function resolveMentionTokenInfo(token: string): {
  name: string
  typeHint: MentionAssetTypeHint
} | null {
  const normalizedToken = token.trim()
  if (!normalizedToken.startsWith('@')) return null

  const typedPrefix = normalizedToken.match(/^@([^:：]+)[:：](.+)$/u)
  if (typedPrefix?.[2]) {
    return {
      name: typedPrefix[2].trim(),
      typeHint: resolveMentionTokenTypeHint(typedPrefix[1] || '')
    }
  }

  return {
    name: normalizedToken.slice(1).trim(),
    typeHint: null
  }
}

function matchesTypeHint(assetType: DisplayAsset['type'], typeHint: MentionAssetTypeHint): boolean {
  if (!typeHint) return true
  return assetType === typeHint
}

function resolveMentionedSceneAssetIds(options: Pick<SceneReferenceOptions, 'scene' | 'characters' | 'propAssets'>): string[] {
  const mentionTokens = extractSceneDescriptionMentionTokens(options.scene.description || '')
  if (mentionTokens.length === 0) return []

  const mentionableAssets = buildMentionableSceneAssets(options.characters, options.propAssets)
  if (mentionableAssets.length === 0) return []

  const mentionTokenMap = resolveAssetMentionTokenMap(mentionableAssets)
  const assetIdByToken = new Map<string, string>()
  for (const [assetId, mentionToken] of mentionTokenMap) {
    if (!assetIdByToken.has(mentionToken)) {
      assetIdByToken.set(mentionToken, assetId)
    }
  }

  const seen = new Set<string>()
  const assetIds: string[] = []

  for (const rawToken of mentionTokens) {
    const token = rawToken.trim()
    if (!token.startsWith('@')) continue

    const directAssetId = assetIdByToken.get(token)
    let matchedAssetId = directAssetId

    if (!matchedAssetId) {
      const tokenInfo = resolveMentionTokenInfo(token)
      const normalizedName = normalizeToken(tokenInfo?.name || '')
      if (!normalizedName) continue

      const matchedAssets = mentionableAssets.filter((asset) => {
        if (!matchesTypeHint(asset.type, tokenInfo?.typeHint || null)) {
          return false
        }
        const normalizedAssetName = normalizeToken(asset.name)
        return !!normalizedAssetName && normalizedAssetName === normalizedName
      })
      if (matchedAssets.length === 1) {
        matchedAssetId = matchedAssets[0]?.id
      }
    }

    if (!matchedAssetId || seen.has(matchedAssetId)) continue
    seen.add(matchedAssetId)
    assetIds.push(matchedAssetId)
  }

  return assetIds
}

export function findCharacterByAssetRefId(
  rawCharacterId: string,
  characters: CharacterData[]
): CharacterData | undefined {
  return characters.find(character => character.id === rawCharacterId)
    || characters.find(character => character.id.endsWith(`_${rawCharacterId}`))
}

export function resolveConfiguredCharacterReferences(
  options: Pick<SceneReferenceOptions, 'scene' | 'characters'> & {
    sceneConfigs?: Record<string, SceneConsistencyConfig>
    propAssets?: PropAsset[]
  }
): CharacterData[] {
  const mentionedCharacterIds = resolveMentionedSceneAssetIds({
    scene: options.scene,
    characters: options.characters,
    propAssets: options.propAssets || []
  })
    .filter(assetId => assetId.startsWith('char:'))
    .map(assetId => assetId.slice('char:'.length))

  const matched = new Map<string, CharacterData>()
  for (const characterId of mentionedCharacterIds) {
    const character = findCharacterByAssetRefId(characterId, options.characters)
    if (character) {
      matched.set(character.id, character)
    }
  }

  return Array.from(matched.values())
}

function resolveConfiguredCharacterReferenceAssets(
  options: Pick<SceneReferenceOptions, 'scene' | 'characters' | 'propAssets'>
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

function resolveConfiguredPropReferenceAssets(
  options: Pick<SceneReferenceOptions, 'scene' | 'characters' | 'propAssets'>
): SceneVideoReferenceAsset[] {
  const mentionedPropIds = resolveMentionedSceneAssetIds(options)
    .filter(assetId => assetId.startsWith('prop:'))
    .map(assetId => assetId.slice('prop:'.length))

  const assets: SceneVideoReferenceAsset[] = []
  const seen = new Set<string>()
  for (const propId of mentionedPropIds) {
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
  for (const asset of resolveConfiguredPropReferenceAssets(options)) {
    appendAsset(asset)
  }

  return assets
}

export function resolveSceneVideoCharacterReferences(options: SceneReferenceOptions): string[] {
  return resolveSceneVideoReferenceAssets(options).map(item => item.image)
}
