<script setup lang="ts">
import { toImageSrc } from '~/lib/media'

interface DialogueItem {
  character: string
  text: string
  emotion?: string
}

interface CharacterItem {
  name: string
  appearance?: string
  emotion?: string
}

// 景别类型
type ShotType = 'extreme_wide' | 'wide' | 'medium_wide' | 'medium' | 'medium_close' | 'close' | 'extreme_close' | 'detail'

// 运镜方式
type CameraMovement = 'static' | 'push' | 'pull' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'track' | 'dolly' | 'zoom_in' | 'zoom_out' | 'crane' | 'handheld' | 'arc'

// 转场效果
type TransitionType = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'zoom' | 'blur' | 'flash' | 'none'

interface SceneEditData {
  id: string
  title: string
  description: string
  narration?: string
  characters: CharacterItem[]
  dialogues: DialogueItem[]
  duration: number
  setting?: { location: string, timeOfDay: string }
  // 镜头语言
  shotType?: ShotType
  cameraMovement?: CameraMovement
  cameraNote?: string
  // 转场
  transitionIn?: TransitionType
  transitionOut?: TransitionType
  transitionDuration?: number
}

type AssetReferenceType = 'character' | 'environment' | 'prop'

interface AssetReferenceOption {
  id: string
  name: string
  type: AssetReferenceType
  referenceImage?: string
  description?: string
}

type DragDropZone = 'pool' | 'selected'
type EditPanelKey = 'basic' | 'assets'

interface AssetMentionCandidate {
  asset: AssetReferenceOption
  token: string
  searchText: string
}

interface CaretSegment {
  type: 'text' | 'mention'
  node: Node
  start: number
  end: number
}

const props = defineProps<{
  open: boolean
  scene: SceneEditData | null
  availableCharacters?: string[]
  assetReferenceOptions?: AssetReferenceOption[]
  selectedAssetReferenceIds?: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [scene: SceneEditData]
  'save-asset-references': [payload: { sceneId: string, assetIds: string[] }]
}>()

// 本地编辑状态
const editForm = ref<SceneEditData>({
  id: '',
  title: '',
  description: '',
  narration: '',
  characters: [],
  dialogues: [],
  duration: 8,
  shotType: 'medium',
  cameraMovement: 'static',
  cameraNote: '',
  transitionIn: 'cut',
  transitionOut: 'cut',
  transitionDuration: 0.5
})
const selectedAssetReferenceIdsInternal = ref<string[]>([])
const activePanel = ref<EditPanelKey>('basic')
const sceneDescriptionEditorRef = ref<HTMLDivElement | null>(null)
const sceneDescriptionMentionListRef = ref<HTMLDivElement | null>(null)
const sceneDescriptionMentionOpen = ref(false)
const sceneDescriptionMentionQuery = ref('')
const sceneDescriptionMentionStart = ref<number | null>(null)
const sceneDescriptionMentionActiveIndex = ref(0)
const sceneDescriptionComposing = ref(false)
const syncingSceneDescriptionFromEditor = ref(false)

// 监听 scene 变化，初始化表单
watch(() => props.scene, (newScene) => {
  if (newScene) {
    editForm.value = {
      id: newScene.id,
      title: newScene.title,
      description: newScene.description,
      narration: newScene.narration || '',
      characters: [...newScene.characters],
      dialogues: newScene.dialogues.map(d => ({ ...d })),
      duration: newScene.duration,
      setting: newScene.setting ? { ...newScene.setting } : undefined,
      shotType: newScene.shotType || 'medium',
      cameraMovement: newScene.cameraMovement || 'static',
      cameraNote: newScene.cameraNote || '',
      transitionIn: newScene.transitionIn || 'cut',
      transitionOut: newScene.transitionOut || 'cut',
      transitionDuration: newScene.transitionDuration || 0.5
    }
    activePanel.value = 'basic'
    closeSceneDescriptionMention()
    nextTick(() => {
      renderSceneDescriptionEditor(editForm.value.description || '')
    })
  }
}, { immediate: true })

watch(
  () => [props.scene?.id, props.selectedAssetReferenceIds],
  () => {
    const ids = Array.isArray(props.selectedAssetReferenceIds)
      ? props.selectedAssetReferenceIds.filter(Boolean)
      : []
    selectedAssetReferenceIdsInternal.value = Array.from(new Set(ids))
  },
  { immediate: true, deep: true }
)

const assetReferenceOptions = computed<AssetReferenceOption[]>(() => {
  return Array.isArray(props.assetReferenceOptions) ? props.assetReferenceOptions : []
})

const sceneDescriptionSupportsMention = computed(() => assetReferenceOptions.value.length > 0)

