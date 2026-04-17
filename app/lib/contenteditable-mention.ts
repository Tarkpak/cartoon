import { nextTick } from 'vue'

export interface CaretSegment {
  type: 'text' | 'mention'
  node: Node
  start: number
  end: number
}

export interface AtMentionState {
  open: boolean
  query: string
  start: number | null
}

interface ContentEditableSerializationOptions {
  mentionDatasetKeys: string[]
}

interface ReadContentEditableEditorStateOptions {
  editor: HTMLElement | null
  fallbackText: string
  serializeNodes: (nodes: NodeList | Node[]) => string
}

interface SetContentEditableEditorCaretOptions {
  editor: HTMLElement | null
  offset: number
  collectSegments: (nodes: Node[], start?: number) => { segments: CaretSegment[], end: number }
}

interface RenderContentEditableTextWithMatchesOptions {
  editor: HTMLElement | null
  text: string
  matcher: RegExp | null
  createMatchNode: (match: RegExpMatchArray) => Node | null
  setCaret: (offset: number) => void
  caretOffset?: number
}

interface ResolveAtMentionStateOptions {
  maxQueryLength: number
  invalidQueryPattern?: RegExp
  invalidPrefixPattern?: RegExp
}

const DEFAULT_INVALID_QUERY_PATTERN = /[\s\r\n]/
const DEFAULT_INVALID_PREFIX_PATTERN = /[a-zA-Z0-9_]/

function resolveMentionToken(element: HTMLElement, mentionDatasetKeys: string[]) {
  for (const key of mentionDatasetKeys) {
    const token = element.dataset?.[key]
    if (token) return token
  }

  return ''
}

export function serializeContentEditableNode(
  node: Node,
  options: ContentEditableSerializationOptions
): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return Array.from(node.childNodes)
      .map(child => serializeContentEditableNode(child, options))
      .join('')
  }

  const element = node as HTMLElement
  const mentionToken = resolveMentionToken(element, options.mentionDatasetKeys)
  if (mentionToken) return mentionToken
  if (element.tagName === 'BR') return '\n'

  const text = Array.from(element.childNodes)
    .map(child => serializeContentEditableNode(child, options))
    .join('')

  if (element.tagName === 'DIV' || element.tagName === 'P') {
    return `${text}\n`
  }

  return text
}

export function getSerializedContentEditableText(
  nodes: NodeList | Node[],
  options: ContentEditableSerializationOptions
): string {
  return Array.from(nodes)
    .map(node => serializeContentEditableNode(node, options))
    .join('')
}

function getSerializedNodeLength(node: Node, options: ContentEditableSerializationOptions) {
  return serializeContentEditableNode(node, options).length
}

export function collectContentEditableCaretSegments(
  nodes: Node[],
  options: ContentEditableSerializationOptions,
  start = 0
): { segments: CaretSegment[], end: number } {
  const segments: CaretSegment[] = []
  let offset = start

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = getSerializedNodeLength(node, options)
      const next = offset + length
      segments.push({ type: 'text', node, start: offset, end: next })
      offset = next
      continue
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (resolveMentionToken(element, options.mentionDatasetKeys)) {
        const length = getSerializedNodeLength(node, options)
        const next = offset + length
        segments.push({ type: 'mention', node, start: offset, end: next })
        offset = next
        continue
      }

      const nested = collectContentEditableCaretSegments(
        Array.from(node.childNodes),
        options,
        offset
      )
      segments.push(...nested.segments)
      offset = nested.end
      continue
    }

    offset += getSerializedNodeLength(node, options)
  }

  return { segments, end: offset }
}

export function readContentEditableEditorState(options: ReadContentEditableEditorStateOptions) {
  const editor = options.editor
  if (!editor) {
    return {
      text: options.fallbackText,
      caret: options.fallbackText.length
    }
  }

  const text = options.serializeNodes(editor.childNodes)
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return { text, caret: text.length }
  }

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.endContainer)) {
    return { text, caret: text.length }
  }

  const preRange = range.cloneRange()
  preRange.selectNodeContents(editor)
  preRange.setEnd(range.endContainer, range.endOffset)
  const fragment = preRange.cloneContents()

  return {
    text,
    caret: options.serializeNodes(fragment.childNodes).length
  }
}

