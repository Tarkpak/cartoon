import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  SceneChatMentionCandidate,
  SceneChatMessage
} from '~/lib/asset-workbench-types'

const SCENE_CHAT_MENTION_DELIMITER_REGEX = /[\s\n,，。.!！?？;；:：()（）【】]/u
const SCENE_CHAT_MENTION_INVALID_QUERY_REGEX = /[\s\n]/u

export interface SceneChatMentionState {
  open: boolean
  query: string
  start: number | null
}

export interface SceneChatSubmitPayload {
  text: string
  relatedAssetIds: string[]
  relatedAssets: DisplayAsset[]
  normalizedMessage: string
  userVisibleMessage: string
}

export function resolveDisplayAssetTypeOrder(type: DisplayAsset['type']): number {
  if (type === 'character') return 1
  if (type === 'environment') return 2
  if (type === 'prop') return 3
  return 9
}

export function resolveSceneChatTextareaElement(target: unknown): HTMLTextAreaElement | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLElement) {
    return target.querySelector('textarea')
  }

  if (target && typeof target === 'object' && '$el' in target) {
    const root = (target as { $el?: unknown }).$el
    if (root instanceof HTMLTextAreaElement) return root
    if (root instanceof HTMLElement) {
      return root.querySelector('textarea')
    }
  }

  return null
}

export function buildSceneChatMentionCandidates(options: {
  assets: DisplayAsset[]
  query: string
  tokenMap: Map<string, string>
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
}): SceneChatMentionCandidate[] {
  const query = options.query.trim().toLowerCase()

  return options.assets
    .slice()
    .sort((left, right) => {
      const typeSort = resolveDisplayAssetTypeOrder(left.type) - resolveDisplayAssetTypeOrder(right.type)
      if (typeSort !== 0) return typeSort
      return left.name.localeCompare(right.name)
    })
    .map((asset) => {
      const token = options.tokenMap.get(asset.id) || ''
      return {
        asset,
        token,
        searchText: `${asset.name} ${options.resolveDisplayAssetTypeLabel(asset.type)} ${asset.id} ${token}`.toLowerCase()
      }
    })
    .filter(item => !!item.token)
    .filter((item) => {
      if (!query) return true
      return item.searchText.includes(query)
    })
}

export function createSceneChatMessage(
  role: SceneChatMessage['role'],
  content: string,
  assetIds: string[],
  uniqueSorted: (values: string[]) => string[]
): SceneChatMessage {
  return {
    id: `scene_chat_msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    assetIds: uniqueSorted(assetIds),
    createdAt: Date.now()
  }
}

export function createSceneChatWelcomeMessage(): SceneChatMessage {
  return {
    id: `scene_chat_msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role: 'assistant',
    content: '请输入二次修改指令，支持 @资产 mention，也可以上传图片资产后一起调整场景。',
    assetIds: [],
    createdAt: Date.now()
  }
}

export function resolveSceneChatMentionState(options: {
  text: string
  cursor: number
  allowInline?: boolean
}): SceneChatMentionState {
  const prefix = options.text.slice(0, options.cursor)
  const mentionStart = prefix.lastIndexOf('@')

  if (mentionStart < 0) {
    return {
      open: false,
      query: '',
      start: null
    }
  }

  if (!options.allowInline) {
    const prevChar = mentionStart > 0 ? prefix[mentionStart - 1] : ''
    if (prevChar && !SCENE_CHAT_MENTION_DELIMITER_REGEX.test(prevChar)) {
      return {
        open: false,
        query: '',
        start: null
      }
    }
  }

  const query = prefix.slice(mentionStart + 1)
  if (SCENE_CHAT_MENTION_INVALID_QUERY_REGEX.test(query)) {
    return {
      open: false,
      query: '',
      start: null
    }
  }

  return {
    open: true,
    query,
    start: mentionStart
  }
}

export function applySceneChatMentionToText(options: {
  text: string
  start: number
  cursor: number
  token: string
}): { text: string, cursor: number } {
  const before = options.text.slice(0, options.start)
  const after = options.text.slice(options.cursor)
  const insert = `${options.token} `

  return {
    text: `${before}${insert}${after}`,
    cursor: before.length + insert.length
  }
}

