import type { SceneData } from '~/composables/useAssetWorkbench'
import { TIME_OF_DAY_OPTIONS } from '#shared/types/script'
import type { DisplayAsset } from '~/lib/asset-workbench-types'
import {
  buildAssetMentionToken,
  resolveDisplayAssetTypeLabel,
  resolveDisplayAssetTypeOrder
} from '~/lib/asset-workbench-mentions'

export type DialogueItem = SceneData['dialogues'][number]
export type CharacterItem = SceneData['characters'][number]
export type SceneEditData = Pick<
  SceneData,
  | 'id'
  | 'title'
  | 'description'
  | 'narration'
  | 'characters'
  | 'dialogues'
  | 'duration'
  | 'shotType'
  | 'cameraMovement'
  | 'cameraNote'
  | 'transitionIn'
  | 'transitionOut'
  | 'transitionDuration'
> & {
  setting?: { location: string, timeOfDay: string }
}

export type AssetReferenceType = DisplayAsset['type']
export type AssetReferenceOption = DisplayAsset
export type DragDropZone = 'pool' | 'selected'

export interface AssetMentionCandidate {
  asset: AssetReferenceOption
  token: string
  searchText: string
}

export interface CaretSegment {
  type: 'text' | 'mention'
  node: Node
  start: number
  end: number
}

export const timeOfDayOptions = TIME_OF_DAY_OPTIONS

const SCENE_ASSET_MENTION_SECTION_BLOCK_REGEX = /\n{0,2}\[引用资产\]\n(?:@[^\n]*\n?)*$/u

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function resolveAssetTypeLabel(type: AssetReferenceType): string {
  return resolveDisplayAssetTypeLabel(type)
}

export function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function sortAssetReferenceOptions(left: AssetReferenceOption, right: AssetReferenceOption): number {
  const typeSort = resolveDisplayAssetTypeOrder(left.type) - resolveDisplayAssetTypeOrder(right.type)
  if (typeSort !== 0) return typeSort
  return left.name.localeCompare(right.name)
}

export function resolveSceneAssetReferenceCollections(options: {
  assetReferenceOptions: AssetReferenceOption[]
  selectedAssetReferenceIds: string[]
}) {
  const optionMap = new Map(options.assetReferenceOptions.map(asset => [asset.id, asset]))
  const selectedAssetReferenceIdSet = new Set(options.selectedAssetReferenceIds)

  const selectedAssetReferences = options.selectedAssetReferenceIds
    .map((id) => {
      const matched = optionMap.get(id)
      if (matched) return matched
      return {
        id,
        name: id,
        type: 'prop' as const
      }
    })
    .sort(sortAssetReferenceOptions)

  const assetPoolReferences = options.assetReferenceOptions
    .filter(asset => !selectedAssetReferenceIdSet.has(asset.id))
    .sort(sortAssetReferenceOptions)

  const selectedKnownAssets = options.assetReferenceOptions
    .filter(asset => selectedAssetReferenceIdSet.has(asset.id))

  const knownIds = new Set(options.assetReferenceOptions.map(asset => asset.id))

  return {
    selectedAssetReferenceIdSet,
    selectedAssetReferences,
    assetPoolReferences,
    poolCharacterAssets: assetPoolReferences.filter(asset => asset.type === 'character'),
    poolEnvironmentAssets: assetPoolReferences.filter(asset => asset.type === 'environment'),
    poolPropAssets: assetPoolReferences.filter(asset => asset.type === 'prop'),
    selectedCharacterAssets: selectedKnownAssets
      .filter(asset => asset.type === 'character')
      .sort((left, right) => left.name.localeCompare(right.name)),
    selectedEnvironmentAssets: selectedKnownAssets
      .filter(asset => asset.type === 'environment')
      .sort((left, right) => left.name.localeCompare(right.name)),
    selectedPropAssets: selectedKnownAssets
      .filter(asset => asset.type === 'prop')
      .sort((left, right) => left.name.localeCompare(right.name)),
    selectedUnknownAssets: selectedAssetReferences.filter(asset => !knownIds.has(asset.id))
  }
}

