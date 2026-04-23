import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  SceneDescriptionRenderSegment
} from '~/lib/asset-workbench-types'
import {
  resolveAssetByMentionTokenMap,
  resolveSceneDescriptionMentionItems,
  resolveSceneDescriptionWithoutAssetMentions
} from '~/lib/asset-workbench-mention-tokens'

const SCENE_IMAGE_TAG_REGEX = /(?:\[(?:图片|Image\s*#)\s*\d+\]|@(?:图片|Image\s*#)\s*\d+)/giu
const SCENE_QUOTED_DIALOGUE_REGEX = /'[^'\n]*'|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/gu
const SCENE_DIALOGUE_LABEL_LINE_REGEX = /(?:台词|对白|对话)\s*[：:][^\n]*/gu

interface TextRange {
  start: number
  end: number
}

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

function mergeTextRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length === 0) return []

  const sorted = ranges
    .filter(range => range.end > range.start)
    .slice()
    .sort((left, right) => left.start - right.start)

  if (sorted.length === 0) return []

  const merged: TextRange[] = [{ ...sorted[0]! }]
  for (let index = 1; index < sorted.length; index += 1) {
    const range = sorted[index]
    const last = merged[merged.length - 1]
    if (!range || !last) continue

    if (range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
      continue
    }

    merged.push({ ...range })
  }

  return merged
}

function collectDialogueLikeRanges(text: string, characterNames: string[]): TextRange[] {
  const ranges: TextRange[] = []

  for (const match of text.matchAll(SCENE_QUOTED_DIALOGUE_REGEX)) {
    const content = match[0] || ''
    const index = match.index ?? -1
    if (!content || index < 0) continue
    ranges.push({
      start: index,
      end: index + content.length
    })
  }

  for (const match of text.matchAll(SCENE_DIALOGUE_LABEL_LINE_REGEX)) {
    const content = match[0] || ''
    const index = match.index ?? -1
    if (!content || index < 0) continue

    const leadingBreakOffset = content.startsWith('\n') ? 1 : 0
    ranges.push({
      start: index + leadingBreakOffset,
      end: index + content.length
    })
  }

  const normalizedNames = Array.from(new Set(
    characterNames
      .map(name => name.trim())
      .filter(Boolean)
  ))
    .sort((left, right) => right.length - left.length)

  if (normalizedNames.length > 0) {
    const speakerRegex = new RegExp(
      `(^|\\n)\\s*(?:${normalizedNames.map(name => escapeRegExpForSceneDescription(name)).join('|')})\\s*[：:][^\\n]*`,
      'gu'
    )

    for (const match of text.matchAll(speakerRegex)) {
      const content = match[0] || ''
      const index = match.index ?? -1
      if (!content || index < 0) continue

      const leadingBreakOffset = content.startsWith('\n') ? 1 : 0
      ranges.push({
        start: index + leadingBreakOffset,
        end: index + content.length
      })
    }
  }

  return mergeTextRanges(ranges)
}

function isInsideRange(
  start: number,
  length: number,
  ranges: TextRange[]
): boolean {
  if (length <= 0 || ranges.length === 0) return false
  const end = start + length

  for (const range of ranges) {
    if (start < range.end && end > range.start) {
      return true
    }
  }

  return false
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

function findNextCharacterMentionIndex(
  text: string,
  name: string,
  start: number,
  blockedRanges: TextRange[]
): number {
  if (!text || !name) return -1

  let index = text.indexOf(name, start)
  while (index >= 0) {
    const prevChar = index > 0 ? text[index - 1] : ''
    const nextChar = text[index + name.length] || ''
    const insideSquareBracket = prevChar === '[' || nextChar === ']'
    const mentionTokenFragment = prevChar === '@'
    const insideBlockedRange = isInsideRange(index, name.length, blockedRanges)

    if (!insideSquareBracket && !mentionTokenFragment && !insideBlockedRange) {
      return index
    }

    index = text.indexOf(name, index + name.length)
  }

  return -1
}

function findNextAssetMentionMatch(
  text: string,
  mentionAssetMap: Map<string, DisplayAsset>,
  start: number
): { index: number, token: string, asset?: DisplayAsset } {
  let nextIndex = -1
  let nextToken = ''
  let nextAsset: DisplayAsset | undefined

  for (const [token, asset] of mentionAssetMap) {
    const index = text.indexOf(token, start)
    if (index < 0) continue

    if (
      nextIndex < 0
      || index < nextIndex
      || (index === nextIndex && nextToken.length < token.length)
    ) {
      nextIndex = index
      nextToken = token
      nextAsset = asset
    }
  }

  return {
    index: nextIndex,
    token: nextToken,
    asset: nextAsset
  }
}

function resolveSceneDescriptionInlineMentionAssets(options: {
  scene: SceneData
  assets: DisplayAsset[]
  configAssetIds?: string[]
  uniqueSorted: (values: string[]) => string[]
}): DisplayAsset[] {
  const assets = resolveSceneDescriptionMentionItems(options)
    .map(item => item.asset)
    .filter((asset): asset is DisplayAsset => {
      return !!asset
        && asset.type !== 'environment'
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
  const mentionAssetMap = resolveAssetByMentionTokenMap(options.assets)
  const inlineMentionAssets = resolveSceneDescriptionInlineMentionAssets(options)
    .slice()
    .sort((left, right) => right.name.length - left.name.length)
  const characterNames = inlineMentionAssets
    .filter(asset => asset.type === 'character')
    .map(asset => asset.name)

  const description = stripRedundantBracketedCharacterTags(
    normalizeSceneDescriptionForDisplay(
      resolveSceneDescriptionWithoutAssetMentions(options.scene.description || '')
    ),
    characterNames
  )
  if (!description) return []
  const dialogueLikeRanges = collectDialogueLikeRanges(description, characterNames)

  if (inlineMentionAssets.length === 0 && mentionAssetMap.size === 0) {
    return [{ type: 'text', text: description }]
  }

  const segments: SceneDescriptionRenderSegment[] = []
  let cursor = 0

  while (cursor < description.length) {
    const nextMentionMatch = findNextAssetMentionMatch(description, mentionAssetMap, cursor)
    let nextMatchIndex = nextMentionMatch.index
    let nextAsset: DisplayAsset | undefined = nextMentionMatch.asset
    let nextMatchLength = nextMentionMatch.token.length

    for (const asset of inlineMentionAssets) {
      const name = asset.name.trim()
      if (!name) continue

      const index = findNextCharacterMentionIndex(description, name, cursor, dialogueLikeRanges)
      if (index < 0) continue

      if (
        nextMatchIndex < 0
        || index < nextMatchIndex
        || (index === nextMatchIndex && nextMatchLength < name.length)
      ) {
        nextMatchIndex = index
        nextAsset = asset
        nextMatchLength = name.length
      }
    }

    if (nextMatchIndex < 0 || !nextAsset || nextMatchLength <= 0) {
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

    cursor = nextMatchIndex + nextMatchLength
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: description }]
}
