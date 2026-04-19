import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  SceneDescriptionMentionItem
} from '~/lib/asset-workbench-types'

const SCENE_ASSET_MENTION_MARKER = '[引用资产]'
const SCENE_ASSET_MENTION_SECTION_REGEX = /\n{0,2}\[引用资产\]\n(?:@[^\n]*\n?)+$/u
const SCENE_ASSET_MENTION_SECTION_CAPTURE_REGEX = /\n{0,2}\[引用资产\]\n((?:@[^\n]*\n?)+)$/u
const SCENE_TIMELINE_LINE_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?s\s*[：:]/m
const SCENE_LEGACY_AUDIO_CONSTRAINT_REGEX = /\n?\s*不添加字幕，不添加BGM[。.]?\s*$/gu

export function resolveDisplayAssetTypeOrder(type: DisplayAsset['type']): number {
  if (type === 'character') return 1
  if (type === 'environment') return 2
  if (type === 'prop') return 3
  if (type === 'other') return 4
  return 9
}

export function resolveDisplayAssetTypeLabel(type: DisplayAsset['type']): string {
  if (type === 'character') return '角色'
  if (type === 'environment') return '环境'
  if (type === 'prop') return '道具'
  if (type === 'other') return '其他'
  return '资产'
}

export function buildAssetMentionToken(asset: DisplayAsset, duplicatedName: boolean): string {
  const name = asset.name.trim()
  if (!name) return ''

  return duplicatedName
    ? `@${resolveDisplayAssetTypeLabel(asset.type)}:${name}`
    : `@${name}`
}

export function resolveAssetMentionTokenMap(assets: DisplayAsset[]): Map<string, string> {
  const normalizedAssets = assets
    .filter(asset => !!asset.name?.trim())
    .slice()
    .sort((left, right) => {
      const typeSort = resolveDisplayAssetTypeOrder(left.type) - resolveDisplayAssetTypeOrder(right.type)
      if (typeSort !== 0) return typeSort
      return left.name.localeCompare(right.name)
    })

  const nameCounter = new Map<string, number>()
  for (const asset of normalizedAssets) {
    const key = asset.name.trim()
    nameCounter.set(key, (nameCounter.get(key) || 0) + 1)
  }

  const tokenMap = new Map<string, string>()
  for (const asset of normalizedAssets) {
    const key = asset.name.trim()
    const duplicatedName = (nameCounter.get(key) || 0) > 1
    const token = buildAssetMentionToken(asset, duplicatedName)
    if (token) {
      tokenMap.set(asset.id, token)
    }
  }

  return tokenMap
}

export function resolveAssetByMentionTokenMap(assets: DisplayAsset[]): Map<string, DisplayAsset> {
  const tokenMap = resolveAssetMentionTokenMap(assets)
  const assetMap = new Map(assets.map(asset => [asset.id, asset] as const))
  const mentionMap = new Map<string, DisplayAsset>()

  for (const [assetId, token] of tokenMap) {
    const asset = assetMap.get(assetId)
    if (asset) {
      mentionMap.set(token, asset)
    }
  }

  return mentionMap
}

function stripSceneAssetMentionSection(description: string): string {
  return description.replace(SCENE_ASSET_MENTION_SECTION_REGEX, '').trimEnd()
}

export function resolveSceneDescriptionWithoutAssetMentions(raw?: string): string {
  return stripSceneAssetMentionSection(raw || '')
    .replace(SCENE_LEGACY_AUDIO_CONSTRAINT_REGEX, '')
    .trim()
}

function isTimelineSceneDescription(text: string): boolean {
  return SCENE_TIMELINE_LINE_REGEX.test(text)
}

export function extractSceneDescriptionMentionTokens(raw?: string): string[] {
  const text = raw || ''
  const match = text.match(SCENE_ASSET_MENTION_SECTION_CAPTURE_REGEX)
  const block = match?.[1] || ''
  if (!block) return []

  const seen = new Set<string>()
  const tokens: string[] = []
  for (const line of block.split('\n')) {
    const token = line.trim()
    if (!token.startsWith('@')) continue
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }

  return tokens
}

export function buildSceneMentionDescription(baseDescription: string, mentionTokens: string[]): string {
  const base = resolveSceneDescriptionWithoutAssetMentions(baseDescription)
  if (isTimelineSceneDescription(base)) return base
  if (mentionTokens.length === 0) return base

  const section = `${SCENE_ASSET_MENTION_MARKER}\n${mentionTokens.join('\n')}`
  return base ? `${base}\n\n${section}` : section
}

export function resolveSceneMentionTokensWithFallback(options: {
  scene: SceneData
  configAssetIds?: string[]
  assetMentionTokenMap: Map<string, string>
  uniqueSorted: (values: string[]) => string[]
}): string[] {
  const describedTokens = extractSceneDescriptionMentionTokens(options.scene.description)
  const configTokens = options.configAssetIds
    ? options.uniqueSorted(options.configAssetIds)
        .map(assetId => options.assetMentionTokenMap.get(assetId) || '')
        .filter(Boolean)
    : []

  if (describedTokens.length === 0) return configTokens
  if (configTokens.length === 0) return describedTokens

  const merged = new Set<string>()
  const ordered: string[] = []

  for (const token of describedTokens) {
    if (merged.has(token)) continue
    merged.add(token)
    ordered.push(token)
  }

  for (const token of configTokens) {
    if (merged.has(token)) continue
    merged.add(token)
    ordered.push(token)
  }

  return ordered
}

export function resolveSceneDescriptionMentionItems(options: {
  scene: SceneData
  assets: DisplayAsset[]
  configAssetIds?: string[]
  uniqueSorted: (values: string[]) => string[]
}): SceneDescriptionMentionItem[] {
  const mentionMap = resolveAssetByMentionTokenMap(options.assets)
  const tokenMap = resolveAssetMentionTokenMap(options.assets)
  const tokens = resolveSceneMentionTokensWithFallback({
    scene: options.scene,
    configAssetIds: options.configAssetIds,
    assetMentionTokenMap: tokenMap,
    uniqueSorted: options.uniqueSorted
  })

  return tokens.map((token) => {
    return {
      token,
      asset: mentionMap.get(token)
    }
  })
}

export function resolveSceneDescriptionSecondaryMentionItems(options: {
  scene: SceneData
  assets: DisplayAsset[]
  configAssetIds?: string[]
  uniqueSorted: (values: string[]) => string[]
}): SceneDescriptionMentionItem[] {
  const deduplicated = new Set<string>()
  const items: SceneDescriptionMentionItem[] = []

  for (const item of resolveSceneDescriptionMentionItems(options)) {
    if (item.asset?.type === 'character') continue

    const key = item.asset?.id || item.token
    if (!key || deduplicated.has(key)) continue

    deduplicated.add(key)
    items.push(item)
  }

  return items
}