export function buildSceneAssetMentionCandidates(
  assetReferenceOptions: AssetReferenceOption[]
): AssetMentionCandidate[] {
  const assets = assetReferenceOptions
    .filter(asset => !!asset.name?.trim())
    .slice()
    .sort(sortAssetReferenceOptions)

  const nameCount = new Map<string, number>()
  for (const asset of assets) {
    const key = asset.name.trim()
    nameCount.set(key, (nameCount.get(key) || 0) + 1)
  }

  return assets.map((asset) => {
    const duplicatedName = (nameCount.get(asset.name.trim()) || 0) > 1
    const token = buildAssetMentionToken(asset, duplicatedName)
    const searchText = [
      asset.name,
      resolveDisplayAssetTypeLabel(asset.type),
      asset.id,
      token
    ].join(' ').toLowerCase()

    return {
      asset,
      token,
      searchText
    }
  })
}

export function resolveSceneDescriptionMentionCandidates(
  candidates: AssetMentionCandidate[],
  query: string
): AssetMentionCandidate[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return candidates

  return candidates.filter((candidate) => {
    return candidate.searchText.includes(normalizedQuery)
      || candidate.token.toLowerCase().includes(`@${normalizedQuery}`)
  })
}

export function resolveSceneInlineCharacterMentionCandidates(
  candidates: AssetMentionCandidate[]
): AssetMentionCandidate[] {
  const uniqueByName = new Map<string, AssetMentionCandidate>()
  const duplicatedNames = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.asset.type !== 'character') continue
    const name = candidate.asset.name.trim()
    if (!name) continue

    if (uniqueByName.has(name)) {
      duplicatedNames.add(name)
      continue
    }
    uniqueByName.set(name, candidate)
  }

  for (const duplicatedName of duplicatedNames) {
    uniqueByName.delete(duplicatedName)
  }

  return Array.from(uniqueByName.values()).sort((left, right) => {
    return right.asset.name.length - left.asset.name.length
  })
}

export function buildSceneDescriptionMentionMatcher(
  candidates: AssetMentionCandidate[]
): RegExp | null {
  const tokens = candidates
    .map(candidate => candidate.token)
    .sort((left, right) => right.length - left.length)

  if (tokens.length === 0) return null
  return new RegExp(tokens.map(token => escapeRegExp(token)).join('|'), 'g')
}

export function normalizeSceneDescriptionCharacterMentions(
  text: string,
  candidates: AssetMentionCandidate[]
): string {
  if (!text || candidates.length === 0) return text

  const blockMatch = text.match(SCENE_ASSET_MENTION_SECTION_BLOCK_REGEX)
  const bodyEnd = blockMatch?.index ?? text.length
  const mentionBlock = blockMatch?.[0] || ''
  const body = text.slice(0, bodyEnd)

  if (!body) return text

  let cursor = 0
  let normalized = ''

  const findNextValidIndex = (rawText: string, name: string, start: number): number => {
    let index = rawText.indexOf(name, start)
    while (index >= 0) {
      const prevChar = index > 0 ? rawText[index - 1] : ''
      if (prevChar !== '@') return index
      index = rawText.indexOf(name, index + name.length)
    }
    return -1
  }

  while (cursor < body.length) {
    let matchedIndex = -1
    let matchedCandidate: AssetMentionCandidate | null = null

    for (const candidate of candidates) {
      const name = candidate.asset.name.trim()
      if (!name) continue
      const index = findNextValidIndex(body, name, cursor)
      if (index < 0) continue

      if (
        matchedIndex < 0
        || index < matchedIndex
        || (index === matchedIndex && (matchedCandidate?.asset.name.length || 0) < name.length)
      ) {
        matchedIndex = index
        matchedCandidate = candidate
      }
    }

    if (matchedIndex < 0 || !matchedCandidate) {
      normalized += body.slice(cursor)
      break
    }

    if (matchedIndex > cursor) {
      normalized += body.slice(cursor, matchedIndex)
    }
    normalized += matchedCandidate.token
    cursor = matchedIndex + matchedCandidate.asset.name.length
  }

  return `${normalized}${mentionBlock}`
}

export function extractMentionedAssetIdsFromDescription(
  text: string,
  candidateTokenMap: Map<string, AssetMentionCandidate>
): string[] {
  const matcher = buildSceneDescriptionMentionMatcher(Array.from(candidateTokenMap.values()))
  if (!matcher || !text) return []

  const ids = new Set<string>()
  for (const match of text.matchAll(matcher)) {
    const token = match[0] || ''
    const candidate = candidateTokenMap.get(token)
    if (candidate) {
      ids.add(candidate.asset.id)
    }
  }

  return Array.from(ids)
}