const selectedAssetReferenceIdSet = computed(() => {
  return new Set(selectedAssetReferenceIdsInternal.value)
})

const draggingAssetId = ref('')
const activeDropZone = ref<DragDropZone | null>(null)

const selectedAssetReferences = computed<AssetReferenceOption[]>(() => {
  const optionMap = new Map(assetReferenceOptions.value.map(asset => [asset.id, asset]))
  const resolved = selectedAssetReferenceIdsInternal.value
    .map((id) => {
      const matched = optionMap.get(id)
      if (matched) return matched
      return {
        id,
        name: id,
        type: 'prop' as const
      }
    })

  return resolved.sort((left, right) => {
    const typeSort = resolveAssetTypeOrder(left.type) - resolveAssetTypeOrder(right.type)
    if (typeSort !== 0) return typeSort
    return left.name.localeCompare(right.name)
  })
})

const assetPoolReferences = computed<AssetReferenceOption[]>(() => {
  return assetReferenceOptions.value
    .filter(asset => !selectedAssetReferenceIdSet.value.has(asset.id))
    .sort((left, right) => {
      const typeSort = resolveAssetTypeOrder(left.type) - resolveAssetTypeOrder(right.type)
      if (typeSort !== 0) return typeSort
      return left.name.localeCompare(right.name)
    })
})

const poolCharacterAssets = computed<AssetReferenceOption[]>(() => {
  return assetPoolReferences.value.filter(asset => asset.type === 'character')
})

const poolEnvironmentAssets = computed<AssetReferenceOption[]>(() => {
  return assetPoolReferences.value.filter(asset => asset.type === 'environment')
})

const poolPropAssets = computed<AssetReferenceOption[]>(() => {
  return assetPoolReferences.value.filter(asset => asset.type === 'prop')
})

const selectedCharacterAssets = computed<AssetReferenceOption[]>(() => {
  return assetReferenceOptions.value
    .filter(asset => asset.type === 'character' && selectedAssetReferenceIdSet.value.has(asset.id))
    .sort((left, right) => left.name.localeCompare(right.name))
})

const selectedEnvironmentAssets = computed<AssetReferenceOption[]>(() => {
  return assetReferenceOptions.value
    .filter(asset => asset.type === 'environment' && selectedAssetReferenceIdSet.value.has(asset.id))
    .sort((left, right) => left.name.localeCompare(right.name))
})

const selectedPropAssets = computed<AssetReferenceOption[]>(() => {
  return assetReferenceOptions.value
    .filter(asset => asset.type === 'prop' && selectedAssetReferenceIdSet.value.has(asset.id))
    .sort((left, right) => left.name.localeCompare(right.name))
})

const selectedUnknownAssets = computed<AssetReferenceOption[]>(() => {
  const knownIds = new Set(assetReferenceOptions.value.map(asset => asset.id))
  return selectedAssetReferences.value.filter(asset => !knownIds.has(asset.id))
})

const panelTabs = [
  { key: 'basic' as const, label: '基础信息' },
  { key: 'assets' as const, label: '引用资产' }
]

function resolveAssetTypeOrder(type: AssetReferenceType): number {
  if (type === 'character') return 1
  if (type === 'environment') return 2
  if (type === 'prop') return 3
  return 9
}

function resolveAssetTypeLabel(type: AssetReferenceType): string {
  if (type === 'character') return '角色'
  if (type === 'environment') return '环境'
  if (type === 'prop') return '道具'
  return '资产'
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildAssetMentionToken(asset: AssetReferenceOption, duplicatedName: boolean): string {
  const assetName = asset.name.trim()
  return duplicatedName
    ? `@${resolveAssetTypeLabel(asset.type)}:${assetName}`
    : `@${assetName}`
}

const sceneAssetMentionCandidatesSource = computed<AssetMentionCandidate[]>(() => {
  const assets = assetReferenceOptions.value
    .filter(asset => !!asset.name?.trim())
    .sort((left, right) => {
      const typeSort = resolveAssetTypeOrder(left.type) - resolveAssetTypeOrder(right.type)
      if (typeSort !== 0) return typeSort
      return left.name.localeCompare(right.name)
    })

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
      resolveAssetTypeLabel(asset.type),
      asset.id,
      token
    ].join(' ').toLowerCase()

    return {
      asset,
      token,
      searchText
    }
  })
})

const sceneAssetMentionTokenMap = computed(() => {
  const map = new Map<string, AssetMentionCandidate>()
  for (const candidate of sceneAssetMentionCandidatesSource.value) {
    map.set(candidate.token, candidate)
  }
  return map
})

