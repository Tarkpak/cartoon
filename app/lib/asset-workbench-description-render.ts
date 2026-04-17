import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  SceneDescriptionRenderSegment
} from '~/lib/asset-workbench-types'
import {
  resolveSceneDescriptionMentionItems,
  resolveSceneDescriptionWithoutAssetMentions
} from '~/lib/asset-workbench-mention-tokens'

const SCENE_IMAGE_TAG_REGEX = /\[(?:图片|Image\s*#)\s*\d+\]/giu

function normalizeSceneDescriptionForDisplay(text: string): string {
  if (!text) return ''
  return text
    .replace(SCENE_IMAGE_TAG_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

function escapeRegExpForSceneDescription(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripRedundantBracketedCharacterTags(text: string, characterNames: string[]): string {
  if (!text || characterNames.length === 0) return text

  let normalized = text
  const names = Array.from(new Set(
    characterNames
      .map(name => name.trim())
      .filter(Boolean)
  ))
    .sort((left, right) => right.length - left.length)

  for (const name of names) {
    const escaped = escapeRegExpForSceneDescription(name)
    const bracketTagPattern = new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'gu')
    const adjacentDuplicatePattern = new RegExp(`(${escaped})\\s*\\1`, 'gu')
    normalized = normalized.replace(bracketTagPattern, '')
    normalized = normalized.replace(adjacentDuplicatePattern, '$1')
  }

  return normalized
}

function findNextCharacterMentionIndex(text: string, name: string, start: number): number {
  if (!text || !name) return -1

  let index = text.indexOf(name, start)
  while (index >= 0) {
    const prevChar = index > 0 ? text[index - 1] : ''
    const nextChar = text[index + name.length] || ''
    const insideSquareBracket = prevChar === '[' || nextChar === ']'
    const mentionTokenFragment = prevChar === '@'

    if (!insideSquareBracket && !mentionTokenFragment) {
      return index
    }

    index = text.indexOf(name, index + name.length)
  }

  return -1
}

function resolveSceneDescriptionCharacterMentionAssets(options: {
  scene: SceneData
  assets: DisplayAsset[]
  configAssetIds?: string[]
  uniqueSorted: (values: string[]) => string[]
}): DisplayAsset[] {
  const assets = resolveSceneDescriptionMentionItems(options)
    .map(item => item.asset)
    .filter((asset): asset is DisplayAsset => {
      return !!asset
        && asset.type === 'character'
        && !!asset.name?.trim()
    })

  const nameCount = new Map<string, number>()
  for (const asset of assets) {
    const key = asset.name.trim()
    nameCount.set(key, (nameCount.get(key) || 0) + 1)
  }

  const resolved = new Map<string, DisplayAsset>()
  for (const asset of assets) {
    const name = asset.name.trim()
    if ((nameCount.get(name) || 0) > 1) continue
    if (!resolved.has(asset.id)) {
      resolved.set(asset.id, asset)
    }
  }

  return Array.from(resolved.values())
}

export function resolveSceneDescriptionRenderSegments(options: {
  scene: SceneData
  assets: DisplayAsset[]
  configAssetIds?: string[]
  uniqueSorted: (values: string[]) => string[]
}): SceneDescriptionRenderSegment[] {
  const characterAssets = resolveSceneDescriptionCharacterMentionAssets(options)
    .slice()
    .sort((left, right) => right.name.length - left.name.length)

  const description = stripRedundantBracketedCharacterTags(
    normalizeSceneDescriptionForDisplay(
      resolveSceneDescriptionWithoutAssetMentions(options.scene.description || '')
    ),
    characterAssets.map(asset => asset.name)
  )
  if (!description) return []

  if (characterAssets.length === 0) {
    return [{ type: 'text', text: description }]
  }

  const segments: SceneDescriptionRenderSegment[] = []
  let cursor = 0

  while (cursor < description.length) {
    let nextMatchIndex = -1
    let nextAsset: DisplayAsset | undefined

    for (const asset of characterAssets) {
      const name = asset.name.trim()
      if (!name) continue

      const index = findNextCharacterMentionIndex(description, name, cursor)
      if (index < 0) continue

      if (
        nextMatchIndex < 0
        || index < nextMatchIndex
        || (index === nextMatchIndex && (nextAsset?.name.length || 0) < name.length)
      ) {
        nextMatchIndex = index
        nextAsset = asset
      }
    }

    if (nextMatchIndex < 0 || !nextAsset) {
      const remain = description.slice(cursor)
      if (remain) {
        segments.push({ type: 'text', text: remain })
      }
      break
    }

    if (nextMatchIndex > cursor) {
      segments.push({
        type: 'text',
        text: description.slice(cursor, nextMatchIndex)
      })
    }

    segments.push({
      type: 'asset',
      asset: nextAsset
    })

    cursor = nextMatchIndex + nextAsset.name.length
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: description }]
}
