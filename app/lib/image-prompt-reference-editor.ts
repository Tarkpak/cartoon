import {
  collectContentEditableCaretSegments,
  getSerializedContentEditableText,
  insertMentionText,
  resolveAtMentionState,
  type CaretSegment
} from '~/lib/contenteditable-mention'

export interface ImageMentionCandidate {
  index: number
  image: string
  token: string
  aliases: string[]
}

const IMAGE_PROMPT_MENTION_DATASET_KEYS = ['mentionToken']

export const IMAGE_REFERENCE_INLINE_PATTERN
  = String.raw`(?:@(?:图|img|image)?\s*([1-9]\d*)|\[(?:图|img|image)\s*([1-9]\d*)\])`

export const IMAGE_REFERENCE_EXTRACT_PATTERN
  = String.raw`(?:\[(?:图|img|image)\s*([1-9]\d*)\]|@(?:图|img|image)?\s*([1-9]\d*))`

export function getImageMentionToken(index: number): string {
  return `@图${index + 1}`
}

export function buildImageMentionCandidates(
  referenceImages: string[],
  rawQuery: string
): ImageMentionCandidate[] {
  const query = rawQuery.trim().toLowerCase()

  return referenceImages
    .map((image, index) => {
      const numeric = String(index + 1)
      return {
        index,
        image,
        token: getImageMentionToken(index),
        aliases: [numeric, `图${numeric}`, `img${numeric}`, `image${numeric}`]
      }
    })
    .filter((item) => {
      if (!query) return true
      return item.aliases.some(alias => alias.includes(query) || query.includes(alias))
    })
}

export function getSerializedTextFromNodes(nodes: NodeList | Node[]): string {
  return getSerializedContentEditableText(nodes, {
    mentionDatasetKeys: IMAGE_PROMPT_MENTION_DATASET_KEYS
  })
}

export function collectCaretSegments(
  nodes: Node[],
  start = 0
): { segments: CaretSegment[], end: number } {
  return collectContentEditableCaretSegments(nodes, {
    mentionDatasetKeys: IMAGE_PROMPT_MENTION_DATASET_KEYS
  }, start)
}

export function resolveImagePromptMentionState(text: string, caret: number) {
  return resolveAtMentionState(text, caret, {
    maxQueryLength: 24
  })
}

export function insertImageMentionText(options: {
  text: string
  start: number
  caret: number
  token: string
}) {
  return insertMentionText(options)
}

export function appendImageReferenceTokenMapping(prompt: string, total: number): string {
  if (total === 0) return prompt

  const referencedIndexes: number[] = []
  const matcher = new RegExp(IMAGE_REFERENCE_EXTRACT_PATTERN, 'giu')

  for (const match of prompt.matchAll(matcher)) {
    const rawIndex = Number(match[1] || match[2] || NaN)
    if (!Number.isInteger(rawIndex)) continue

    const imageIndex = rawIndex - 1
    if (imageIndex < 0 || imageIndex >= total) continue
    if (!referencedIndexes.includes(imageIndex)) {
      referencedIndexes.push(imageIndex)
    }
  }

  if (referencedIndexes.length === 0) return prompt

  const mappingText = referencedIndexes
    .map(imageIndex => `- @图${imageIndex + 1} 表示第 ${imageIndex + 1} 张上传参考图`)
    .join('\n')

  return `${prompt}\n\n[参考图标签映射]\n${mappingText}`
}