const sceneAssetMentionCandidateById = computed(() => {
  return new Map(
    sceneAssetMentionCandidatesSource.value.map(candidate => [candidate.asset.id, candidate])
  )
})

const sceneDescriptionMentionCandidates = computed(() => {
  const query = sceneDescriptionMentionQuery.value.trim().toLowerCase()
  if (!query) return sceneAssetMentionCandidatesSource.value

  return sceneAssetMentionCandidatesSource.value.filter((candidate) => {
    return candidate.searchText.includes(query)
      || candidate.token.toLowerCase().includes(`@${query}`)
  })
})

const sceneInlineCharacterMentionCandidates = computed<AssetMentionCandidate[]>(() => {
  const uniqueByName = new Map<string, AssetMentionCandidate>()
  const duplicatedNames = new Set<string>()

  for (const candidate of sceneAssetMentionCandidatesSource.value) {
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
})

function buildSceneDescriptionMentionMatcher(): RegExp | null {
  const tokens = sceneAssetMentionCandidatesSource.value
    .map(candidate => candidate.token)
    .sort((left, right) => right.length - left.length)

  if (tokens.length === 0) return null
  return new RegExp(tokens.map(token => escapeRegExp(token)).join('|'), 'g')
}

const SCENE_ASSET_MENTION_SECTION_BLOCK_REGEX = /\n{0,2}\[引用资产\]\n(?:@[^\n]*\n?)*$/u

function normalizeSceneDescriptionCharacterMentions(text: string): string {
  if (!text) return text
  const candidates = sceneInlineCharacterMentionCandidates.value
  if (candidates.length === 0) return text

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

function closeSceneDescriptionMention() {
  sceneDescriptionMentionOpen.value = false
  sceneDescriptionMentionQuery.value = ''
  sceneDescriptionMentionStart.value = null
  sceneDescriptionMentionActiveIndex.value = 0
}

function syncSceneDescriptionMentionActiveItemIntoView() {
  if (!sceneDescriptionMentionOpen.value) return

  nextTick(() => {
    const listElement = sceneDescriptionMentionListRef.value
    if (!listElement) return

    const target = listElement.querySelector<HTMLElement>(
      `[data-scene-description-mention-index="${sceneDescriptionMentionActiveIndex.value}"]`
    )
    target?.scrollIntoView({ block: 'nearest' })
  })
}

function resolveSceneDescriptionEditorElement(): HTMLDivElement | null {
  return sceneDescriptionEditorRef.value
}

function serializeSceneDescriptionNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return Array.from(node.childNodes).map(child => serializeSceneDescriptionNode(child)).join('')
  }

  const element = node as HTMLElement
  const mentionToken = element.dataset?.assetMentionToken
  if (mentionToken) return mentionToken
  if (element.tagName === 'BR') return '\n'

  const text = Array.from(element.childNodes).map(child => serializeSceneDescriptionNode(child)).join('')
  if (element.tagName === 'DIV' || element.tagName === 'P') {
    return `${text}\n`
  }

  return text
}

function getSerializedTextFromNodes(nodes: NodeList | Node[]): string {
  return Array.from(nodes).map(node => serializeSceneDescriptionNode(node)).join('')
}

function getSceneDescriptionEditorState(): { text: string, caret: number } {
  const editor = resolveSceneDescriptionEditorElement()
  const fallback = editForm.value.description || ''
  if (!editor) {
    return { text: fallback, caret: fallback.length }
  }

  const text = getSerializedTextFromNodes(editor.childNodes)
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
    caret: getSerializedTextFromNodes(fragment.childNodes).length
  }
}

function getSceneDescriptionNodeLength(node: Node): number {
  return serializeSceneDescriptionNode(node).length
}

function collectSceneDescriptionCaretSegments(nodes: Node[], start = 0): { segments: CaretSegment[], end: number } {
  const segments: CaretSegment[] = []
  let offset = start

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = getSceneDescriptionNodeLength(node)
      const next = offset + length
      segments.push({ type: 'text', node, start: offset, end: next })
      offset = next
      continue
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      if (element.dataset?.assetMentionToken) {
        const length = getSceneDescriptionNodeLength(node)
        const next = offset + length
        segments.push({ type: 'mention', node, start: offset, end: next })
        offset = next
        continue
      }

      const nested = collectSceneDescriptionCaretSegments(Array.from(node.childNodes), offset)
      segments.push(...nested.segments)
      offset = nested.end
      continue
    }

    offset += getSceneDescriptionNodeLength(node)
  }

  return { segments, end: offset }
}