export function setContentEditableEditorCaret(options: SetContentEditableEditorCaretOptions) {
  const editor = options.editor
  if (!editor) return

  const selection = window.getSelection()
  if (!selection) return

  editor.focus()

  const { segments, end } = options.collectSegments(Array.from(editor.childNodes))
  const targetOffset = Math.max(0, Math.min(options.offset, end))
  const range = document.createRange()

  if (segments.length === 0) {
    range.selectNodeContents(editor)
    range.collapse(false)
  } else {
    let placed = false

    for (const segment of segments) {
      if (targetOffset > segment.end) continue

      if (segment.type === 'text' && segment.node.nodeType === Node.TEXT_NODE) {
        range.setStart(segment.node as Text, Math.max(0, targetOffset - segment.start))
      } else if (targetOffset <= segment.start) {
        range.setStartBefore(segment.node)
      } else {
        range.setStartAfter(segment.node)
      }

      range.collapse(true)
      placed = true
      break
    }

    if (!placed) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

export function renderContentEditableTextWithMatches(
  options: RenderContentEditableTextWithMatchesOptions
) {
  const editor = options.editor
  if (!editor) return

  const fragment = document.createDocumentFragment()
  let lastIndex = 0

  if (options.matcher) {
    options.matcher.lastIndex = 0

    for (const match of options.text.matchAll(options.matcher)) {
      const token = match[0] || ''
      const index = match.index ?? -1
      if (index < 0) continue

      if (index > lastIndex) {
        fragment.append(document.createTextNode(options.text.slice(lastIndex, index)))
      }

      const node = options.createMatchNode(match)
      fragment.append(node || document.createTextNode(token))
      lastIndex = index + token.length
    }
  }

  if (lastIndex < options.text.length) {
    fragment.append(document.createTextNode(options.text.slice(lastIndex)))
  }

  if (fragment.childNodes.length === 0) {
    fragment.append(document.createTextNode(''))
  }

  editor.replaceChildren(fragment)

  if (typeof options.caretOffset === 'number') {
    nextTick(() => {
      options.setCaret(options.caretOffset as number)
    })
  }
}

export function resolveAtMentionState(
  text: string,
  caret: number,
  options: ResolveAtMentionStateOptions
): AtMentionState {
  const beforeCaret = text.slice(0, caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) {
    return {
      open: false,
      query: '',
      start: null
    }
  }

  const query = beforeCaret.slice(atIndex + 1)
  if ((query.length > options.maxQueryLength)
    || (options.invalidQueryPattern || DEFAULT_INVALID_QUERY_PATTERN).test(query)) {
    return {
      open: false,
      query: '',
      start: null
    }
  }

  const charBeforeAt = beforeCaret[atIndex - 1]
  if (charBeforeAt && (options.invalidPrefixPattern || DEFAULT_INVALID_PREFIX_PATTERN).test(charBeforeAt)) {
    return {
      open: false,
      query: '',
      start: null
    }
  }

  return {
    open: true,
    query,
    start: atIndex
  }
}

export function insertMentionText(options: {
  text: string
  start: number
  caret: number
  token: string
}) {
  const safeStart = Math.max(0, Math.min(options.start, options.text.length))
  const safeCaret = Math.max(safeStart, Math.min(options.caret, options.text.length))
  const before = options.text.slice(0, safeStart)
  const after = options.text.slice(safeCaret)
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after)
  const insertion = `${needsLeadingSpace ? ' ' : ''}${options.token}${needsTrailingSpace ? ' ' : ''}`

  return {
    text: `${before}${insertion}${after}`,
    caret: before.length + insertion.length
  }
}

export function scrollMentionActiveItemIntoView(options: {
  listElement: HTMLElement | null
  activeIndex: number
  dataAttribute: string
}) {
  nextTick(() => {
    const target = options.listElement?.querySelector<HTMLElement>(
      `[${options.dataAttribute}="${options.activeIndex}"]`
    )
    target?.scrollIntoView({ block: 'nearest' })
  })
}
