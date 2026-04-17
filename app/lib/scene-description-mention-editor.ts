import {
  collectContentEditableCaretSegments,
  getSerializedContentEditableText,
  insertMentionText,
  resolveAtMentionState,
  type AtMentionState,
  type CaretSegment
} from '~/lib/contenteditable-mention'

const SCENE_DESCRIPTION_MENTION_DATASET_KEYS = ['assetMentionToken']

export type SceneDescriptionMentionState = AtMentionState

export function getSerializedSceneDescriptionText(nodes: NodeList | Node[]): string {
  return getSerializedContentEditableText(nodes, {
    mentionDatasetKeys: SCENE_DESCRIPTION_MENTION_DATASET_KEYS
  })
}

export function collectSceneDescriptionCaretSegments(
  nodes: Node[],
  start = 0
): { segments: CaretSegment[], end: number } {
  return collectContentEditableCaretSegments(nodes, {
    mentionDatasetKeys: SCENE_DESCRIPTION_MENTION_DATASET_KEYS
  }, start)
}

export function resolveSceneDescriptionMentionState(
  text: string,
  caret: number
): SceneDescriptionMentionState {
  return resolveAtMentionState(text, caret, {
    maxQueryLength: 32
  })
}

export function insertSceneDescriptionMentionText(options: {
  text: string
  start: number
  caret: number
  token: string
}): { text: string, caret: number } {
  return insertMentionText(options)
}