function setSceneDescriptionEditorCaret(offset: number) {
  const editor = resolveSceneDescriptionEditorElement()
  if (!editor) return

  const selection = window.getSelection()
  if (!selection) return
  editor.focus()

  const { segments, end } = collectSceneDescriptionCaretSegments(Array.from(editor.childNodes))
  const target = Math.max(0, Math.min(offset, end))
  const range = document.createRange()

  if (segments.length === 0) {
    range.selectNodeContents(editor)
    range.collapse(false)
  } else {
    let placed = false
    for (const segment of segments) {
      if (target > segment.end) continue

      if (segment.type === 'text' && segment.node.nodeType === Node.TEXT_NODE) {
        const textNode = segment.node as Text
        range.setStart(textNode, Math.max(0, target - segment.start))
      } else if (target <= segment.start) {
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

function createSceneAssetMentionNode(candidate: AssetMentionCandidate): HTMLSpanElement {
  const mention = document.createElement('span')
  mention.className = 'inline-flex items-center gap-1 rounded-md border bg-muted/70 px-1.5 py-0.5 align-middle'
  mention.contentEditable = 'false'
  mention.dataset.assetMentionToken = candidate.token
  mention.dataset.assetId = candidate.asset.id

  if (candidate.asset.referenceImage) {
    const image = document.createElement('img')
    image.src = toImageSrc(candidate.asset.referenceImage) || ''
    image.className = 'h-4 w-4 rounded object-cover'
    image.alt = `${candidate.asset.name} 缩略图`
    mention.append(image)
  }

  const label = document.createElement('span')
  label.className = 'text-xs'
  label.textContent = candidate.token
  mention.append(label)

  return mention
}

function renderSceneDescriptionEditor(text: string, caretOffset?: number) {
  const editor = resolveSceneDescriptionEditorElement()
  if (!editor) return

  const textForRender = typeof caretOffset === 'number'
    ? text
    : normalizeSceneDescriptionCharacterMentions(text)

  const fragment = document.createDocumentFragment()
  const matcher = buildSceneDescriptionMentionMatcher()
  let lastIndex = 0

  if (matcher) {
    for (const match of textForRender.matchAll(matcher)) {
      const token = match[0] || ''
      const index = match.index ?? -1
      if (index < 0) continue

      if (index > lastIndex) {
        fragment.append(document.createTextNode(textForRender.slice(lastIndex, index)))
      }

      const candidate = sceneAssetMentionTokenMap.value.get(token)
      if (candidate) {
        fragment.append(createSceneAssetMentionNode(candidate))
      } else {
        fragment.append(document.createTextNode(token))
      }
      lastIndex = index + token.length
    }
  }

  if (lastIndex < textForRender.length) {
    fragment.append(document.createTextNode(textForRender.slice(lastIndex)))
  }

  if (fragment.childNodes.length === 0) {
    fragment.append(document.createTextNode(''))
  }

  editor.replaceChildren(fragment)

  if (typeof caretOffset === 'number') {
    nextTick(() => {
      setSceneDescriptionEditorCaret(caretOffset)
    })
  }
}

function syncSceneDescriptionFromEditor() {
  const state = getSceneDescriptionEditorState()
  syncingSceneDescriptionFromEditor.value = true
  editForm.value.description = state.text
  syncingSceneDescriptionFromEditor.value = false
  return state
}

function updateSceneDescriptionMentionState(state?: { text: string, caret: number }) {
  if (!sceneDescriptionSupportsMention.value || sceneDescriptionComposing.value) {
    closeSceneDescriptionMention()
    return
  }

  const current = state || getSceneDescriptionEditorState()
  const beforeCaret = current.text.slice(0, current.caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) {
    closeSceneDescriptionMention()
    return
  }

  const query = beforeCaret.slice(atIndex + 1)
  if (query.length > 32 || /[\s\r\n]/.test(query)) {
    closeSceneDescriptionMention()
    return
  }

  const charBeforeAt = beforeCaret[atIndex - 1]
  if (charBeforeAt && /[a-zA-Z0-9_]/.test(charBeforeAt)) {
    closeSceneDescriptionMention()
    return
  }

  sceneDescriptionMentionStart.value = atIndex
  sceneDescriptionMentionQuery.value = query
  sceneDescriptionMentionOpen.value = true
  if (sceneDescriptionMentionActiveIndex.value >= sceneDescriptionMentionCandidates.value.length) {
    sceneDescriptionMentionActiveIndex.value = 0
  }
  if (sceneDescriptionMentionCandidates.value.length > 0) {
    syncSceneDescriptionMentionActiveItemIntoView()
  }
}

function insertSceneAssetMention(assetId: string) {
  if (!sceneDescriptionSupportsMention.value) return

  const candidate = sceneAssetMentionCandidateById.value.get(assetId)
  if (!candidate) return

  const state = getSceneDescriptionEditorState()
  const start = sceneDescriptionMentionStart.value
  if (start === null) return

  const safeStart = Math.max(0, Math.min(start, state.text.length))
  const safeCaret = Math.max(safeStart, Math.min(state.caret, state.text.length))
  const before = state.text.slice(0, safeStart)
  const after = state.text.slice(safeCaret)
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after)
  const insertion = `${needsLeadingSpace ? ' ' : ''}${candidate.token}${needsTrailingSpace ? ' ' : ''}`
  const nextText = `${before}${insertion}${after}`
  const nextCaret = before.length + insertion.length

  syncingSceneDescriptionFromEditor.value = true
  editForm.value.description = nextText
  syncingSceneDescriptionFromEditor.value = false

  selectedAssetReferenceIdsInternal.value = uniqueValues([
    ...selectedAssetReferenceIdsInternal.value,
    candidate.asset.id
  ])

  closeSceneDescriptionMention()
  renderSceneDescriptionEditor(nextText, nextCaret)
}

function handleSceneDescriptionInput() {
  if (!sceneDescriptionSupportsMention.value || sceneDescriptionComposing.value) return
  const state = syncSceneDescriptionFromEditor()
  updateSceneDescriptionMentionState(state)
}

function handleSceneDescriptionCursorChange() {
  if (!sceneDescriptionSupportsMention.value || sceneDescriptionComposing.value) return
  updateSceneDescriptionMentionState()
}

function handleSceneDescriptionFocus() {
  if (!sceneDescriptionSupportsMention.value) return
  if (!sceneDescriptionComposing.value) {
    updateSceneDescriptionMentionState()
  }
}

function handleSceneDescriptionCompositionStart() {
  if (!sceneDescriptionSupportsMention.value) return
  sceneDescriptionComposing.value = true
  closeSceneDescriptionMention()
}

function handleSceneDescriptionCompositionEnd() {
  if (!sceneDescriptionSupportsMention.value) return
  sceneDescriptionComposing.value = false
  const state = syncSceneDescriptionFromEditor()
  updateSceneDescriptionMentionState(state)
}

function handleSceneDescriptionBlur() {
  if (!sceneDescriptionSupportsMention.value) return

  syncSceneDescriptionFromEditor()
  const state = getSceneDescriptionEditorState()
  renderSceneDescriptionEditor(state.text, state.caret)

  setTimeout(() => {
    closeSceneDescriptionMention()
  }, 120)
}

function handleSceneDescriptionKeydown(event: KeyboardEvent) {
  if (sceneDescriptionComposing.value) return
  if (!sceneDescriptionSupportsMention.value || !sceneDescriptionMentionOpen.value) return

  const candidates = sceneDescriptionMentionCandidates.value
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (candidates.length === 0) return
    sceneDescriptionMentionActiveIndex.value = (sceneDescriptionMentionActiveIndex.value + 1) % candidates.length
    syncSceneDescriptionMentionActiveItemIntoView()
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (candidates.length === 0) return
    sceneDescriptionMentionActiveIndex.value = (sceneDescriptionMentionActiveIndex.value - 1 + candidates.length) % candidates.length
    syncSceneDescriptionMentionActiveItemIntoView()
    return
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    if (candidates.length === 0) {
      closeSceneDescriptionMention()
      return
    }
    const target = candidates[sceneDescriptionMentionActiveIndex.value] || candidates[0]
    if (target) insertSceneAssetMention(target.asset.id)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeSceneDescriptionMention()
  }
}

function extractMentionedAssetIdsFromDescription(text: string): string[] {
  const matcher = buildSceneDescriptionMentionMatcher()
  if (!matcher || !text) return []

  const ids = new Set<string>()
  for (const match of text.matchAll(matcher)) {
    const token = match[0] || ''
    const candidate = sceneAssetMentionTokenMap.value.get(token)
    if (candidate) {
      ids.add(candidate.asset.id)
    }
  }

  return Array.from(ids)
}

watch(
  () => [
    props.open,
    activePanel.value,
    sceneDescriptionSupportsMention.value,
    assetReferenceOptions.value.map(asset => `${asset.id}:${asset.name}`).join('||')
  ],
  ([open, panel, supportsMention]) => {
    if (!open || panel !== 'basic') {
      closeSceneDescriptionMention()
      return
    }

    if (!supportsMention) return

    nextTick(() => {
      renderSceneDescriptionEditor(editForm.value.description || '')
    })
  },
  { immediate: true }
)

function writeDraggedAssetId(assetId: string, event: DragEvent) {
  const transfer = event.dataTransfer
  if (!transfer) return

  transfer.effectAllowed = 'move'
  transfer.setData('application/x-scene-asset-id', assetId)
  transfer.setData('text/plain', assetId)
}

function readDraggedAssetId(event: DragEvent): string {
  const transfer = event.dataTransfer
  if (!transfer) return draggingAssetId.value

  return transfer.getData('application/x-scene-asset-id')
    || transfer.getData('text/plain')
    || draggingAssetId.value
}

function moveAssetReference(assetId: string, targetZone: DragDropZone) {
  const existsInPool = assetReferenceOptions.value.some(asset => asset.id === assetId)
  const existsInSelected = selectedAssetReferenceIdSet.value.has(assetId)
  if (!existsInPool && !existsInSelected) return

  const next = new Set(selectedAssetReferenceIdsInternal.value)

  if (targetZone === 'selected') {
    next.add(assetId)
  } else {
    next.delete(assetId)
  }

  selectedAssetReferenceIdsInternal.value = Array.from(next)
}

function handleAssetDragStart(assetId: string, event: DragEvent) {
  draggingAssetId.value = assetId
  writeDraggedAssetId(assetId, event)
}

function handleAssetDragEnd() {
  draggingAssetId.value = ''
  activeDropZone.value = null
}

function handleDropZoneDragOver(zone: DragDropZone, event: DragEvent) {
  event.preventDefault()
  activeDropZone.value = zone
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleDropZoneDrop(zone: DragDropZone, event: DragEvent) {
  event.preventDefault()
  const assetId = readDraggedAssetId(event)
  if (!assetId) return

  moveAssetReference(assetId, zone)
  draggingAssetId.value = ''
  activeDropZone.value = null
}

function handleDropZoneDragLeave(zone: DragDropZone, event: DragEvent) {
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) return
  if (activeDropZone.value === zone) {
    activeDropZone.value = null
  }
}

// 时间选项
const timeOfDayOptions = [
  { value: 'morning', label: '清晨' },
  { value: 'day', label: '白天' },
  { value: 'afternoon', label: '下午' },
  { value: 'evening', label: '傍晚' },
  { value: 'night', label: '夜晚' }
]

// 保存
function handleSave() {
  if (sceneDescriptionSupportsMention.value) {
    syncSceneDescriptionFromEditor()
  }

  emit('save', { ...editForm.value })
  if (editForm.value.id) {
    const mentionedAssetIds = extractMentionedAssetIdsFromDescription(editForm.value.description || '')
    const ids = uniqueValues([
      ...selectedAssetReferenceIdsInternal.value,
      ...mentionedAssetIds
    ])
    emit('save-asset-references', {
      sceneId: editForm.value.id,
      assetIds: ids
    })
  }
  emit('update:open', false)
}

// 取消
function handleCancel() {
  closeSceneDescriptionMention()
  emit('update:open', false)
}
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>编辑场景</DialogTitle>
        <DialogDescription>
          修改场景标题和时间轴描述
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-4">
        <div class="rounded-md border bg-muted/30 p-1">
          <div class="grid grid-cols-2 gap-1">
            <Button
              v-for="tab in panelTabs"
              :key="tab.key"
              type="button"
              size="sm"
              :variant="activePanel === tab.key ? 'default' : 'ghost'"
              class="h-8 text-xs"
              @click="activePanel = tab.key"
            >
              {{ tab.label }}
            </Button>
          </div>
        </div>

        <!-- 场景标题 -->
        <div
          v-if="activePanel === 'basic'"
          class="space-y-2"
        >
          <label class="text-sm font-medium">场景标题</label>
          <Input
            v-model="editForm.title"
            placeholder="输入场景标题"
          />
        </div>

        <!-- 场景描述 -->
        <div
          v-if="activePanel === 'basic'"
          class="space-y-2"
        >
          <label class="text-sm font-medium">场景描述</label>
          <template v-if="sceneDescriptionSupportsMention">
            <div class="relative">
              <div
                ref="sceneDescriptionEditorRef"
                contenteditable="true"
                class="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring whitespace-pre-wrap break-words"
                @keydown="handleSceneDescriptionKeydown"
                @input="handleSceneDescriptionInput"
                @click="handleSceneDescriptionCursorChange"
                @keyup="handleSceneDescriptionCursorChange"
                @focus="handleSceneDescriptionFocus"
                @compositionstart="handleSceneDescriptionCompositionStart"
                @compositionend="handleSceneDescriptionCompositionEnd"
                @blur="handleSceneDescriptionBlur"
              />

              <p
                v-if="!editForm.description"
                class="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground/70"
              >
                按时间轴输入镜头描述，例如：0-3s：【中景】...
              </p>
            </div>

            <p class="text-xs text-muted-foreground">
              输入 `@` 可直接引用角色/环境/道具资产，选中后会以内联卡片展示。
            </p>

            <div
              v-if="sceneDescriptionMentionOpen"
              ref="sceneDescriptionMentionListRef"
              class="max-h-44 overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-sm"
            >
              <button
                v-for="(item, mentionIndex) in sceneDescriptionMentionCandidates"
                :key="`scene_asset_mention_${item.asset.id}`"
                type="button"
                :data-scene-description-mention-index="mentionIndex"
                class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition"
                :class="mentionIndex === sceneDescriptionMentionActiveIndex ? 'bg-accent' : 'hover:bg-accent/60'"
                @mousedown.prevent="insertSceneAssetMention(item.asset.id)"
              >
                <img
                  v-if="item.asset.referenceImage"
                  :src="toImageSrc(item.asset.referenceImage)"
                  :alt="`${item.asset.name} 参考图`"
                  class="h-7 w-7 rounded border object-cover"
                >
                <div
                  v-else
                  class="flex h-7 w-7 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
                >
                  {{ resolveAssetTypeLabel(item.asset.type) }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs">
                    {{ item.token }}
                  </p>
                  <p class="truncate text-[10px] text-muted-foreground">
                    {{ item.asset.name }}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  class="text-[10px]"
                >
                  {{ resolveAssetTypeLabel(item.asset.type) }}
                </Badge>
              </button>

              <div
                v-if="sceneDescriptionMentionCandidates.length === 0"
                class="px-2 py-3 text-xs text-muted-foreground"
              >
                未匹配到资产
              </div>
            </div>
          </template>
          <Textarea
            v-else
            v-model="editForm.description"
            placeholder="描述场景的画面内容..."
            class="min-h-[100px]"
          />
        </div>

        <div
          v-if="activePanel === 'assets' && assetReferenceOptions.length > 0"
          class="space-y-3 border-t pt-4"
        >
          <div class="flex items-center justify-between gap-2">
            <h4 class="text-sm font-medium">
              引用资产（拖拽增删）
            </h4>
            <Badge
              variant="outline"
              class="text-[10px]"
            >
              已选 {{ selectedAssetReferenceIdsInternal.length }}
            </Badge>
          </div>

          <p class="text-xs text-muted-foreground">
            拖动卡片到右侧可添加引用；拖回左侧可移除引用。
          </p>

          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div
              class="space-y-2 rounded-md border p-2 transition"
              :class="activeDropZone === 'pool' ? 'border-primary bg-primary/5' : 'border-input'"
              @dragover="handleDropZoneDragOver('pool', $event)"
              @dragleave="handleDropZoneDragLeave('pool', $event)"
              @drop="handleDropZoneDrop('pool', $event)"
            >
              <div class="text-xs font-medium text-muted-foreground">
                资产池（拖到右侧添加）
              </div>

              <div
                v-if="assetPoolReferences.length === 0"
                class="rounded border border-dashed px-2 py-4 text-center text-xs text-muted-foreground"
              >
                没有可添加的资产
              </div>

              <div
                v-else
                class="max-h-72 space-y-2 overflow-y-auto pr-1"
              >
                <div
                  v-if="poolCharacterAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    角色
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in poolCharacterAssets"
                      :key="`pool_character_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <img
                        v-if="asset.referenceImage"
                        :src="toImageSrc(asset.referenceImage)"
                        :alt="`${asset.name} 参考图`"
                        class="h-8 w-8 rounded border object-cover"
                      >
                      <div
                        v-else
                        class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
                      >
                        无图
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div
                  v-if="poolEnvironmentAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    环境
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in poolEnvironmentAssets"
                      :key="`pool_environment_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <img
                        v-if="asset.referenceImage"
                        :src="toImageSrc(asset.referenceImage)"
                        :alt="`${asset.name} 参考图`"
                        class="h-8 w-8 rounded border object-cover"
                      >
                      <div
                        v-else
                        class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
                      >
                        无图
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div
                  v-if="poolPropAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    道具
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in poolPropAssets"
                      :key="`pool_prop_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <div class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground">
                        道具
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                        <p
                          v-if="asset.description"
                          class="truncate text-[10px] text-muted-foreground"
                        >
                          {{ asset.description }}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              class="space-y-2 rounded-md border p-2 transition"
              :class="activeDropZone === 'selected' ? 'border-primary bg-primary/5' : 'border-input'"
              @dragover="handleDropZoneDragOver('selected', $event)"
              @dragleave="handleDropZoneDragLeave('selected', $event)"
              @drop="handleDropZoneDrop('selected', $event)"
            >
              <div class="text-xs font-medium text-muted-foreground">
                已引用资产（拖回左侧移除）
              </div>

              <div
                v-if="selectedAssetReferenceIdsInternal.length === 0"
                class="rounded border border-dashed px-2 py-4 text-center text-xs text-muted-foreground"
              >
                暂无引用资产
              </div>

              <div
                v-else
                class="max-h-72 space-y-2 overflow-y-auto pr-1"
              >
                <div
                  v-if="selectedCharacterAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    角色
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in selectedCharacterAssets"
                      :key="`selected_character_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <img
                        v-if="asset.referenceImage"
                        :src="toImageSrc(asset.referenceImage)"
                        :alt="`${asset.name} 参考图`"
                        class="h-8 w-8 rounded border object-cover"
                      >
                      <div
                        v-else
                        class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
                      >
                        无图
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div
                  v-if="selectedEnvironmentAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    环境
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in selectedEnvironmentAssets"
                      :key="`selected_environment_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <img
                        v-if="asset.referenceImage"
                        :src="toImageSrc(asset.referenceImage)"
                        :alt="`${asset.name} 参考图`"
                        class="h-8 w-8 rounded border object-cover"
                      >
                      <div
                        v-else
                        class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground"
                      >
                        无图
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div
                  v-if="selectedPropAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    道具
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in selectedPropAssets"
                      :key="`selected_prop_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <div class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground">
                        道具
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                        <p
                          v-if="asset.description"
                          class="truncate text-[10px] text-muted-foreground"
                        >
                          {{ asset.description }}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div
                  v-if="selectedUnknownAssets.length > 0"
                  class="space-y-1"
                >
                  <div class="text-[11px] text-muted-foreground">
                    其他
                  </div>
                  <div class="space-y-1">
                    <div
                      v-for="asset in selectedUnknownAssets"
                      :key="`selected_unknown_${asset.id}`"
                      draggable="true"
                      class="flex cursor-grab items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs transition active:cursor-grabbing"
                      :class="draggingAssetId === asset.id ? 'opacity-60 ring-1 ring-primary' : 'hover:border-primary/40'"
                      @dragstart="handleAssetDragStart(asset.id, $event)"
                      @dragend="handleAssetDragEnd"
                    >
                      <div class="flex h-8 w-8 items-center justify-center rounded border bg-muted/30 text-[10px] text-muted-foreground">
                        未知
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="truncate">
                          {{ asset.name }}
                        </p>
                        <p class="truncate text-[10px] text-muted-foreground">
                          该资产已不在当前资产池中
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        class="text-[10px]"
                      >
                        {{ resolveAssetTypeLabel(asset.type) }}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="activePanel === 'assets'"
          class="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
        >
          当前没有可管理的引用资产，请先在工作流中准备角色/环境/道具资产。
        </div>

        <!-- 旁白 -->
        <div
          v-if="activePanel === 'basic'"
          class="space-y-2"
        >
          <label class="text-sm font-medium">旁白（可选）</label>
          <Textarea
            v-model="editForm.narration"
            placeholder="可选：补充画外音/旁白（建议关键信息也写入场景描述）"
            class="min-h-[80px]"
          />
        </div>

        <!-- 场景设定 -->
        <div
          v-if="activePanel === 'basic'"
          class="grid grid-cols-2 gap-4"
        >
          <div class="space-y-2">
            <label class="text-sm font-medium">地点</label>
            <Input
              v-model="editForm.setting!.location"
              placeholder="场景地点"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">时间</label>
            <Select v-model="editForm.setting!.timeOfDay">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择时间" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in timeOfDayOptions"
                  :key="opt.value"
                  :value="opt.value"
                >
                  {{ opt.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- 时长 -->
        <div
          v-if="activePanel === 'basic'"
          class="space-y-2"
        >
          <label class="text-sm font-medium">预计时长 (秒)</label>
          <div class="flex items-center space-x-4">
            <Slider
              :model-value="[editForm.duration]"
              :min="2"
              :max="15"
              :step="0.5"
              class="flex-1"
              @update:model-value="editForm.duration = Number($event?.[0] ?? editForm.duration)"
            />
            <span class="w-16 text-center font-medium">{{ editForm.duration }}秒</span>
          </div>
          <p class="text-xs text-muted-foreground">
            支持 2-15 秒灵活时长
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          @click="handleCancel"
        >
          取消
        </Button>
        <Button @click="handleSave">
          保存修改
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