export function resolveChatUploadAssetName(fileName: string, existingNames: string[]): string {
  const base = fileName
    .replace(/\.[^./\\]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 32)

  const fallback = base || `上传图_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`
  const used = new Set(existingNames)
  if (!used.has(fallback)) return fallback

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${fallback}_${index}`
    if (!used.has(candidate)) return candidate
  }
  return `${fallback}_${Date.now().toString().slice(-4)}`
}

export function extractAssetIdsFromSceneChatText(
  text: string,
  mentionMap: Map<string, DisplayAsset>
): string[] {
  const tokenMatches = text.match(/@[^\s,，。.!！？;；:：()（）【】]+/gu) || []
  if (tokenMatches.length === 0) return []

  const ids = new Set<string>()

  for (const rawToken of tokenMatches) {
    const token = rawToken.replace(/[，,。.!！？;；:：]+$/u, '')
    const asset = mentionMap.get(token)
    if (asset) {
      ids.add(asset.id)
    }
  }

  return Array.from(ids)
}

export function appendSceneChatUploadTokens(text: string, addedTokens: string[]): string {
  if (addedTokens.length === 0) return text

  const base = text.trimEnd()
  const appendText = addedTokens.join(' ')
  return base ? `${base}\n${appendText} ` : `${appendText} `
}

export function applySceneChatAssetReferences(options: {
  sceneId: string
  assetIds: string[]
  uniqueSorted: (values: string[]) => string[]
  resolveSceneReferenceAssetIds: (sceneId: string) => string[]
  setSceneAssetReferences: (sceneId: string, nextAssetIds: string[]) => void
}): { configChanged: boolean } {
  if (options.assetIds.length === 0) {
    return { configChanged: false }
  }

  const previousIds = options.resolveSceneReferenceAssetIds(options.sceneId)
  const merged = options.uniqueSorted([...previousIds, ...options.assetIds])
  options.setSceneAssetReferences(options.sceneId, merged)

  const nextIds = options.resolveSceneReferenceAssetIds(options.sceneId)
  const configChanged = previousIds.join('||') !== nextIds.join('||')
  return { configChanged }
}

export function syncSceneDescriptionWithChatAssetMentions(options: {
  scene: SceneData
  sceneId: string
  preferredAssetIds?: string[]
  uniqueSorted: (values: string[]) => string[]
  resolveAssetMentionTokenMap: () => Map<string, string>
  resolveSceneReferenceAssetIds: (sceneId: string) => string[]
  resolveSceneDescriptionWithoutAssetMentions: (raw?: string) => string
  buildSceneMentionDescription: (baseDescription: string, mentionTokens: string[]) => string
}): boolean {
  const tokenMap = options.resolveAssetMentionTokenMap()
  const mentionTokens = options.uniqueSorted([
    ...options.resolveSceneReferenceAssetIds(options.sceneId),
    ...(options.preferredAssetIds || [])
  ])
    .map(assetId => tokenMap.get(assetId) || '')
    .filter(Boolean)

  const nextDescription = options.buildSceneMentionDescription(
    options.resolveSceneDescriptionWithoutAssetMentions(options.scene.description || ''),
    mentionTokens
  )

  if ((options.scene.description || '') === nextDescription) return false
  options.scene.description = nextDescription
  return true
}

export function buildSceneChatSubmitPayload(options: {
  rawText: string
  composerAssetIds: string[]
  uniqueSorted: (values: string[]) => string[]
  mentionMap: Map<string, DisplayAsset>
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
}): SceneChatSubmitPayload | null {
  const text = options.rawText.trim()
  const composerAssetIds = options.uniqueSorted(options.composerAssetIds)
  if (!text && composerAssetIds.length === 0) return null

  const mentionAssetIds = extractAssetIdsFromSceneChatText(
    options.rawText,
    options.mentionMap
  )
  const relatedAssetIds = options.uniqueSorted([...composerAssetIds, ...mentionAssetIds])
  const relatedAssets = relatedAssetIds
    .map(options.resolveDisplayAssetById)
    .filter((asset): asset is DisplayAsset => !!asset)

  return {
    text,
    relatedAssetIds,
    relatedAssets,
    normalizedMessage: text || '请结合本次提及资产，优化该场景描述并保持剧情连续。',
    userVisibleMessage: text || '上传图片资产并执行场景二次修改'
  }
}

function buildSceneChatRewriteHistory(history: SceneChatMessage[]) {
  return history
    .filter(item => !!item.content?.trim())
    .slice(-8)
    .map(item => ({
      role: item.role,
      content: item.content.trim()
    }))
}

function buildSceneChatRewriteAssets(mentionedAssets: DisplayAsset[]) {
  return mentionedAssets.map(asset => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    description: asset.description,
    hasReferenceImage: !!asset.referenceImage
  }))
}

export async function requestSceneChatDescriptionRewrite(options: {
  scene: SceneData
  userMessage: string
  history: SceneChatMessage[]
  mentionedAssets: DisplayAsset[]
  workflowStylePrompt: string
  buildAssetWorkflowScenePayload: (scene: SceneData) => unknown
}): Promise<string> {
  const response = await $fetch<{
    success: boolean
    data?: { description?: string }
    error?: string
  }>('/api/asset-workflow/scene/description-refinement', {
    method: 'POST',
    body: {
      scene: options.buildAssetWorkflowScenePayload(options.scene),
      userMessage: options.userMessage,
      history: buildSceneChatRewriteHistory(options.history),
      mentionedAssets: buildSceneChatRewriteAssets(options.mentionedAssets),
      style: options.workflowStylePrompt
    }
  })

  if (!response.success || !response.data?.description?.trim()) {
    throw new Error(response.error || '模型未返回有效的场景描述')
  }

  return response.data.description.trim()
}
