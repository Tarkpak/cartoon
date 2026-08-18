<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { CharacterVoiceAsset } from '#shared/types/character'
import type { LibraryAsset } from '#shared/types/library'
import { libraryPermissionCanUse } from '#shared/types/library'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type {
  AutoStageKey,
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry,
  ArkVirtualAssetBinding,
  DisplayAsset,
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode,
  EnvironmentCropSelection,
  EnvironmentPanoramaState,
  FinalMergeOptions,
  QueueItem
} from '~/lib/asset-workbench-types'
import { createPropAssetId } from '~/lib/asset-workbench-types'
import {
  ensureAssetHistoryEntry,
  ensureVideoHistoryEntry
} from '~/lib/asset-history'
import {
  getValidAssetIdSet,
  resolveCharacterRefsFromScene
} from '~/lib/asset-workbench-reference-detection'
import {
  normalizeToken,
  uniqueSorted
} from '~/lib/asset-workbench-strings'
import {
  buildDefaultCropSelection,
  loadCropImageMetrics,
  normalizePanoramaSelectionForAspectRatio,
  resolveEnvironmentCropCaptureMode,
  renderPanoramaFourViewToDataUrl,
  renderPanoramaSelectionToDataUrl
} from '~/lib/asset-workbench-environment-panorama'
import {
  mergeEnvironmentReferenceViewImages,
  resolveEnvironmentReferenceImageByCaptureMode,
  resolveEnvironmentReferenceImageForScene,
  resolveEnvironmentViewImageForCard
} from '~/lib/asset-workbench-environment-views'
import {
  applyAutomaticAssetPlan as buildAutomaticAssetPlan
} from '~/lib/asset-workbench-auto-plan'
import {
  findCharacterByAssetRefId,
  isNarrationVoiceAsset
} from '~/lib/asset-workbench-scene-references'
import {
  invalidateSceneGenerationState,
  invalidateSceneVideoState
} from '~/lib/asset-workbench-scenes'
import {
  resolveEnvironmentAssetGenerationSetting,
  resolveSceneEnvironmentAssetId,
  resolveSceneEnvironmentAssetIdAliases
} from '~/lib/asset-workbench-environment'
import {
  AUTO_STAGE_HINTS,
  buildAutoStages
} from '~/lib/asset-workbench-progress'
import {
  buildSceneMentionDescription,
  extractSceneDescriptionMentionTokens,
  resolveSceneDescriptionWithoutAssetMentions
} from '~/lib/asset-workbench-mentions'
import {
  exportAssetWorkbenchJianyingProject,
  exportAssetWorkbenchScriptDocx
} from '~/lib/asset-workbench-api'
import {
  extractAssetIdsFromSceneChatText,
  resolveChatUploadAssetName
} from '~/lib/asset-workbench-scene-chat'
import {
  applySceneBaselineReference,
  type GenerateSceneBaselineOptions
} from '~/lib/asset-workbench-scene-generation'
import { uploadAssetImage, uploadImageFile } from '~/lib/asset-workbench-upload'
import {
  applyArkVirtualAssetBinding,
  getArkCredentialContext,
  getArkVirtualAsset
} from '~/lib/ark-virtual-assets'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
import {
  createLibraryAsset,
  listAllLibraryAssets,
  markLibraryAssetUsed,
  readRemoteLibraryMetadata,
  updateLibraryAsset
} from '~/lib/library-api'
import { resolveVideoWorkflowPreset } from '#shared/types/video-workflow'
import {
  getBrowserNotificationStatus,
  requestBrowserNotificationPermission
} from '~/composables/useGenerationCompletionNotification'

// 创作工作台页面
definePageMeta({
  layout: 'default',
  hideSidebar: true
})

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const {
  notifyGenerationCompleted,
  notifyGenerationFailed
} = useGenerationCompletionNotification()
const { resolveStyleById, loadStylePresets } = useStylePresets()
void loadStylePresets()

const MAX_ASSET_UPLOAD_SIZE = 20 * 1024 * 1024
const MAX_VOICE_UPLOAD_SIZE = 30 * 1024 * 1024
const ENVIRONMENT_REFERENCE_ASPECT_RATIO = '16:9' as const
const DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO = '2:1'
const PANORAMA_SOURCE_ASPECT_RATIO_BY_MODE: Record<string, string> = {
  equirectangular_360: '2:1',
  equirectangular_180: '1:1',
  cubemap_3x2: '3:2',
  cubemap_6x1: '6:1'
}
const supportsExplicitVoiceAudioReference = ref(false)
const environmentPanoramaSourceAspectRatio = ref(DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO)

function normalizeAspectRatioValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ratioMatch = value.trim().match(/^(\d+)\s*:\s*(\d+)$/)
  if (!ratioMatch?.[1] || !ratioMatch[2]) return null

  const width = Number(ratioMatch[1])
  const height = Number(ratioMatch[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return `${width}:${height}`
}

function resolvePanoramaSourceAspectRatio(options?: {
  panoramaSourceMode?: string | null
  panoramaCustomAspectRatio?: string | null
}): string {
  const mode = typeof options?.panoramaSourceMode === 'string'
    ? options.panoramaSourceMode
    : ''

  if (mode === 'custom') {
    return normalizeAspectRatioValue(options?.panoramaCustomAspectRatio)
      || DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO
  }

  return PANORAMA_SOURCE_ASPECT_RATIO_BY_MODE[mode]
    || DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO
}

async function refreshVideoAudioReferenceCapability() {
  try {
    const response = await $fetch<{
      success: boolean
      data?: {
        workflows?: Array<{
          id: string
          selectedModel?: string | null
          compatibleModels?: Array<{
            model: string
            provider: string
            supportAudioReference?: boolean
          }>
        }>
        modelOptions?: {
          image_options?: {
            panoramaSourceMode?: string | null
            panoramaCustomAspectRatio?: string | null
          }
        }
      }
    }>('/api/models/workflow')

    const workflows = response.data?.workflows || []
    const videoWorkflow = workflows.find(item => item.id === 'video_generation')
    const selectedModel = videoWorkflow?.selectedModel || ''
    const selectedModelConfig = videoWorkflow?.compatibleModels?.find(item => item.model === selectedModel)
    supportsExplicitVoiceAudioReference.value = selectedModelConfig?.supportAudioReference === true
    environmentPanoramaSourceAspectRatio.value = resolvePanoramaSourceAspectRatio(
      response.data?.modelOptions?.image_options
    )
  } catch (error) {
    console.warn('[asset-workbench] 读取视频模型能力失败，默认关闭显式音频引用标记:', error)
    supportsExplicitVoiceAudioReference.value = false
    environmentPanoramaSourceAspectRatio.value = DEFAULT_ENVIRONMENT_PANORAMA_SOURCE_ASPECT_RATIO
  }
}

onMounted(() => {
  void refreshVideoAudioReferenceCapability()
})

const {
  projectId,
  projectName,
  projectDescription,
  projectStyleId,
  projectAspectRatio,
  projectAssetWorkflow,
  scriptParseMode,
  selectedStyleId,
  novelText,
  scenes,
  characters,
  episodePlan,
  parsing,
  parseProgress,
  loading,
  saving,
  saveError,
  saveWarning,
  saveProject,
  loadProject,
  deleteScene,
  mergeWithNextScene,
  prepareEpisodePlan,
  parseScript,
  splitScene,
  updateScene,
  generateCharacter: generateCharacterCore,
  mergeAllVideos,
  mergeStatus,
  finalVideo
} = useAssetWorkbench()

const selectedSceneId = ref<string>('')
const lastArkBindingReconcileKey = ref('')

function buildArkBindingReconcileKey(project: string, credentialFingerprint: string) {
  const bindingSignature = characters.value
    .map(character => character.arkAsset)
    .filter(binding => !!binding?.assetId)
    .map(binding => `${binding?.assetId}:${binding?.credentialFingerprint || 'legacy'}:${binding?.status}`)
    .sort()
    .join('|')
  return `${project}:${credentialFingerprint}:${bindingSignature}`
}

async function reconcileArkBindingsForCurrentAccount() {
  const currentProjectId = projectId.value
  if (loading.value || !currentProjectId) return

  const bindings = characters.value
    .map(character => ({ character, binding: character.arkAsset }))
    .filter(item => !!item.binding?.assetId)
  if (bindings.length === 0) return

  let credentialFingerprint: string | undefined
  try {
    credentialFingerprint = (await getArkCredentialContext()).credentialFingerprint
  } catch (error) {
    console.warn('[asset-workbench] 读取 Ark 凭证上下文失败:', error)
    return
  }
  if (!credentialFingerprint) return

  const reconcileKey = buildArkBindingReconcileKey(currentProjectId, credentialFingerprint)
  if (lastArkBindingReconcileKey.value === reconcileKey) return
  lastArkBindingReconcileKey.value = reconcileKey

  const checks = new Map<string, Promise<ArkVirtualAssetBinding>>()
  let changed = false
  let staleCount = 0

  await Promise.all(bindings.map(async ({ character, binding }) => {
    if (!binding?.assetId) return
    if (binding.credentialFingerprint === credentialFingerprint && binding.status !== 'Stale') return

    const checkKey = `${binding.projectName}:${binding.assetId}`
    let check = checks.get(checkKey)
    if (!check) {
      check = getArkVirtualAsset({
        assetId: binding.assetId,
        projectName: binding.projectName,
        fallback: binding
      })
      checks.set(checkKey, check)
    }

    try {
      character.arkAsset = await check
      changed = true
    } catch {
      character.arkAsset = {
        ...binding,
        status: 'Stale',
        errorMessage: '当前火山账号无法访问此素材，请重新入库或选择新账号下的素材。',
        updatedAt: new Date().toISOString()
      }
      staleCount += 1
      changed = true
    }
  }))

  if (changed) {
    await saveProject().catch(error => {
      console.warn('[asset-workbench] 保存 Ark 素材账号检查结果失败:', error)
    })
  }
  lastArkBindingReconcileKey.value = buildArkBindingReconcileKey(
    currentProjectId,
    credentialFingerprint
  )
  if (staleCount > 0) {
    toast.warning(`检测到 ${staleCount} 个旧账号素材`, {
      description: '旧 asset ID 已停止用于生成；请在角色资产中重新入库或选择新素材。'
    })
  }
}

watch(
  [loading, projectId],
  () => {
    if (!loading.value) void reconcileArkBindingsForCurrentAccount()
  },
  { flush: 'post' }
)

function handleArkAccountWindowFocus() {
  void reconcileArkBindingsForCurrentAccount()
}

onMounted(() => window.addEventListener('focus', handleArkAccountWindowFocus))
onBeforeUnmount(() => window.removeEventListener('focus', handleArkAccountWindowFocus))

const sceneConfigs = ref<Record<string, SceneConsistencyConfig>>({})
const propAssets = ref<PropAsset[]>([])
const environmentMotherAssetSelections = ref<Record<string, string>>({})
const environmentAssetHistories = ref<Record<string, AssetImageHistoryEntry[]>>({})
const environmentPanoramaStates = ref<Record<string, EnvironmentPanoramaState>>({})
const environmentAssetGenerationStates = ref<Record<string, {
  status: EnvironmentAssetCard['referenceStatus']
  error?: string
}>>({})

const batchRunning = ref(false)
const queueItems = ref<QueueItem[]>([])
const sceneEditDialogOpen = ref(false)
const arkAssetSelectDialogOpen = ref(false)
const arkAssetSelectCharacterId = ref('')

async function refreshSceneVoiceAssets(input: {
  attempts?: number
  delayMs?: number
} = {}) {
  const id = projectId.value
  if (!id) return

  const attempts = Math.max(1, input.attempts ?? 1)
  const delayMs = Math.max(200, input.delayMs ?? 1000)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
    try {
      const response = await $fetch<{
        success: boolean
        data?: {
          script?: {
            assetWorkflow?: {
              props?: Array<{
                id?: string
                mediaType?: PropAsset['mediaType']
                voiceAsset?: CharacterVoiceAsset | null
              }>
            } | null
          } | null
          characters?: Array<{
            id: string
            voiceAsset?: CharacterVoiceAsset | null
          }>
        }
      }>(`/api/project/${id}`)
      if (!response.success || !response.data) return

      let changed = false
      const incomingCharacters = new Map(
        (response.data.characters || []).map(item => [item.id, item.voiceAsset || undefined])
      )
      for (const character of characters.value) {
        if (!incomingCharacters.has(character.id)) continue
        const nextVoiceAsset = incomingCharacters.get(character.id)
        if (JSON.stringify(character.voiceAsset || null) === JSON.stringify(nextVoiceAsset || null)) continue
        character.voiceAsset = nextVoiceAsset
        changed = true
      }

      const incomingProps = new Map(
        (response.data.script?.assetWorkflow?.props || [])
          .filter(prop => !!prop.id)
          .map(prop => [prop.id as string, prop])
      )
      for (const prop of propAssets.value) {
        const incoming = incomingProps.get(prop.id)
        if (!incoming) continue
        const nextVoiceAsset = incoming.voiceAsset || undefined
        if (JSON.stringify(prop.voiceAsset || null) === JSON.stringify(nextVoiceAsset || null)) continue
        prop.voiceAsset = nextVoiceAsset
        if (incoming.mediaType) prop.mediaType = incoming.mediaType
        changed = true
      }

      if (changed) return
    } catch (error) {
      console.warn('[asset-workbench] 刷新场景声音资产失败:', error)
      return
    }
  }
}

const arkAssetSelectCharacter = computed(() => {
  return characters.value.find(character => character.id === arkAssetSelectCharacterId.value)
})
const editingScene = ref<SceneData | null>(null)
const exportingScriptDocx = ref(false)
const exportingJianyingProject = ref(false)
const finalStageSceneOrder = ref<string[]>([])
const finalStageMergeOptions = ref<FinalMergeOptions>({
  transitionType: 'none',
  transitionDuration: 0.5,
  addSubtitles: false,
  bgmUrl: '',
  bgmVolume: 0.3,
  audioTracks: []
})

const {
  selectedScene,
  environmentAssetCards,
  environmentAssets,
  allAssets,
  workflowStylePrompt,
  queueSummary,
  assetsReady,
  characterReadyCount,
  characterGeneratingCount,
  characterMissingCount,
  resolveDisplayAssetTypeLabel,
  resolveEnvironmentSceneSummary,
  resolveSceneReferenceImage,
  resolveAssetMentionTokenMap,
  resolveAssetByMentionTokenMap,
  resolveSceneDescriptionSecondaryMentionItems,
  resolveSceneDescriptionRenderSegments,
  resolveSceneVoiceReferenceSummary,
  resolveDisplayAssetById,
  synchronizeQueueItems,
  isSceneBusy,
  isScenePreparing,
  resolveSceneVideoBadge,
  resolveEnvironmentCard,
  resolveEnvironmentRepresentativeScene,
  hasEnvironmentRepresentativeScene
} = useAssetWorkbenchPageState({
  scenes,
  characters,
  episodePlan,
  propAssets,
  environmentAssetHistories,
  environmentPanoramaStates,
  sceneConfigs,
  selectedSceneId,
  selectedStyleId,
  projectStyleId,
  scriptParseMode,
  supportsExplicitVoiceAudioReference,
  queueItems,
  resolveStyleById,
  resolveSceneDescriptionWithoutAssetMentions,
  uniqueSorted
})

const displayEnvironmentAssetCards = computed<EnvironmentAssetCard[]>(() => {
  return environmentAssetCards.value.map((asset) => {
    const state = environmentAssetGenerationStates.value[asset.id]
    if (!state) return asset

    return {
      ...asset,
      referenceStatus: state.status,
      referenceError: state.error || asset.referenceError
    }
  })
})

function setEnvironmentAssetGenerationState(
  assetId: string,
  state: {
    status: EnvironmentAssetCard['referenceStatus']
    error?: string
  } | null
) {
  if (!state) {
    environmentAssetGenerationStates.value = Object.fromEntries(
      Object.entries(environmentAssetGenerationStates.value).filter(([id]) => id !== assetId)
    )
    return
  }

  environmentAssetGenerationStates.value = {
    ...environmentAssetGenerationStates.value,
    [assetId]: state
  }
}

function resolveEnvironmentAssetReferenceImage(assetId: string): string | undefined {
  return resolveEnvironmentPanoramaState(assetId)?.panoramaImage?.trim()
    || resolveEnvironmentCard(assetId)?.panoramaImage?.trim()
    || resolveEnvironmentCard(assetId)?.referenceImage?.trim()
    || undefined
}

function resolveEnvironmentMotherCandidates(asset: EnvironmentAssetCard): Array<{ id: string, label: string }> {
  return displayEnvironmentAssetCards.value
    .filter(item => item.id !== asset.id)
    .map(item => ({
      id: item.id,
      label: item.name,
      image: resolveEnvironmentAssetReferenceImage(item.id)
    }))
    .filter(item => !!item.image)
    .map(({ id, label }) => ({ id, label }))
}

function resolveEnvironmentSelectedMotherId(assetId: string): string | undefined {
  const selectedId = environmentMotherAssetSelections.value[assetId]?.trim() || ''
  if (!selectedId) return undefined
  if (!resolveEnvironmentAssetReferenceImage(selectedId)) return undefined
  return selectedId
}

function resolveEnvironmentSelectedMotherReferenceImage(assetId: string): string | undefined {
  const selectedId = resolveEnvironmentSelectedMotherId(assetId)
  if (!selectedId) return undefined
  return resolveEnvironmentAssetReferenceImage(selectedId)
}

const sceneEnvironmentAssetOptions = computed<Array<{
  id: string
  label: string
  hasReference: boolean
  previewImage?: string
}>>(() => {
  return displayEnvironmentAssetCards.value.map(asset => ({
    id: asset.id,
    label: asset.name,
    hasReference: !!resolveEnvironmentAssetReferenceImage(asset.id),
    previewImage: resolveEnvironmentAssetReferenceImage(asset.id)
  }))
})

function resolveSceneEnvironmentReferenceAssetSelection(sceneId: string): string {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return '__auto__'

  const configuredAssetId = sceneConfigs.value[sceneId]?.environmentAssetId?.trim() || ''
  const configuredAsset = configuredAssetId
    ? resolveEnvironmentCard(configuredAssetId)
    : undefined
  if (configuredAsset) return configuredAsset.id

  const defaultAssetId = resolveSceneEnvironmentAssetId(scene)
  const defaultAsset = resolveEnvironmentCard(defaultAssetId)
  if (defaultAsset) return defaultAsset.id

  return '__auto__'
}

interface SceneNarrationVoiceOption {
  assetId: string
  name: string
  locked: boolean
  source: 'manual' | 'auto'
}

function resolveSceneNarrationVoiceOptions(scene: SceneData): SceneNarrationVoiceOption[] {
  if (!scene.narration?.trim()) return []

  return propAssets.value
    .filter(isNarrationVoiceAsset)
    .map((asset) => {
      const isAuto = !!asset.voiceAsset?.sourceSceneId || !!asset.voiceAsset?.sourceTaskId
      return {
        assetId: `prop:${asset.id}`,
        name: asset.name?.trim() || '旁白音色',
        locked: asset.voiceAsset?.locked === true,
        source: isAuto ? 'auto' as const : 'manual' as const
      }
    })
    .sort((left, right) => {
      if (left.locked !== right.locked) return left.locked ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN')
    })
}

function resolveSceneNarrationVoiceReferenceSelection(sceneId: string): string {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene?.narration?.trim()) return '__auto__'

  const options = resolveSceneNarrationVoiceOptions(scene)
  if (options.length === 0) return '__auto__'
  const optionIdSet = new Set(options.map(item => item.assetId))
  const configuredRefs = sceneConfigs.value[sceneId]?.mustReferenceAssetIds || []
  const explicitSelection = configuredRefs.find(assetId => optionIdSet.has(assetId))
  return explicitSelection || '__auto__'
}

function handleEnvironmentMotherSelection(payload: { assetId: string, motherAssetId: string }) {
  const assetId = payload.assetId?.trim() || ''
  if (!assetId) return

  const motherAssetId = payload.motherAssetId?.trim() || ''
  if (!motherAssetId) {
    const { [assetId]: _removed, ...remaining } = environmentMotherAssetSelections.value
    environmentMotherAssetSelections.value = remaining
    return
  }

  environmentMotherAssetSelections.value = {
    ...environmentMotherAssetSelections.value,
    [assetId]: motherAssetId
  }
}

const {
  workflowMetaReady,
  hydratingWorkflowMeta,
  loadWorkflowMeta,
  saveWorkflowMeta,
  scheduleWorkflowMetaSave
} = useAssetWorkflowMeta({
  projectId,
  projectAssetWorkflow,
  scenes,
  characters,
  sceneConfigs,
  propAssets,
  environmentMotherAssetSelections,
  environmentAssetHistories,
  environmentPanoramaStates,
  finalVideo,
  finalMergeOptions: finalStageMergeOptions,
  saveProject,
  onHydrated: () => {
    synchronizeSceneConfigs()
    synchronizeQueueItems()
  }
})

function synchronizeSceneDescriptionsWithAssetMentions(): boolean {
  const tokenMap = resolveAssetMentionTokenMap()
  const assetIdByToken = new Map(
    Array.from(tokenMap.entries()).map(([assetId, token]) => [token, assetId] as const)
  )
  let changed = false

  for (const scene of scenes.value) {
    const config = sceneConfigs.value[scene.id]
    if (!config) continue

    const configuredMentionTokens = uniqueSorted(config.mustReferenceAssetIds)
      .map(assetId => tokenMap.get(assetId) || '')
      .filter(Boolean)
    const configuredCharacterAssetIds = new Set(
      config.mustReferenceAssetIds.filter(assetId => assetId.startsWith('char:'))
    )
    const existingMentionTokens = extractSceneDescriptionMentionTokens(scene.description || '')
      .filter((token) => {
        const assetId = assetIdByToken.get(token)
        return !assetId?.startsWith('char:') || configuredCharacterAssetIds.has(assetId)
      })
    const mentionTokens = uniqueSorted([
      ...configuredMentionTokens,
      ...existingMentionTokens
    ])

    const nextDescription = buildSceneMentionDescription(
      scene.description || '',
      mentionTokens
    )

    if ((scene.description || '') !== nextDescription) {
      scene.description = nextDescription
      changed = true
    }
  }

  return changed
}

function normalizeWorkflowText(value: string): string {
  return value
    .replace(/首尾帧/g, '环境图')
    .replace(/首帧/g, '环境图')
    .replace(/尾帧/g, '环境图')
}

function resolveUiError(error: unknown, fallback: string): string {
  const message = getDisplayErrorMessage(error, fallback)
  return normalizeWorkflowText(message || fallback)
}

function recordCharacterHistory(
  characterId: string,
  image: string | undefined,
  options: {
    source: 'generated' | 'uploaded' | 'legacy'
    prompt?: string
    libraryAssetId?: string
    libraryAssetVersion?: number
  }
) {
  const character = characters.value.find(item => item.id === characterId)
  if (!character) return

  character.assetHistory = ensureAssetHistoryEntry(character.assetHistory, image, {
    source: options.source,
    prompt: options.prompt,
    libraryAssetId: options.libraryAssetId,
    libraryAssetVersion: options.libraryAssetVersion,
    createdAt: new Date().toISOString()
  })
}

function recordEnvironmentHistory(
  assetId: string,
  image: string,
  options: {
    source?: 'generated' | 'uploaded' | 'cropped' | 'legacy'
    prompt?: string
    viewMode?: EnvironmentCropCaptureMode
    libraryAssetId?: string
    libraryAssetVersion?: number
  } = {}
) {
  environmentAssetHistories.value = {
    ...environmentAssetHistories.value,
    [assetId]: ensureAssetHistoryEntry(environmentAssetHistories.value[assetId], image, {
      source: options.source,
      prompt: options.prompt,
      viewMode: options.viewMode,
      libraryAssetId: options.libraryAssetId,
      libraryAssetVersion: options.libraryAssetVersion,
      createdAt: new Date().toISOString()
    })
  }
}

function resolveEnvironmentPanoramaState(assetId: string): EnvironmentPanoramaState | undefined {
  return environmentPanoramaStates.value[assetId]
}

function resolveSceneEnvironmentReferenceAssetId(scene: SceneData): string {
  const configuredAssetId = sceneConfigs.value[scene.id]?.environmentAssetId?.trim() || ''
  if (configuredAssetId && resolveEnvironmentCard(configuredAssetId)) {
    return configuredAssetId
  }
  return resolveSceneEnvironmentAssetId(scene)
}

function resolveSceneEnvironmentReferenceAssetAliases(scene: SceneData): string[] {
  const configuredAssetId = sceneConfigs.value[scene.id]?.environmentAssetId?.trim() || ''
  if (configuredAssetId && resolveEnvironmentCard(configuredAssetId)) {
    return resolveEnvironmentPanoramaStateAliasKeys(configuredAssetId)
  }

  return resolveSceneEnvironmentAssetIdAliases(scene)
}

function resolveEnvironmentPanoramaStateAliasKeys(assetId: string): string[] {
  const keys = new Set<string>([assetId])
  const card = resolveEnvironmentCard(assetId)
  if (!card) return Array.from(keys)

  for (const sceneId of card.sceneIds) {
    const scene = scenes.value.find(item => item.id === sceneId)
    if (!scene) continue
    for (const alias of resolveSceneEnvironmentAssetIdAliases(scene)) {
      keys.add(alias)
    }
  }

  return Array.from(keys)
}

function resolveEnvironmentPanoramaStateForScene(scene: SceneData): EnvironmentPanoramaState | undefined {
  let panoramaImage: string | undefined
  let singleViewImage: string | undefined
  let fourViewImage: string | undefined
  let crop: EnvironmentCropSelection | undefined
  let captureMode: EnvironmentCropCaptureMode | undefined

  for (const alias of resolveSceneEnvironmentReferenceAssetAliases(scene)) {
    const state = environmentPanoramaStates.value[alias]
    if (!state) continue

    if (!panoramaImage && state.panoramaImage?.trim()) {
      panoramaImage = state.panoramaImage.trim()
    }
    if (!singleViewImage && state.singleViewImage?.trim()) {
      singleViewImage = state.singleViewImage.trim()
    }
    if (!fourViewImage && state.fourViewImage?.trim()) {
      fourViewImage = state.fourViewImage.trim()
    }
    if (!crop && state.crop) {
      crop = state.crop
    }
    if (state.captureMode === '四视角') {
      captureMode = '四视角'
    }
  }

  if (!panoramaImage && !singleViewImage && !fourViewImage && !crop && !captureMode) {
    return undefined
  }

  return {
    panoramaImage,
    singleViewImage,
    fourViewImage,
    crop,
    captureMode
  }
}

function resolveEnvironmentHistoryImageByView(
  asset: EnvironmentAssetCard | null | undefined,
  viewMode: EnvironmentCropCaptureMode
): string | undefined {
  if (!asset) return undefined
  return resolveEnvironmentViewImageForCard(asset, viewMode)
}

function setEnvironmentPanoramaState(
  assetId: string,
  state: EnvironmentPanoramaState | undefined
) {
  const aliasKeys = resolveEnvironmentPanoramaStateAliasKeys(assetId)
  const panoramaImage = state?.panoramaImage?.trim() || undefined
  const singleViewImage = state?.singleViewImage?.trim() || undefined
  const fourViewImage = state?.fourViewImage?.trim() || undefined
  const captureMode = state?.captureMode === '四视角' ? '四视角' : undefined
  const hasPayload = !!panoramaImage || !!singleViewImage || !!fourViewImage || !!state?.crop || !!captureMode
  const nextStates = { ...environmentPanoramaStates.value }

  if (!hasPayload) {
    const aliasSet = new Set(aliasKeys)
    const remainingEntries = Object.entries(nextStates)
      .filter(([key]) => !aliasSet.has(key))
    if (remainingEntries.length === Object.keys(nextStates).length) return
    environmentPanoramaStates.value = Object.fromEntries(remainingEntries)
    return
  }

  for (const key of aliasKeys) {
    nextStates[key] = {
      panoramaImage,
      singleViewImage,
      fourViewImage,
      crop: state?.crop,
      captureMode
    }
  }
  environmentPanoramaStates.value = nextStates
}

function buildEnvironmentCropUploadPrefix(assetId: string): string {
  const normalized = assetId
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(-48)
  return `env_crop_${normalized || 'asset'}`
}

function resolveSceneBaselineReferenceImage(scene: SceneData): string | undefined {
  const assetId = resolveSceneEnvironmentReferenceAssetId(scene)
  const environmentCard = resolveEnvironmentCard(assetId)
  const panoramaState = resolveEnvironmentPanoramaStateForScene(scene)
  const referenceState = {
    panoramaImage: panoramaState?.panoramaImage || environmentCard?.panoramaImage,
    captureMode: panoramaState?.captureMode || environmentCard?.captureMode,
    singleViewImage: panoramaState?.singleViewImage
      || environmentCard?.singleViewImage
      || resolveEnvironmentHistoryImageByView(environmentCard, '单视角'),
    fourViewImage: panoramaState?.fourViewImage
      || environmentCard?.fourViewImage
      || resolveEnvironmentHistoryImageByView(environmentCard, '四视角')
  }
  return resolveEnvironmentReferenceImageForScene(scene, referenceState)
    || resolveSceneReferenceImage(scene)
    || environmentCard?.referenceImage?.trim()
    || scene.firstFrame
}

function resolveSceneEnvironmentReferenceImageForMode(
  scene: SceneData,
  mode: EnvironmentCropCaptureMode
): string | undefined {
  const assetId = resolveSceneEnvironmentReferenceAssetId(scene)
  const environmentCard = resolveEnvironmentCard(assetId)
  const panoramaState = resolveEnvironmentPanoramaStateForScene(scene)
  const referenceState = {
    panoramaImage: panoramaState?.panoramaImage || environmentCard?.panoramaImage,
    captureMode: panoramaState?.captureMode || environmentCard?.captureMode,
    singleViewImage: panoramaState?.singleViewImage
      || environmentCard?.singleViewImage
      || resolveEnvironmentHistoryImageByView(environmentCard, '单视角'),
    fourViewImage: panoramaState?.fourViewImage
      || environmentCard?.fourViewImage
      || resolveEnvironmentHistoryImageByView(environmentCard, '四视角')
  }
  return resolveEnvironmentReferenceImageByCaptureMode(referenceState, mode)
    || resolveSceneReferenceImage(scene)
    || environmentCard?.referenceImage?.trim()
    || scene.firstFrame?.trim()
}

async function createEnvironmentCropImage(options: {
  assetId: string
  sourceImage: string
  crop?: EnvironmentCropSelection
  captureMode?: EnvironmentCropCaptureMode
  aspectRatio?: string
}) {
  const outputAspectRatio = options.aspectRatio || ENVIRONMENT_REFERENCE_ASPECT_RATIO
  const sourceAspectRatio = environmentPanoramaSourceAspectRatio.value
  const captureMode = resolveEnvironmentCropCaptureMode(options.captureMode)
  const metrics = await loadCropImageMetrics(options.sourceImage, {
    sourceAspectRatio
  })
  const fallbackCrop = options.crop || buildDefaultCropSelection({
    imageWidth: metrics.width,
    imageHeight: metrics.height,
    outputAspectRatio
  })
  const crop = normalizePanoramaSelectionForAspectRatio(
    fallbackCrop,
    metrics.width,
    metrics.height,
    outputAspectRatio
  )
  if (!crop) {
    throw new Error('取景区域无效，无法生成环境图')
  }
  const singleViewResult = await renderPanoramaSelectionToDataUrl({
    sourceImage: options.sourceImage,
    selection: crop,
    sourceAspectRatio,
    aspectRatio: outputAspectRatio
  })
  const fourViewResult = await renderPanoramaFourViewToDataUrl({
    sourceImage: options.sourceImage,
    selection: crop,
    sourceAspectRatio,
    aspectRatio: outputAspectRatio
  })
  const normalizedCrop = singleViewResult.crop
  const uploadPrefix = buildEnvironmentCropUploadPrefix(options.assetId)
  const singleViewImage = await uploadAssetImage(singleViewResult.imageData, `${uploadPrefix}_single`)
  const fourViewImage = await uploadAssetImage(fourViewResult.imageData, `${uploadPrefix}_four`)
  const imageUrl = captureMode === '四视角' ? fourViewImage : singleViewImage

  return {
    imageUrl,
    crop: normalizedCrop,
    captureMode,
    singleViewImage,
    fourViewImage
  }
}

async function applyEnvironmentReferenceImage(
  assetId: string,
  imageUrl: string,
  panoramaState?: EnvironmentPanoramaState
) {
  const environmentAsset = resolveEnvironmentCard(assetId)
  if (!environmentAsset) return

  for (const sceneId of environmentAsset.sceneIds) {
    const scene = scenes.value.find(item => item.id === sceneId)
    if (!scene) continue

    const sceneReferenceImage = resolveEnvironmentReferenceImageForScene(
      scene,
      panoramaState || resolveEnvironmentPanoramaState(assetId) || environmentAsset
    ) || imageUrl

    applySceneBaselineReference(scene, sceneReferenceImage)
  }

  if (panoramaState !== undefined) {
    setEnvironmentPanoramaState(assetId, panoramaState)
  }

  synchronizeQueueItems()
  await saveProject()
}

function recordPropHistory(
  propId: string,
  image: string | undefined,
  options: {
    source: 'generated' | 'uploaded' | 'legacy'
    prompt?: string
  }
) {
  const prop = propAssets.value.find(item => item.id === propId)
  if (!prop) return

  prop.assetHistory = ensureAssetHistoryEntry(prop.assetHistory, image, {
    source: options.source,
    prompt: options.prompt,
    createdAt: new Date().toISOString()
  })
}

function recordSceneVideoHistory(
  sceneId: string,
  videoUrl: string | undefined,
  options: {
    source?: 'generated' | 'legacy'
    prompt?: string
  } = {}
) {
  const scene = scenes.value.find(item => item.id === sceneId)
  if (!scene) return

  scene.videoHistory = ensureVideoHistoryEntry(scene.videoHistory, videoUrl, {
    source: options.source,
    prompt: options.prompt,
    createdAt: new Date().toISOString()
  })
}

async function generateCharacter(
  character: (typeof characters.value)[number],
  input?: {
    regenerationPrompt?: string
    referenceImage?: string
  },
  options: {
    persistHistory?: boolean
  } = {}
) {
  const previousImage = character.baseImage?.trim() || ''

  await generateCharacterCore(character, input)

  const currentCharacter = characters.value.find(item => item.id === character.id)
  const nextImage = currentCharacter?.baseImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  const saved = await saveProject()
  if (saved === false) {
    throw new Error(`角色 ${currentCharacter?.name || character.name} 图片已生成，但项目保存失败，请查看页面顶部的保存错误提示后重试`)
  }

  recordCharacterHistory(character.id, nextImage, {
    source: 'generated',
    prompt: input?.regenerationPrompt?.trim() || undefined
  })

  if (options.persistHistory !== false) {
    await saveWorkflowMeta()
  }

  const parentCharacter = character.parentCharacterId
    ? characters.value.find(item => item.id === character.parentCharacterId)
    : undefined
  if (parentCharacter?.arkAsset?.status === 'Active') {
    await ingestCharacterToArkVirtualAsset(character.id, { silent: true })
  }
}

async function batchGenerateCharacters(
  onProgress?: (current: number, total: number, name: string) => void
) {
  const pendingCharacters = characters.value.filter(character => !character.baseImage)
  const total = pendingCharacters.length

  if (total === 0) {
    return { success: true, generated: 0, failed: 0, total: 0 }
  }

  let generated = 0
  let failed = 0
  let historyChanged = false

  for (let index = 0; index < pendingCharacters.length; index += 1) {
    const character = pendingCharacters[index]
    if (!character) continue

    onProgress?.(index + 1, total, character.name)

    try {
      const previousImage = character.baseImage?.trim() || ''
      await generateCharacter(character, undefined, { persistHistory: false })
      if ((character.baseImage?.trim() || '') !== previousImage) {
        historyChanged = true
      }
      generated += 1
    } catch (error) {
      console.error(`[asset-workbench] 角色 ${character.name} 生成失败:`, error)
      failed += 1
    }
  }

  if (historyChanged) {
    await saveWorkflowMeta()
  }

  return { success: true, generated, failed, total }
}

const {
  editingCharacterId,
  characterEditDraft,
  characterRegenerateDialogOpen,
  characterRegeneratePrompt,
  characterRegenerateError,
  characterRegenerateTarget,
  characterVariantDialogOpen,
  characterVariantError,
  characterVariantSubmitting,
  characterVariantTarget,
  startEditCharacter,
  updateCharacterEditDraft,
  cancelEditCharacter,
  openCharacterVariantDialog,
  setCharacterVariantDialogOpen,
  submitCharacterVariant,
  removeCharacterVariant,
  handleGenerateCharacter,
  saveCharacterEdit,
  openCharacterRegenerateDialog,
  setCharacterRegenerateDialogOpen,
  setCharacterRegeneratePrompt,
  submitCharacterRegeneration
} = useAssetWorkbenchCharacterActions({
  characters,
  scenes,
  sceneConfigs,
  saveProject,
  saveWorkflowMeta,
  synchronizeQueueItems,
  generateCharacter,
  resolveUiError
})

const characterVariantDialogTitle = computed(() => {
  const targetName = characterVariantTarget.value?.name?.trim()
  return targetName ? `为 ${targetName} 添加变体` : '添加角色变体'
})

const {
  resolveCharacterSceneCount,
  resolvePropUsageCount,
  synchronizeSceneConfigs,
  ensureSceneConfig,
  resolveAssetName,
  resolveSceneReferenceAssetIds,
  setSceneAssetReferences,
  setScenePreviousLastFrameReference,
  setSceneEnvironmentCaptureMode,
  setSceneEnvironmentReferenceAsset,
  setSceneNarrationVoiceReference,
  selectScene,
  sceneEditAssetReferenceOptions,
  sceneEditSelectedAssetIds,
  openSceneEdit,
  handleSceneSave,
  handleSceneAssetReferencesSave,
  handleSplitScene,
  canMergeSceneByIndex,
  handleMergeWithNextScene,
  handleDeleteScene,
  addPropAsset,
  removePropAsset
} = useAssetWorkbenchSceneManagement({
  selectedSceneId,
  sceneEditDialogOpen,
  editingScene,
  scenes,
  characters,
  sceneConfigs,
  propAssets,
  allAssets,
  environmentAssets,
  uniqueSorted,
  normalizeToken,
  getValidAssetIdSet,
  findCharacterByAssetRefId,
  resolveSceneDescriptionWithoutAssetMentions,
  updateScene,
  deleteScene,
  splitScene,
  mergeWithNextScene,
  saveProject,
  saveWorkflowMeta,
  synchronizeQueueItems,
  createPropAssetId,
  isSceneBusy,
  resolveSceneBaselineReferenceImage,
  resolveSceneEnvironmentReferenceImageForMode
})

const {
  buildAssetWorkflowScenePayload,
  generateSceneBaseline,
  ensureCharacterAssetsReady,
  runBatchSceneGeneration,
  retryScene,
  retryFailedQueueItemsOnce
} = useAssetWorkbenchSceneGeneration({
  scenes,
  characters,
  sceneConfigs,
  propAssets,
  queueItems,
  batchRunning,
  workflowStylePrompt,
  projectId,
  projectAspectRatio,
  scriptParseMode,
  normalizeWorkflowText,
  resolveUiError,
  ensureSceneConfig,
  resolveAssetName,
  resolveSceneDescriptionWithoutAssetMentions,
  synchronizeQueueItems,
  saveProject,
  refreshCharacterVoiceAssets: refreshSceneVoiceAssets,
  generateCharacter,
  batchGenerateCharacters,
  persistAutomaticAssetPlan,
  recordEnvironmentHistory,
  resolveEnvironmentPanoramaState,
  setEnvironmentPanoramaState,
  createEnvironmentCropImage,
  resolveSceneBaselineReferenceImage,
  recordSceneVideoHistory,
  onModelTaskCompleted: notifyGenerationCompleted,
  onModelTaskFailed: notifyGenerationFailed
})

const lastAutoPlanSnapshotKey = ref('')

function buildAutoPlanSnapshotKey(): string {
  const sceneSnapshot = scenes.value.map(scene => ({
    id: scene.id,
    episodeId: scene.episodeId || '',
    episodeTitle: scene.episodeTitle || '',
    episodeIndex: typeof scene.episodeIndex === 'number' && Number.isFinite(scene.episodeIndex)
      ? scene.episodeIndex
      : null,
    title: scene.title || '',
    description: scene.description || '',
    narration: scene.narration || '',
    setting: {
      location: scene.setting?.location || '',
      timeOfDay: scene.setting?.timeOfDay || '',
      era: scene.setting?.era || '',
      mood: scene.setting?.mood || '',
      weather: scene.setting?.weather || ''
    },
    characters: scene.characters.map(character => ({
      name: character.name || '',
      assetId: character.assetId || '',
      appearance: character.appearance || '',
      emotion: character.emotion || ''
    })),
    props: (scene.props || []).map(prop => ({
      name: prop.name || '',
      description: prop.description || ''
    }))
  }))

  const characterSnapshot = characters.value.map(character => ({
    id: character.id,
    parentCharacterId: character.parentCharacterId || '',
    variantName: character.variantName || '',
    name: character.name || '',
    appearance: character.appearance || '',
    role: character.role || ''
  }))

  const propSnapshot = propAssets.value.map(prop => ({
    id: prop.id,
    name: prop.name || '',
    description: prop.description || '',
    category: prop.category || 'prop'
  }))

  const sceneConfigSnapshot = Object.entries(sceneConfigs.value)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId, 'zh-CN'))
    .map(([sceneId, config]) => ({
      sceneId,
      mustReferenceAssetIds: uniqueSorted(config.mustReferenceAssetIds || []),
      consistencyLevel: config.consistencyLevel,
      continuityNotes: config.continuityNotes?.trim() || '',
      environmentAssetId: config.environmentAssetId?.trim() || ''
    }))

  return JSON.stringify({
    sceneSnapshot,
    characterSnapshot,
    propSnapshot,
    sceneConfigSnapshot
  })
}

function normalizeEpisodeAssetMergeKey(value?: string): string {
  return (value || '').trim().toLowerCase().replace(/[\s\r\n\t]+/g, '')
}

const NARRATION_VOICE_ASSET_HINT_REGEX = /(旁白|画外音|voiceover|narration|旁白音色)/iu
const NARRATION_VOICE_PROFILE_REGEX = /(?:音色|声线)\s*[：:]\s*([^，。；;\n）)]+)/iu

function resolveNarrationVoiceDescriptionFromScenes(): string {
  for (const scene of scenes.value) {
    const narration = scene.narration?.trim() || ''
    if (!narration) continue

    const matchedProfile = narration.match(NARRATION_VOICE_PROFILE_REGEX)?.[1]?.trim() || ''
    if (matchedProfile) {
      return `音色基线：${matchedProfile}`
    }
  }

  return '保持旁白音色一致（可上传旁白参考音频）'
}

function resolveNarrationVoiceAsset(): PropAsset | undefined {
  return propAssets.value.find((asset) => {
    if (asset.category !== 'other') return false
    return NARRATION_VOICE_ASSET_HINT_REGEX.test(asset.name || '')
  })
}

function ensureNarrationVoiceAssetFromScenes(): { assetChanged: boolean, configChanged: boolean } {
  const narrationSceneIds = scenes.value
    .filter(scene => !!scene.narration?.trim())
    .map(scene => scene.id)
  if (narrationSceneIds.length === 0) {
    return { assetChanged: false, configChanged: false }
  }

  let assetChanged = false
  let configChanged = false
  let narrationAsset = resolveNarrationVoiceAsset()
  const narrationDescription = resolveNarrationVoiceDescriptionFromScenes()

  if (!narrationAsset) {
    narrationAsset = {
      id: createPropAssetId(),
      name: '旁白音色',
      description: narrationDescription,
      category: 'other',
      mediaType: 'voice'
    }
    propAssets.value.push(narrationAsset)
    assetChanged = true
  } else if (!narrationAsset.description?.trim() && narrationDescription) {
    narrationAsset.description = narrationDescription
    assetChanged = true
  }

  if (narrationAsset.mediaType !== 'voice') {
    narrationAsset.mediaType = 'voice'
    assetChanged = true
  }

  const narrationAssetRefId = `prop:${narrationAsset.id}`
  for (const sceneId of narrationSceneIds) {
    const config = ensureSceneConfig(sceneId)
    if (config.mustReferenceAssetIds.includes(narrationAssetRefId)) continue
    config.mustReferenceAssetIds = uniqueSorted([
      ...config.mustReferenceAssetIds,
      narrationAssetRefId
    ])
    configChanged = true
  }

  return { assetChanged, configChanged }
}

function mergePropAssetsFromEpisodePlan(): boolean {
  if (episodePlan.value.length === 0) return false

  const existingMap = new Map<string, PropAsset>()
  for (const asset of propAssets.value) {
    const key = normalizeEpisodeAssetMergeKey(asset.name)
    if (!key) continue
    existingMap.set(key, asset)
  }

  let changed = false
  for (const episode of episodePlan.value) {
    for (const item of episode.episodeAssets?.props || []) {
      const name = item.name?.trim() || ''
      if (!name) continue
      const key = normalizeEpisodeAssetMergeKey(name)
      if (!key) continue

      const description = item.description?.trim() || ''
      const existing = existingMap.get(key)
      if (existing) {
        if (description && (!existing.description || description.length > existing.description.length)) {
          existing.description = description
          changed = true
        }
        continue
      }

      const nextAsset: PropAsset = {
        id: createPropAssetId(),
        name,
        description,
        category: 'prop'
      }
      propAssets.value.push(nextAsset)
      existingMap.set(key, nextAsset)
      changed = true
    }
  }

  return changed
}

function clearParsedSceneStateForEpisodePlanChange(): boolean {
  const hasParsedSceneState = scenes.value.length > 0
    || queueItems.value.length > 0
    || Object.keys(sceneConfigs.value).length > 0
    || !!finalVideo.value?.videoUrl

  if (!hasParsedSceneState) return false

  scenes.value = []
  selectedSceneId.value = ''
  sceneConfigs.value = {}
  queueItems.value = []
  finalVideo.value = null
  lastAutoPlanSnapshotKey.value = ''
  return true
}

async function prepareEpisodePlanWithAssetHydration(): Promise<boolean> {
  const prepared = await prepareEpisodePlan()
  if (!prepared) return false

  const sceneStateCleared = clearParsedSceneStateForEpisodePlanChange()
  const propChanged = mergePropAssetsFromEpisodePlan()
  if (sceneStateCleared) {
    await saveProject()
  }
  if ((propChanged || sceneStateCleared) && workflowMetaReady.value && !hydratingWorkflowMeta.value) {
    await saveWorkflowMeta()
  }

  return true
}

function applyAutomaticAssetPlan(
  options: { overwriteExistingConfigs?: boolean } = {}
): { characterChanged: boolean, configChanged: boolean, generationInvalidated: boolean } {
  const previousConfigKeys = new Map(
    Object.entries(sceneConfigs.value).map(([sceneId, config]) => [
      sceneId,
      resolveSceneConfigGenerationKey(config)
    ])
  )
  const result = buildAutomaticAssetPlan({
    scenes: scenes.value,
    characters: characters.value,
    sceneConfigs: sceneConfigs.value,
    propAssets: propAssets.value,
    environmentAssetIds: environmentAssets.value.map(asset => asset.id),
    overwriteExistingConfigs: options.overwriteExistingConfigs,
    resolveSceneEnvironmentAssetId
  })

  let generationInvalidated = false
  if (result.configChanged) {
    sceneConfigs.value = result.nextSceneConfigs
    generationInvalidated = invalidateSceneGenerations(
      scenes.value
        .map(scene => scene.id)
        .filter((sceneId) => {
          return previousConfigKeys.get(sceneId)
            !== resolveSceneConfigGenerationKey(result.nextSceneConfigs[sceneId])
        })
    )
    synchronizeQueueItems()
  }

  return {
    characterChanged: result.characterChanged,
    configChanged: result.configChanged,
    generationInvalidated
  }
}

async function persistAutomaticAssetPlan(
  options: { overwriteExistingConfigs?: boolean } = {}
) {
  const forceRefresh = options.overwriteExistingConfigs === true
  const snapshotKeyBefore = buildAutoPlanSnapshotKey()
  if (!forceRefresh && snapshotKeyBefore === lastAutoPlanSnapshotKey.value) {
    return {
      characterChanged: false,
      configChanged: false,
      generationInvalidated: false,
      descriptionMentionChanged: false,
      skipped: true
    }
  }

  const autoPlanResult = applyAutomaticAssetPlan(options)
  const narrationVoiceAssetSyncResult = ensureNarrationVoiceAssetFromScenes()
  const descriptionMentionChanged = synchronizeSceneDescriptionsWithAssetMentions()

  if (
    autoPlanResult.characterChanged
    || autoPlanResult.generationInvalidated
    || narrationVoiceAssetSyncResult.assetChanged
    || descriptionMentionChanged
  ) {
    await saveProject()
  }
  if (autoPlanResult.configChanged || narrationVoiceAssetSyncResult.configChanged || narrationVoiceAssetSyncResult.assetChanged) {
    await saveWorkflowMeta()
  }

  lastAutoPlanSnapshotKey.value = buildAutoPlanSnapshotKey()

  return {
    characterChanged: autoPlanResult.characterChanged,
    configChanged: autoPlanResult.configChanged || narrationVoiceAssetSyncResult.configChanged || narrationVoiceAssetSyncResult.assetChanged,
    generationInvalidated: autoPlanResult.generationInvalidated,
    descriptionMentionChanged,
    skipped: false
  }
}

interface CharacterDependencySnapshot {
  id: string
  name: string
  baseImage: string
}

interface PropDependencySnapshot {
  id: string
  name: string
  referenceImage: string
}

function resolveSceneConfigGenerationKey(config?: SceneConsistencyConfig): string {
  return JSON.stringify({
    mustReferenceAssetIds: uniqueSorted(config?.mustReferenceAssetIds || []),
    continuityNotes: config?.continuityNotes?.trim() || '',
    environmentAssetId: config?.environmentAssetId?.trim() || '',
    usePreviousLastFrameAsFirstFrame: config?.usePreviousLastFrameAsFirstFrame === true
  })
}

function resolveScenePreviousLastFrameReferenceEnabled(sceneId: string): boolean {
  return sceneConfigs.value[sceneId]?.usePreviousLastFrameAsFirstFrame === true
}

function resolveSceneContinuityLinkReason(sceneId: string): string {
  return sceneConfigs.value[sceneId]?.continuityLinkReason?.trim() || ''
}

function canUsePreviousLastFrameReference(sceneId: string): boolean {
  const index = scenes.value.findIndex(scene => scene.id === sceneId)
  if (index <= 0) return false
  const scene = scenes.value[index]
  const previous = scenes.value[index - 1]
  if (!scene || !previous) return false
  const currentEpisodeId = scene.episodeId?.trim() || ''
  const previousEpisodeId = previous.episodeId?.trim() || ''
  if (currentEpisodeId && previousEpisodeId && currentEpisodeId !== previousEpisodeId) return false
  return !!previous.lastFrame?.trim()
}

function resolveScenesReferencingAsset(assetId: string): string[] {
  return scenes.value
    .filter((scene) => {
      const refs = sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
      return refs.includes(assetId)
    })
    .map(scene => scene.id)
}

function resolveCharacterDependentSceneIds(characterId: string): string[] {
  const targetRef = `char:${characterId}`
  const dependentSceneIds = new Set<string>()

  for (const scene of scenes.value) {
    const configuredRefs = sceneConfigs.value[scene.id]?.mustReferenceAssetIds || []
    if (configuredRefs.includes(targetRef)) {
      dependentSceneIds.add(scene.id)
      continue
    }

    const { refs } = resolveCharacterRefsFromScene({
      scene,
      characters: characters.value
    })
    if (refs.includes(targetRef)) {
      dependentSceneIds.add(scene.id)
    }
  }

  return Array.from(dependentSceneIds)
}

function invalidateSceneGenerations(sceneIds: string[]): boolean {
  const targetIds = new Set(sceneIds)
  let changed = false

  for (const scene of scenes.value) {
    if (!targetIds.has(scene.id)) continue
    changed = invalidateSceneGenerationState(scene) || changed
  }

  return changed
}

function invalidateSceneVideos(sceneIds: string[]): boolean {
  const targetIds = new Set(sceneIds)
  let changed = false

  for (const scene of scenes.value) {
    if (!targetIds.has(scene.id)) continue
    changed = invalidateSceneVideoState(scene) || changed
  }

  return changed
}

function buildCharacterDependencySnapshot(): CharacterDependencySnapshot[] {
  return characters.value.map(character => ({
    id: character.id,
    name: character.name.trim(),
    baseImage: character.baseImage?.trim() || ''
  }))
}

function buildPropDependencySnapshot(): PropDependencySnapshot[] {
  return propAssets.value.map(prop => ({
    id: prop.id,
    name: prop.name.trim(),
    referenceImage: prop.referenceImage?.trim() || ''
  }))
}

async function ensurePropAssetsReady() {
  const missingProps = propAssets.value.filter(prop => prop.category !== 'other' && !prop.referenceImage?.trim())
  if (missingProps.length === 0) return

  const failedNames: string[] = []
  let generatedCount = 0
  for (const prop of missingProps) {
    const beforeImage = prop.referenceImage?.trim() || ''
    await handleGeneratePropImage(prop.id, {
      skipCompletionNotice: true
    })
    const afterImage = propAssets.value.find(item => item.id === prop.id)?.referenceImage?.trim() || ''
    if (!afterImage || afterImage === beforeImage) {
      failedNames.push(prop.name || prop.id)
      continue
    }
    generatedCount += 1
  }

  if (generatedCount > 0) {
    await notifyGenerationCompleted({
      title: '道具图批量生成完成',
      body: `成功 ${generatedCount} / ${missingProps.length}${failedNames.length > 0 ? `，失败 ${failedNames.length}` : ''}`
    })
  }

  if (failedNames.length > 0) {
    await notifyGenerationFailed({
      title: '道具图批量生成失败',
      body: `成功 ${generatedCount} / ${missingProps.length}，失败 ${failedNames.length}`
    })
    throw new Error(`道具图生成失败：${failedNames.slice(0, 3).join('、')}${failedNames.length > 3 ? ' 等' : ''}`)
  }
}

const finalStageScenes = computed(() => {
  return scenes.value
    .filter(scene => scene.videoStatus === 'done' && !!scene.videoUrl)
    .map(scene => ({
      id: scene.id,
      title: scene.title,
      duration: scene.duration,
      videoUrl: scene.videoUrl,
      videoStatus: scene.videoStatus
    }))
})

const finalStageSceneIds = computed(() => finalStageScenes.value.map(scene => scene.id))

function normalizeFinalStageSceneOrder(nextSceneIds: string[]) {
  const validIdSet = new Set(nextSceneIds)
  const normalized = finalStageSceneOrder.value.filter(sceneId => validIdSet.has(sceneId))

  for (const sceneId of nextSceneIds) {
    if (normalized.includes(sceneId)) continue
    normalized.push(sceneId)
  }

  finalStageSceneOrder.value = normalized
}

watch(
  finalStageSceneIds,
  (nextSceneIds) => {
    normalizeFinalStageSceneOrder(nextSceneIds)
  },
  { immediate: true }
)

function handleFinalStageSceneOrderUpdate(nextSceneIds: string[]) {
  const validIdSet = new Set(finalStageSceneIds.value)
  const normalized = nextSceneIds.filter(sceneId => validIdSet.has(sceneId))
  for (const sceneId of finalStageSceneIds.value) {
    if (normalized.includes(sceneId)) continue
    normalized.push(sceneId)
  }
  finalStageSceneOrder.value = normalized
}

function handleFinalStageMergeOptionsUpdate(payload: Partial<FinalMergeOptions>) {
  const next: FinalMergeOptions = {
    ...finalStageMergeOptions.value,
    ...payload
  }

  if (next.transitionType !== 'fade' && next.transitionType !== 'dissolve' && next.transitionType !== 'wipe') {
    next.transitionType = 'none'
  }

  const transitionDuration = Number(next.transitionDuration)
  next.transitionDuration = Number.isFinite(transitionDuration)
    ? Math.max(0.1, Math.min(2, transitionDuration))
    : 0.5

  next.addSubtitles = next.addSubtitles === true
  next.bgmUrl = typeof next.bgmUrl === 'string' ? next.bgmUrl : ''

  const bgmVolume = Number(next.bgmVolume)
  next.bgmVolume = Number.isFinite(bgmVolume)
    ? Math.max(0, Math.min(1, bgmVolume))
    : 0.3

  next.audioTracks = (next.audioTracks || []).map(track => ({
    ...track,
    startTime: Math.max(0, Number(track.startTime) || 0),
    duration: Number.isFinite(Number(track.duration)) ? Math.max(0.1, Number(track.duration)) : undefined,
    volume: Math.max(0, Math.min(1, Number(track.volume) || 0))
  }))

  finalStageMergeOptions.value = next
  scheduleWorkflowMetaSave()
}

const {
  autoRunning,
  autoRunError,
  autoRunCurrentStage,
  activeAutoStage,
  selectAutoStage,
  runSimpleFinalStep
} = useAssetWorkbenchAutoFlow({
  route,
  router,
  projectId,
  projectAssetWorkflow,
  selectedStyleId,
  projectStyleId,
  selectedSceneId,
  scenes,
  queueSummary,
  assetsReady,
  finalVideo,
  resolveUiError,
  mergeAllVideos,
  loadProject,
  loadWorkflowMeta,
  saveWorkflowMeta,
  persistAutomaticAssetPlan,
  synchronizeSceneConfigs,
  synchronizeQueueItems,
  ensureCharacterAssetsReady,
  ensurePropAssetsReady,
  runBatchSceneGeneration,
  retryFailedQueueItemsOnce
})

async function handleRunFinalStage(payload?: FinalMergeOptions) {
  const nextOptions: FinalMergeOptions = {
    ...finalStageMergeOptions.value,
    ...payload,
    sceneOrder: finalStageSceneOrder.value
  }
  await runSimpleFinalStep(nextOptions)
}

async function clearEpisodePlan() {
  episodePlan.value = []
  const sceneStateCleared = clearParsedSceneStateForEpisodePlanChange()
  await saveProject()
  if (sceneStateCleared && workflowMetaReady.value && !hydratingWorkflowMeta.value) {
    await saveWorkflowMeta()
  }
}

async function handlePrepareEpisodePlan() {
  if (!novelText.value.trim()) {
    toast.warning('请先输入剧本原文')
    return
  }
  const notificationStatus = getBrowserNotificationStatus()
  if (notificationStatus.supported && notificationStatus.secureContext && notificationStatus.canPrompt) {
    try {
      await requestBrowserNotificationPermission()
    } catch (error) {
      console.warn('[asset-workbench] 申请系统通知权限失败:', error)
    }
  }
  const prepared = await prepareEpisodePlanWithAssetHydration()
  if (!prepared) return

  if (scriptParseMode.value === 'origin_explainer') {
    const episodeId = episodePlan.value[0]?.id?.trim()
    if (!episodeId) {
      selectAutoStage('parse')
      return
    }

    await handleParseSingleEpisode({ id: episodeId })
    selectAutoStage(scenes.value.length > 0 ? 'assets' : 'parse')
    return
  }

  selectAutoStage('assets')
}

async function handleParseSingleEpisode(payload: { id: string }) {
  if (!novelText.value.trim()) {
    toast.warning('请先输入剧本原文')
    return
  }

  const episodeId = payload.id?.trim()
  if (!episodeId) {
    toast.warning('请选择要解析的分集')
    return
  }

  try {
    const parsed = await parseScript({
      style: workflowStylePrompt.value,
      scriptParseMode: scriptParseMode.value,
      descriptionFormat: 'timeline',
      targetEpisodeId: episodeId
    })

    if (!parsed) {
      throw new Error(parseProgress.value.message || '本集解析失败，请稍后重试')
    }

    await persistAutomaticAssetPlan()
    synchronizeSceneConfigs()
    synchronizeQueueItems()
  } catch (error) {
    const message = resolveUiError(error, '本集解析失败，请稍后重试')
    parseProgress.value = {
      ...parseProgress.value,
      active: false,
      step: 'error',
      message
    }
    throw new Error(message)
  }
}

const autoStages = computed(() => {
  const videosDone = queueSummary.value.total > 0
    && queueSummary.value.done === queueSummary.value.total
  const workflowPreset = resolveVideoWorkflowPreset(scriptParseMode.value)

  return buildAutoStages({
    hasScenes: scenes.value.length > 0,
    assetsReady: assetsReady.value,
    videosDone,
    finalDone: !!finalVideo.value?.videoUrl,
    autoRunning: autoRunning.value,
    autoRunCurrentStage: autoRunCurrentStage.value,
    parseLabel: workflowPreset.id === 'origin_explainer' ? '镜头规划' : undefined
  })
})

const stageHints = AUTO_STAGE_HINTS
const parseStageHint = computed(() => {
  if (parsing.value) {
    return ''
  }
  if (scriptParseMode.value === 'origin_explainer') {
    return '输入科普主题后生成镜头规划入口，再按主题拆解为多镜头场景。'
  }
  return stageHints.parse
})
const EPISODE_OVERVIEW_TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]\s*/u
const EPISODE_OVERVIEW_STRUCTURED_HEADING_REGEX = /^(?:场景功能\/情绪定位|场景功能|情绪定位|镜头设计|声音设计|台词节奏|表演关键点|Scene function \/ emotional beat|Shot design|Sound design|Dialogue rhythm|Performance notes)\s*[：:]?\s*$/u
const EPISODE_OVERVIEW_MAX_LENGTH = 180

function resolveSceneDescriptionOverviewText(description: string): string {
  const lines = description
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return ''

  const timelineLines = lines
    .filter(line => EPISODE_OVERVIEW_TIMELINE_PREFIX_REGEX.test(line))
    .map(line => line.replace(EPISODE_OVERVIEW_TIMELINE_PREFIX_REGEX, '').trim())
    .filter(Boolean)

  if (timelineLines.length > 0) {
    return timelineLines.slice(0, 2).join(' ')
  }

  return lines
    .filter(line => !EPISODE_OVERVIEW_STRUCTURED_HEADING_REGEX.test(line))
    .slice(0, 2)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clipEpisodeOverviewText(text: string): string {
  if (text.length <= EPISODE_OVERVIEW_MAX_LENGTH) return text
  return `${text.slice(0, EPISODE_OVERVIEW_MAX_LENGTH).trim()}...`
}

const episodeOverviewById = computed<Record<string, string>>(() => {
  if (episodePlan.value.length === 0 || scenes.value.length === 0) return {}

  const overviewMap: Record<string, string> = {}
  for (const episode of episodePlan.value) {
    const episodeScenes = scenes.value.filter((scene) => {
      return (scene.episodeId?.trim() || '') === episode.id
    })
    if (episodeScenes.length === 0) continue

    const sceneSummaryParts = episodeScenes
      .map((scene) => {
        const descriptionSummary = resolveSceneDescriptionOverviewText(scene.description || '')
        const sceneTitle = scene.title?.trim() || ''
        if (sceneTitle && descriptionSummary) {
          return descriptionSummary.startsWith(sceneTitle)
            ? descriptionSummary
            : `${sceneTitle}：${descriptionSummary}`
        }
        return sceneTitle || descriptionSummary
      })
      .filter(Boolean)
      .slice(0, 3)

    if (sceneSummaryParts.length === 0) continue
    overviewMap[episode.id] = clipEpisodeOverviewText(sceneSummaryParts.join('；'))
  }

  return overviewMap
})
const NOVEL_TEXT_AUTO_SAVE_DELAY_MS = 1200
const lastSavedNovelText = ref('')
const pendingWorkflowMetaSaveAfterNovelTextChange = ref(false)
const canResetEpisodePlanFromNovelText = ref(false)
let novelTextAutoSaveTimer: ReturnType<typeof setTimeout> | null = null

function clearNovelTextAutoSaveTimer() {
  if (!novelTextAutoSaveTimer) return
  clearTimeout(novelTextAutoSaveTimer)
  novelTextAutoSaveTimer = null
}

async function persistNovelTextIfNeeded() {
  if (loading.value || saving.value) return
  if (!projectId.value && !projectStyleId.value) return
  if (
    novelText.value === lastSavedNovelText.value
    && !pendingWorkflowMetaSaveAfterNovelTextChange.value
  ) return

  const saved = await saveProject()
  if (saved) {
    lastSavedNovelText.value = novelText.value
    if (
      pendingWorkflowMetaSaveAfterNovelTextChange.value
      && workflowMetaReady.value
      && !hydratingWorkflowMeta.value
    ) {
      await saveWorkflowMeta()
    }
    pendingWorkflowMetaSaveAfterNovelTextChange.value = false
  }
}

function scheduleNovelTextAutoSave() {
  clearNovelTextAutoSaveTimer()
  novelTextAutoSaveTimer = setTimeout(() => {
    novelTextAutoSaveTimer = null
    void persistNovelTextIfNeeded()
  }, NOVEL_TEXT_AUTO_SAVE_DELAY_MS)
}

async function waitUntilProjectSaveIdle(maxWaitMs = 3000) {
  const deadline = Date.now() + maxWaitMs
  while (saving.value && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 80))
  }
}

function openCharacterArkAssetSelect(character: CharacterData) {
  arkAssetSelectCharacterId.value = character.id
  arkAssetSelectDialogOpen.value = true
}

async function handleCharacterArkAssetSelect(asset: ArkVirtualAssetBinding) {
  const target = arkAssetSelectCharacter.value
  if (!target) return

  const previousArkAsset = target.arkAsset
  const previousBaseImage = target.baseImage
  applyArkVirtualAssetBinding(target, asset)

  try {
    await saveProject()
    toast.success('已绑定火山虚拟人像素材', {
      description: asset.assetId ? `asset://${asset.assetId}` : undefined
    })
  } catch (error) {
    target.arkAsset = previousArkAsset
    target.baseImage = previousBaseImage
    toast.error('绑定火山素材失败', {
      description: getDisplayErrorMessage(error, '保存项目失败')
    })
  }
}

const {
  imagePreviewOpen,
  imagePreviewSrc,
  imagePreviewAlt,
  environmentRegenerateDialogOpen,
  environmentRegeneratePrompt,
  environmentRegenerateError,
  environmentRegenerateTarget,
  uploadingCharacterId,
  uploadingArkCharacterId,
  uploadingCharacterVoiceId,
  uploadingEnvironmentAssetId,
  uploadingPropId,
  uploadingPropVoiceId,
  generatingPropId,
  openImagePreview,
  handleCharacterImageUpload: handleCharacterImageUploadCore,
  ingestCharacterToArkVirtualAsset,
  handleCharacterVoiceUpload,
  handleCharacterVoiceLockChange,
  handleEnvironmentImageUpload: handleEnvironmentImageUploadCore,
  handlePropImageUpload: handlePropImageUploadCore,
  handlePropVoiceUpload,
  handlePropVoiceLockChange,
  generatePropImage: generatePropImageCore,
  openEnvironmentRegenerateDialog,
  setEnvironmentRegenerateDialogOpen,
  setEnvironmentRegeneratePrompt,
  submitEnvironmentRegeneration: submitEnvironmentRegenerationCore
} = useAssetWorkbenchAssetMedia({
  maxAssetUploadSize: MAX_ASSET_UPLOAD_SIZE,
  maxVoiceUploadSize: MAX_VOICE_UPLOAD_SIZE,
  statusError: autoRunError,
  scenes,
  characters,
  propAssets,
  projectId,
  projectName,
  workflowStylePrompt,
  saveProject,
  saveWorkflowMeta,
  resolveUiError,
  synchronizeQueueItems,
  resolveSceneReferenceImage,
  resolveEnvironmentCard,
  resolveEnvironmentRepresentativeScene,
  panoramaSourceAspectRatio: environmentPanoramaSourceAspectRatio,
  recordEnvironmentHistory,
  setEnvironmentPanoramaState,
  generateSceneBaseline,
  onModelTaskCompleted: notifyGenerationCompleted,
  onModelTaskFailed: notifyGenerationFailed
})

const environmentCropDialogOpen = ref(false)
const environmentCropTargetId = ref<string | null>(null)
const environmentCropRequestedCaptureMode = ref<EnvironmentCropCaptureMode | null>(null)
const environmentCropSaving = ref(false)
const environmentCropError = ref<string | null>(null)
const environmentRegenerateDialogLoading = computed(() => {
  const targetId = environmentRegenerateTarget.value?.id
  if (!targetId) return false

  const state = environmentAssetGenerationStates.value[targetId]
  if (state?.status === 'generating') return true

  return environmentRegenerateTarget.value?.referenceStatus === 'generating'
})

watch(environmentCropDialogOpen, (open) => {
  if (open) return
  environmentCropTargetId.value = null
  environmentCropRequestedCaptureMode.value = null
  environmentCropError.value = null
})

watch(
  [loading, workflowMetaReady, hydratingWorkflowMeta],
  ([isLoading, isMetaReady, isHydrating]) => {
    if (isLoading || !isMetaReady || isHydrating) {
      canResetEpisodePlanFromNovelText.value = false
      return
    }
    lastSavedNovelText.value = novelText.value
    canResetEpisodePlanFromNovelText.value = true
  },
  { immediate: true }
)

watch(novelText, (nextValue, previousValue) => {
  if (nextValue === previousValue) return
  if (!canResetEpisodePlanFromNovelText.value) return
  if (loading.value) return
  if (episodePlan.value.length > 0) {
    episodePlan.value = []
  }
  const sceneStateCleared = clearParsedSceneStateForEpisodePlanChange()
  if (sceneStateCleared) {
    pendingWorkflowMetaSaveAfterNovelTextChange.value = true
  }
  if (nextValue === lastSavedNovelText.value && !sceneStateCleared) return
  scheduleNovelTextAutoSave()
})

onBeforeRouteLeave(async () => {
  clearNovelTextAutoSaveTimer()
  await waitUntilProjectSaveIdle()
  await persistNovelTextIfNeeded()
  await waitUntilProjectSaveIdle()
  if (!loading.value) await saveProject()
})

const environmentCropTarget = computed(() => {
  if (!environmentCropTargetId.value) return null
  return resolveEnvironmentCard(environmentCropTargetId.value) || null
})

const environmentCropSourceImage = computed(() => {
  return environmentCropTarget.value?.panoramaImage?.trim()
    || environmentCropTarget.value?.referenceImage?.trim()
    || ''
})

const environmentCropInitialSelection = computed(() => {
  if (!environmentCropTarget.value) return undefined
  return resolveEnvironmentPanoramaState(environmentCropTarget.value.id)?.crop
    || environmentCropTarget.value.crop
})

const environmentCropInitialCaptureMode = computed<EnvironmentCropCaptureMode>(() => {
  if (environmentCropRequestedCaptureMode.value) {
    return resolveEnvironmentCropCaptureMode(environmentCropRequestedCaptureMode.value)
  }
  if (!environmentCropTarget.value) return '单视角'
  const captureMode = resolveEnvironmentPanoramaState(environmentCropTarget.value.id)?.captureMode
    || environmentCropTarget.value.captureMode
  return resolveEnvironmentCropCaptureMode(
    captureMode
  )
})

function openEnvironmentCropDialog(
  assetId: string,
  captureMode?: EnvironmentCropCaptureMode
) {
  const asset = resolveEnvironmentCard(assetId)
  if (!asset?.panoramaImage?.trim() && !asset?.referenceImage?.trim()) {
    toast.warning(`请先生成或上传 ${environmentPanoramaSourceAspectRatio.value} 的环境源图，再选择取景区域`)
    return
  }

  environmentCropTargetId.value = assetId
  environmentCropRequestedCaptureMode.value = captureMode || null
  environmentCropError.value = null
  environmentCropDialogOpen.value = true
}

function setEnvironmentCropDialogOpen(open: boolean) {
  environmentCropDialogOpen.value = open
  if (!open) {
    environmentCropTargetId.value = null
    environmentCropRequestedCaptureMode.value = null
    environmentCropError.value = null
  }
}

async function submitEnvironmentCropSelection(payload: {
  selection: EnvironmentCropSelection
  captureMode: EnvironmentCropCaptureMode
}) {
  const target = environmentCropTarget.value
  const sourceImage = environmentCropSourceImage.value
  if (!target || !sourceImage) {
    environmentCropError.value = `环境源图不存在，请先重新生成或上传 ${environmentPanoramaSourceAspectRatio.value} 全景图`
    return
  }

  environmentCropSaving.value = true
  environmentCropError.value = null

  try {
    const result = await createEnvironmentCropImage({
      assetId: target.id,
      sourceImage,
      crop: payload.selection,
      captureMode: payload.captureMode,
      aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO
    })

    const normalizedSingleViewImage = result.singleViewImage?.trim()
      || (result.captureMode === '单视角'
        ? (result.imageUrl?.trim() || undefined)
        : undefined)
    const normalizedFourViewImage = result.fourViewImage?.trim()
      || (result.captureMode === '四视角'
        ? (result.imageUrl?.trim() || undefined)
        : undefined)
    const latestPanoramaState = resolveEnvironmentPanoramaState(target.id)
    const previousSingleViewImage = latestPanoramaState?.singleViewImage?.trim()
      || target.singleViewImage?.trim()
      || resolveEnvironmentHistoryImageByView(target, '单视角')
      || undefined
    const previousFourViewImage = latestPanoramaState?.fourViewImage?.trim()
      || target.fourViewImage?.trim()
      || resolveEnvironmentHistoryImageByView(target, '四视角')
      || undefined
    const nextViewImages = mergeEnvironmentReferenceViewImages({
      previousSingleViewImage,
      previousFourViewImage,
      nextSingleViewImage: normalizedSingleViewImage,
      nextFourViewImage: normalizedFourViewImage,
      captureMode: result.captureMode
    })
    await applyEnvironmentReferenceImage(target.id, result.imageUrl, {
      panoramaImage: target.panoramaImage?.trim() || sourceImage,
      crop: result.crop,
      captureMode: result.captureMode,
      singleViewImage: nextViewImages.singleViewImage,
      fourViewImage: nextViewImages.fourViewImage
    })

    const selectedViewImage = result.captureMode === '四视角'
      ? (result.fourViewImage?.trim() || result.imageUrl?.trim() || '')
      : (result.singleViewImage?.trim() || result.imageUrl?.trim() || '')

    if (selectedViewImage) {
      recordEnvironmentHistory(target.id, selectedViewImage, {
        source: 'cropped',
        viewMode: result.captureMode
      })
    }
    await saveWorkflowMeta()
    setEnvironmentCropDialogOpen(false)
  } catch (error) {
    environmentCropError.value = resolveUiError(error, '环境取景区域保存失败')
  } finally {
    environmentCropSaving.value = false
  }
}

type AssetHistoryTarget
  = | { type: 'character', id: string }
    | { type: 'environment', id: string }
    | { type: 'prop', id: string }

type SceneVideoHistoryTarget = { sceneId: string }

const assetHistoryDialogOpen = ref(false)
const assetHistoryTarget = ref<AssetHistoryTarget | null>(null)
const assetHistoryApplying = ref(false)
const sceneVideoHistoryDialogOpen = ref(false)
const sceneVideoHistoryTarget = ref<SceneVideoHistoryTarget | null>(null)
const sceneVideoHistoryApplying = ref(false)

const assetHistoryDialogTitle = computed(() => {
  if (assetHistoryTarget.value?.type === 'character') return '角色资产历史'
  if (assetHistoryTarget.value?.type === 'environment') return '环境资产历史'
  if (assetHistoryTarget.value?.type === 'prop') return '道具资产历史'
  return '资产历史'
})

const assetHistoryTargetType = computed(() => assetHistoryTarget.value?.type || null)

const assetHistoryTargetLabel = computed(() => {
  if (!assetHistoryTarget.value) return ''

  if (assetHistoryTarget.value.type === 'character') {
    return characters.value.find(item => item.id === assetHistoryTarget.value?.id)?.name || ''
  }

  if (assetHistoryTarget.value.type === 'environment') {
    return resolveEnvironmentCard(assetHistoryTarget.value.id)?.name || ''
  }

  return propAssets.value.find(item => item.id === assetHistoryTarget.value?.id)?.name || ''
})

const assetHistoryCurrentImage = computed(() => {
  if (!assetHistoryTarget.value) return ''

  if (assetHistoryTarget.value.type === 'character') {
    return characters.value.find(item => item.id === assetHistoryTarget.value?.id)?.baseImage || ''
  }

  if (assetHistoryTarget.value.type === 'environment') {
    return resolveEnvironmentCard(assetHistoryTarget.value.id)?.referenceImage || ''
  }

  return propAssets.value.find(item => item.id === assetHistoryTarget.value?.id)?.referenceImage || ''
})

const assetHistoryEntries = computed(() => {
  if (!assetHistoryTarget.value) return []

  if (assetHistoryTarget.value.type === 'character') {
    return characters.value.find(item => item.id === assetHistoryTarget.value?.id)?.assetHistory || []
  }

  if (assetHistoryTarget.value.type === 'environment') {
    return resolveEnvironmentCard(assetHistoryTarget.value.id)?.assetHistory || []
  }

  return propAssets.value.find(item => item.id === assetHistoryTarget.value?.id)?.assetHistory || []
})

const sceneVideoHistoryTargetScene = computed(() => {
  if (!sceneVideoHistoryTarget.value) return null
  return scenes.value.find(item => item.id === sceneVideoHistoryTarget.value?.sceneId) || null
})

const sceneVideoHistoryTargetLabel = computed(() => {
  return sceneVideoHistoryTargetScene.value?.title || ''
})

const sceneVideoHistoryCurrentVideoUrl = computed(() => {
  return sceneVideoHistoryTargetScene.value?.videoUrl || ''
})

const sceneVideoHistoryEntries = computed(() => {
  return sceneVideoHistoryTargetScene.value?.videoHistory || []
})

function setAssetHistoryDialogOpen(open: boolean) {
  assetHistoryDialogOpen.value = open
  if (!open) {
    assetHistoryTarget.value = null
  }
}

function setSceneVideoHistoryDialogOpen(open: boolean) {
  sceneVideoHistoryDialogOpen.value = open
  if (!open) {
    sceneVideoHistoryTarget.value = null
  }
}

function openCharacterHistory(characterId: string) {
  assetHistoryTarget.value = { type: 'character', id: characterId }
  assetHistoryDialogOpen.value = true
}

function openEnvironmentHistory(assetId: string) {
  assetHistoryTarget.value = { type: 'environment', id: assetId }
  assetHistoryDialogOpen.value = true
}

function openPropHistory(propId: string) {
  assetHistoryTarget.value = { type: 'prop', id: propId }
  assetHistoryDialogOpen.value = true
}

function openSceneVideoHistory(sceneId: string) {
  sceneVideoHistoryTarget.value = { sceneId }
  sceneVideoHistoryDialogOpen.value = true
}

async function handleAssetHistorySelect(entry: AssetImageHistoryEntry) {
  if (!assetHistoryTarget.value || !entry.image?.trim()) return

  const nextImage = entry.image.trim()
  const target = assetHistoryTarget.value
  assetHistoryApplying.value = true

  try {
    if (target.type === 'character') {
      const character = characters.value.find(item => item.id === target.id)
      if (!character || character.baseImage === nextImage) {
        setAssetHistoryDialogOpen(false)
        return
      }

      character.baseImage = nextImage
      await saveProject()
      setAssetHistoryDialogOpen(false)
      return
    }

    if (target.type === 'environment') {
      const environmentAsset = resolveEnvironmentCard(target.id)
      if (!environmentAsset || environmentAsset.referenceImage === nextImage) {
        setAssetHistoryDialogOpen(false)
        return
      }

      const latestState = resolveEnvironmentPanoramaState(target.id) || environmentAsset
      const nextPanoramaState: EnvironmentPanoramaState = {
        panoramaImage: latestState.panoramaImage?.trim() || undefined,
        crop: latestState.crop
      }

      if (entry.viewMode === '单视角') {
        nextPanoramaState.singleViewImage = nextImage
        nextPanoramaState.fourViewImage = latestState.fourViewImage?.trim() || undefined
      } else if (entry.viewMode === '四视角') {
        nextPanoramaState.singleViewImage = latestState.singleViewImage?.trim() || undefined
        nextPanoramaState.fourViewImage = nextImage
        nextPanoramaState.captureMode = '四视角'
      } else {
        nextPanoramaState.singleViewImage = latestState.singleViewImage?.trim() || undefined
        nextPanoramaState.fourViewImage = latestState.fourViewImage?.trim() || undefined
        if (latestState.captureMode === '四视角') {
          nextPanoramaState.captureMode = '四视角'
        }
      }

      await applyEnvironmentReferenceImage(target.id, nextImage, nextPanoramaState)
      await saveWorkflowMeta()
      setAssetHistoryDialogOpen(false)
      return
    }

    const prop = propAssets.value.find(item => item.id === target.id)
    if (!prop || prop.referenceImage === nextImage) {
      setAssetHistoryDialogOpen(false)
      return
    }

    prop.referenceImage = nextImage
    await saveWorkflowMeta()
    setAssetHistoryDialogOpen(false)
  } finally {
    assetHistoryApplying.value = false
  }
}

async function handleSceneVideoHistorySelect(entry: AssetVideoHistoryEntry) {
  const scene = sceneVideoHistoryTargetScene.value
  const nextVideoUrl = entry.videoUrl?.trim()
  if (!scene || !nextVideoUrl) return

  sceneVideoHistoryApplying.value = true

  try {
    if (scene.videoUrl === nextVideoUrl) {
      setSceneVideoHistoryDialogOpen(false)
      return
    }

    scene.videoUrl = nextVideoUrl
    scene.videoError = undefined
    scene.videoStatus = 'done'
    synchronizeQueueItems()
    await saveProject()
    setSceneVideoHistoryDialogOpen(false)
  } finally {
    sceneVideoHistoryApplying.value = false
  }
}

async function handleCharacterImageUpload(characterId: string, event: Event) {
  const target = characters.value.find(item => item.id === characterId)
  const previousImage = target?.baseImage?.trim() || ''

  await handleCharacterImageUploadCore(characterId, event)

  const nextImage = characters.value.find(item => item.id === characterId)?.baseImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  recordCharacterHistory(characterId, nextImage, { source: 'uploaded' })
  await saveWorkflowMeta()
}

async function handleEnvironmentImageUpload(assetId: string, event: Event) {
  // Core handler already records history, refreshes assetWorkflow, and saves
  // both workflow meta and scene firstFrame before reporting success.
  await handleEnvironmentImageUploadCore(assetId, event)
}

async function handlePropImageUpload(propId: string, event: Event) {
  const target = propAssets.value.find(item => item.id === propId)
  const previousImage = target?.referenceImage?.trim() || ''

  await handlePropImageUploadCore(propId, event)

  const nextImage = propAssets.value.find(item => item.id === propId)?.referenceImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  recordPropHistory(propId, nextImage, { source: 'uploaded' })
  await saveWorkflowMeta()
}

async function handleGeneratePropImage(
  propId: string,
  options: {
    skipCompletionNotice?: boolean
  } = {}
) {
  const previousImage = propAssets.value.find(item => item.id === propId)?.referenceImage?.trim() || ''
  const generatedImage = await generatePropImageCore(propId, {
    skipCompletionNotice: options.skipCompletionNotice
  })
  const target = propAssets.value.find(item => item.id === propId)
  const nextImage = generatedImage?.trim() || target?.referenceImage?.trim() || ''
  if (!target || !nextImage || nextImage === previousImage) return

  target.referenceImage = nextImage

  recordPropHistory(propId, nextImage, { source: 'generated' })
  await saveWorkflowMeta()
}

async function uploadSceneEditOtherAssets(options: {
  sceneId: string
  files: File[]
  names?: string[]
}): Promise<DisplayAsset[]> {
  const sceneId = options.sceneId?.trim()
  if (!sceneId) {
    throw new Error('场景ID无效，无法上传资产')
  }

  const files = Array.isArray(options.files) ? options.files : []
  const names = Array.isArray(options.names) ? options.names : []
  if (files.length === 0) return []

  const createdAssets: DisplayAsset[] = []
  const existingNames = propAssets.value.map(item => item.name)

  try {
    for (const [index, file] of files.entries()) {
      const imageUrl = await uploadImageFile(file, {
        maxFileSize: MAX_ASSET_UPLOAD_SIZE,
        prefix: `scene_edit_${sceneId}`
      })

      const preferredName = (names[index] || '').trim()
      const name = resolveChatUploadAssetName(preferredName || file.name, existingNames)
      existingNames.push(name)

      const propId = createPropAssetId()
      propAssets.value.push({
        id: propId,
        name,
        description: '场景编辑上传图片资产',
        category: 'other',
        mediaType: 'image',
        referenceImage: imageUrl
      })
      recordPropHistory(propId, imageUrl, { source: 'uploaded' })
      createdAssets.push({
        id: `prop:${propId}`,
        name,
        type: 'other',
        description: '场景编辑上传图片资产',
        referenceImage: imageUrl
      })
    }

    await saveWorkflowMeta()
    return createdAssets
  } catch (error) {
    throw new Error(resolveUiError(error, '场景编辑上传资产失败'))
  }
}

const {
  sceneChatOpenSceneId,
  sceneChatCurrentMessages,
  sceneChatComposerAssets,
  sceneChatComposerText,
  sceneChatMentionOpen,
  sceneChatMentionCandidates,
  sceneChatMentionActiveIndex,
  sceneChatUploading,
  sceneChatApplying,
  sceneChatError,
  sceneChatCanSubmit,
  setSceneChatComposerText,
  setSceneChatInputRef,
  setSceneChatMentionListRef,
  closeSceneChat,
  toggleSceneChat,
  applySceneChatMention,
  handleSceneChatComposerInput,
  handleSceneChatComposerCursor,
  handleSceneChatComposerKeydown,
  removeSceneChatComposerAsset,
  handleSceneChatImageUpload,
  submitSceneChat,
  syncSceneChatValidScenes
} = useAssetWorkbenchSceneChat({
  scenes,
  propAssets,
  allAssets,
  workflowStylePrompt,
  maxAssetUploadSize: MAX_ASSET_UPLOAD_SIZE,
  uniqueSorted,
  resolveUiError,
  resolveDisplayAssetById,
  resolveDisplayAssetTypeLabel,
  resolveAssetMentionTokenMap,
  resolveAssetByMentionTokenMap,
  resolveSceneDescriptionWithoutAssetMentions,
  buildSceneMentionDescription,
  buildAssetWorkflowScenePayload,
  resolveSceneReferenceAssetIds,
  setSceneAssetReferences,
  saveWorkflowMeta,
  saveProject,
  onModelTaskCompleted: notifyGenerationCompleted,
  onModelTaskFailed: notifyGenerationFailed
})

async function selectSceneDescriptionVersion(sceneId: string, versionId: string) {
  const scene = scenes.value.find(item => item.id === sceneId)
  const version = scene?.descriptionHistory?.find(item => item.id === versionId)
  if (!scene || !version || version.description === scene.description) return

  const history = Array.isArray(scene.descriptionHistory) ? scene.descriptionHistory : []
  if (!history.some(item => item.description === scene.description)) {
    history.push({
      id: `scene_desc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      description: scene.description,
      createdAt: Date.now(),
      label: '切换前版本'
    })
    scene.descriptionHistory = history.slice(-20)
  }
  scene.description = version.description
  invalidateSceneGenerationState(scene)
  await saveProject()
}

let previousCharacterDependencySnapshot = buildCharacterDependencySnapshot()

watch(
  buildCharacterDependencySnapshot,
  async (nextSnapshot) => {
    const clonedSnapshot = nextSnapshot.map(item => ({ ...item }))
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) {
      previousCharacterDependencySnapshot = clonedSnapshot
      return
    }

    const previousMap = new Map(
      previousCharacterDependencySnapshot.map(item => [item.id, item])
    )
    previousCharacterDependencySnapshot = clonedSnapshot

    const generationSceneIds = new Set<string>()
    const videoSceneIds = new Set<string>()

    for (const character of clonedSnapshot) {
      const previous = previousMap.get(character.id)
      if (!previous) continue

      const nameChanged = previous.name !== character.name
      const baseImageChanged = previous.baseImage !== character.baseImage
      if (!nameChanged && !baseImageChanged) continue

      const sceneIds = resolveCharacterDependentSceneIds(character.id)
      for (const sceneId of sceneIds) {
        if (nameChanged) {
          generationSceneIds.add(sceneId)
          continue
        }
        if (baseImageChanged) {
          videoSceneIds.add(sceneId)
        }
      }
    }

    const generationInvalidated = invalidateSceneGenerations(Array.from(generationSceneIds))
    const videoInvalidated = invalidateSceneVideos(
      Array.from(videoSceneIds).filter(sceneId => !generationSceneIds.has(sceneId))
    )

    if (!generationInvalidated && !videoInvalidated) return

    synchronizeQueueItems()
    await saveProject()
  }
)

let previousPropDependencySnapshot = buildPropDependencySnapshot()

const processPropDependencyChanges = useDebounceFn(async (nextSnapshot: PropDependencySnapshot[]) => {
  const previousMap = new Map(
    previousPropDependencySnapshot.map(item => [item.id, item])
  )
  previousPropDependencySnapshot = nextSnapshot

  if (!workflowMetaReady.value || hydratingWorkflowMeta.value) {
    return
  }

  const generationSceneIds = new Set<string>()
  const videoSceneIds = new Set<string>()

  for (const prop of nextSnapshot) {
    const previous = previousMap.get(prop.id)
    if (!previous) continue

    const nameChanged = previous.name !== prop.name
    const referenceImageChanged = previous.referenceImage !== prop.referenceImage
    if (!nameChanged && !referenceImageChanged) continue

    const sceneIds = resolveScenesReferencingAsset(`prop:${prop.id}`)
    for (const sceneId of sceneIds) {
      if (nameChanged) {
        generationSceneIds.add(sceneId)
        continue
      }
      if (referenceImageChanged) {
        videoSceneIds.add(sceneId)
      }
    }
  }

  const generationInvalidated = invalidateSceneGenerations(Array.from(generationSceneIds))
  const videoInvalidated = invalidateSceneVideos(
    Array.from(videoSceneIds).filter(sceneId => !generationSceneIds.has(sceneId))
  )

  if (!generationInvalidated && !videoInvalidated) return

  synchronizeQueueItems()
  await saveProject()
}, 500)

watch(
  buildPropDependencySnapshot,
  (nextSnapshot) => {
    const clonedSnapshot = nextSnapshot.map(item => ({ ...item }))
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) {
      previousPropDependencySnapshot = clonedSnapshot
      return
    }

    void processPropDependencyChanges(clonedSnapshot)
  }
)

watch(
  () => scenes.value.map(scene => scene.id),
  (sceneIds) => {
    synchronizeSceneConfigs()
    synchronizeQueueItems()
    syncSceneChatValidScenes(sceneIds)
  },
  { immediate: true }
)

watch(
  [sceneConfigs, propAssets],
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  },
  { deep: true }
)

watch(
  () => characters.value.map(character => ({
    id: character.id,
    assetHistory: character.assetHistory
  })),
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  },
  { deep: true }
)

watch(
  () => scenes.value.map(scene => ({
    id: scene.id,
    videoHistory: scene.videoHistory
  })),
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  },
  { deep: true }
)

watch(
  environmentAssetHistories,
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  },
  { deep: true }
)

watch(
  environmentPanoramaStates,
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  },
  { deep: true }
)

watch(
  finalVideo,
  () => {
    if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
    scheduleWorkflowMetaSave()
  },
  { deep: true }
)

watch(
  () => displayEnvironmentAssetCards.value.map(asset => ({
    id: asset.id,
    hasReference: !!resolveEnvironmentAssetReferenceImage(asset.id)
  })),
  (assets) => {
    const existingAssetIds = new Set(assets.map(item => item.id))
    const validMotherAssetIds = new Set(assets.filter(item => item.hasReference).map(item => item.id))
    const nextEntries = Object.entries(environmentMotherAssetSelections.value)
      .filter(([targetAssetId, motherAssetId]) => {
        return existingAssetIds.has(targetAssetId)
          && validMotherAssetIds.has(motherAssetId)
          && targetAssetId !== motherAssetId
      })

    if (nextEntries.length === Object.keys(environmentMotherAssetSelections.value).length) {
      return
    }

    environmentMotherAssetSelections.value = Object.fromEntries(nextEntries)
  },
  { immediate: true }
)

watch(environmentMotherAssetSelections, () => {
  if (!workflowMetaReady.value || hydratingWorkflowMeta.value) return
  scheduleWorkflowMetaSave()
})

watch(selectedScene, (scene) => {
  if (!scene) {
    selectedSceneId.value = ''
    return
  }

  if (!selectedSceneId.value) {
    selectedSceneId.value = scene.id
  }
})

async function regenerateEnvironmentAsset(assetId: string) {
  const consistencyReferenceImage = resolveEnvironmentSelectedMotherReferenceImage(assetId)
  const targetScene = resolveEnvironmentRepresentativeScene(assetId)
  if (!targetScene) {
    await generateEnvironmentAssetFromCard(assetId, {
      consistencyReferenceImage
    })
    return
  }
  await handleGenerateSceneBaseline(targetScene.id, {
    consistencyReferenceImage
  })
}

async function generateEnvironmentAssetFromCard(
  assetId: string,
  options: {
    customPrompt?: string
    consistencyReferenceImage?: string
    consistencyReferenceImages?: string[]
  } = {}
): Promise<boolean | 'busy'> {
  const asset = resolveEnvironmentCard(assetId)
  if (!asset) return false
  if (environmentAssetGenerationStates.value[assetId]?.status === 'generating') return 'busy'

  const customPrompt = options.customPrompt?.trim() || ''
  const consistencyReferenceImage = options.consistencyReferenceImage?.trim() || ''
  const consistencyReferenceImages = Array.isArray(options.consistencyReferenceImages)
    ? Array.from(new Set(
        options.consistencyReferenceImages
          .map(value => value?.trim() || '')
          .filter(Boolean)
      ))
    : []
  const isRegeneration = !!customPrompt
  const regenerationReferenceImage = isRegeneration
    ? (
        resolveEnvironmentPanoramaState(assetId)?.panoramaImage?.trim()
        || asset.referenceImage?.trim()
        || asset.panoramaImage?.trim()
        || ''
      )
    : ''
  const fallbackError = isRegeneration ? '环境二次生成失败' : '环境图生成失败'

  if (isRegeneration && !regenerationReferenceImage) {
    const message = '环境参考图不存在，请先生成或上传环境图'
    autoRunError.value = message
    setEnvironmentAssetGenerationState(assetId, {
      status: 'error',
      error: message
    })
    return false
  }

  autoRunError.value = null
  setEnvironmentAssetGenerationState(assetId, { status: 'generating' })

  try {
    const generationSetting = resolveEnvironmentAssetGenerationSetting(
      asset,
      resolveEnvironmentRepresentativeScene(assetId)
    )
    const response = await $fetch<{
      success: boolean
      referenceImage?: string
      error?: string
    }>('/api/asset-workflow/reference/generate', {
      method: 'POST',
      body: {
        projectId: projectId.value,
        scene: {
          id: asset.id,
          title: asset.name,
          description: asset.description || asset.sceneTitles.join('、') || asset.name,
          duration: 8,
          setting: {
            location: generationSetting.location,
            timeOfDay: generationSetting.timeOfDay,
            mood: generationSetting.mood
          },
          characters: []
        },
        style: workflowStylePrompt.value,
        aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
        environmentContext: {
          environmentRoot: generationSetting.location,
          anchorLocation: generationSetting.location,
          anchorDescription: asset.description || '',
          siblingLocations: []
        },
        regeneration: isRegeneration
          ? {
              customPrompt,
              referenceImage: regenerationReferenceImage
            }
          : undefined,
        consistencyReferenceImage: consistencyReferenceImage || undefined,
        consistencyReferenceImages: consistencyReferenceImages.length > 0
          ? consistencyReferenceImages
          : undefined
      }
    })

    if (!response.success || !response.referenceImage) {
      throw new Error(response.error || fallbackError)
    }

    let finalReferenceImage = response.referenceImage
    let crop: EnvironmentCropSelection | undefined
    let captureMode: EnvironmentCropCaptureMode | undefined
    let singleViewImage: string | undefined
    let fourViewImage: string | undefined
    try {
      captureMode = resolveEnvironmentPanoramaState(assetId)?.captureMode
        || asset.captureMode
      const croppedResult = await createEnvironmentCropImage({
        assetId,
        sourceImage: response.referenceImage,
        crop: asset.crop,
        captureMode,
        aspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO
      })
      finalReferenceImage = croppedResult.imageUrl
      crop = croppedResult.crop
      captureMode = croppedResult.captureMode
      singleViewImage = croppedResult.singleViewImage
      fourViewImage = croppedResult.fourViewImage
    } catch (error) {
      console.warn('[AssetWorkbench] 环境资产图裁切失败，已回退使用原始环境图', {
        assetId,
        reason: error instanceof Error ? error.message : String(error)
      })
    }

    setEnvironmentPanoramaState(assetId, {
      panoramaImage: response.referenceImage,
      crop,
      captureMode,
      singleViewImage,
      fourViewImage
    })
    const normalizedSingleViewImage = singleViewImage?.trim() || ''
    const normalizedFourViewImage = fourViewImage?.trim() || ''

    if (normalizedSingleViewImage) {
      recordEnvironmentHistory(assetId, normalizedSingleViewImage, {
        source: 'generated',
        prompt: customPrompt || undefined,
        viewMode: '单视角'
      })
    }
    if (normalizedFourViewImage) {
      recordEnvironmentHistory(assetId, normalizedFourViewImage, {
        source: 'generated',
        prompt: customPrompt || undefined,
        viewMode: '四视角'
      })
    }
    if (!normalizedSingleViewImage && !normalizedFourViewImage && finalReferenceImage?.trim()) {
      recordEnvironmentHistory(assetId, finalReferenceImage, {
        source: 'generated',
        prompt: customPrompt || undefined
      })
    }
    await saveWorkflowMeta()
    setEnvironmentAssetGenerationState(assetId, null)
    await notifyGenerationCompleted({
      title: isRegeneration ? '环境图二次生成完成' : '环境图生成完成',
      body: `环境：${asset.name}`
    })
    return true
  } catch (error) {
    const message = resolveUiError(error, fallbackError)
    setEnvironmentAssetGenerationState(assetId, {
      status: 'error',
      error: message
    })
    autoRunError.value = message
    await notifyGenerationFailed({
      title: isRegeneration ? '环境图二次生成失败' : '环境图生成失败',
      body: `环境：${asset.name}（${message}）`
    })
    return false
  }
}

async function submitEnvironmentRegeneration() {
  const target = environmentRegenerateTarget.value
  const prompt = environmentRegeneratePrompt.value.trim()
  const mentionMap = resolveAssetByMentionTokenMap()
  const mentionAssetIds = prompt
    ? extractAssetIdsFromSceneChatText(prompt, mentionMap)
    : []
  const consistencyReferenceImages = Array.from(new Set(
    mentionAssetIds
      .map(assetId => resolveDisplayAssetById(assetId))
      .filter((asset): asset is DisplayAsset => !!asset && asset.type === 'environment' && asset.id !== target?.id)
      .map(asset => resolveEnvironmentAssetReferenceImage(asset.id) || '')
      .filter(Boolean)
  ))
  const consistencyReferenceImage = consistencyReferenceImages[0]

  if (!target) {
    await submitEnvironmentRegenerationCore({
      consistencyReferenceImage,
      consistencyReferenceImages
    })
    return
  }

  const targetScene = resolveEnvironmentRepresentativeScene(target.id)
  if (targetScene) {
    await submitEnvironmentRegenerationCore({
      consistencyReferenceImage,
      consistencyReferenceImages
    })
    return
  }

  if (!prompt) {
    environmentRegenerateError.value = '请输入二次生成提示词'
    return
  }

  environmentRegenerateError.value = null
  const succeeded = await generateEnvironmentAssetFromCard(target.id, {
    customPrompt: prompt,
    consistencyReferenceImage,
    consistencyReferenceImages
  })
  if (succeeded === 'busy') {
    return
  }
  if (!succeeded) {
    environmentRegenerateError.value = autoRunError.value || '环境二次生成失败'
    return
  }

  setEnvironmentRegenerateDialogOpen(false)
}

async function handleGenerateSceneBaseline(
  sceneId: string,
  generationOptions?: GenerateSceneBaselineOptions
) {
  autoRunError.value = null
  try {
    await generateSceneBaseline(sceneId, generationOptions)
  } catch (error) {
    autoRunError.value = resolveUiError(error, '环境图生成失败')
  }
}

function openEnvironmentAssetSceneEditor(assetId: string) {
  const targetScene = resolveEnvironmentRepresentativeScene(assetId)
  if (!targetScene) return
  openSceneEdit(targetScene)
}

function setSceneEditDialogState(open: boolean) {
  sceneEditDialogOpen.value = open
}

function setImagePreviewState(open: boolean) {
  imagePreviewOpen.value = open
}

function downloadBlobFile(blob: Blob, fileName: string) {
  if (typeof window === 'undefined') return

  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(objectUrl)
}

function buildFinalStageExportScenes(): SceneData[] {
  const readySceneMap = new Map(
    scenes.value
      .filter(scene => scene.videoStatus === 'done' && !!scene.videoUrl)
      .map(scene => [scene.id, scene] as const)
  )

  const orderedIds: string[] = []
  const consumed = new Set<string>()

  for (const sceneId of finalStageSceneOrder.value) {
    if (consumed.has(sceneId)) continue
    if (!readySceneMap.has(sceneId)) continue
    consumed.add(sceneId)
    orderedIds.push(sceneId)
  }

  for (const sceneId of readySceneMap.keys()) {
    if (consumed.has(sceneId)) continue
    consumed.add(sceneId)
    orderedIds.push(sceneId)
  }

  return orderedIds
    .map(sceneId => readySceneMap.get(sceneId))
    .filter((scene): scene is SceneData => !!scene)
}

async function handleExportJianyingProject() {
  if (exportingJianyingProject.value) return

  const orderedScenes = buildFinalStageExportScenes()
  if (orderedScenes.length === 0) {
    toast.warning('请先生成至少一个分镜视频')
    return
  }

  const transitionType = finalStageMergeOptions.value.transitionType || 'none'
  const transitionDuration = Number.isFinite(Number(finalStageMergeOptions.value.transitionDuration))
    ? Math.max(0.1, Math.min(2, Number(finalStageMergeOptions.value.transitionDuration)))
    : 0.5
  const bgmUrl = (finalStageMergeOptions.value.bgmUrl || '').trim()
  const bgmVolume = Number.isFinite(Number(finalStageMergeOptions.value.bgmVolume))
    ? Math.max(0, Math.min(1, Number(finalStageMergeOptions.value.bgmVolume)))
    : 0.3
  const audioTracks = Array.isArray(finalStageMergeOptions.value.audioTracks)
    ? finalStageMergeOptions.value.audioTracks
    : []
  const selectedBgm = audioTracks.find(track => track.kind === 'bgm' && track.url.trim())
  const soundEffects = audioTracks
    .filter(track => track.kind === 'sfx' && track.url.trim())
    .map((track) => {
      const volume = Number(track.volume)
      return {
        id: track.id,
        url: track.url.trim(),
        startTime: Math.max(0, Number(track.startTime) || 0),
        duration: Number.isFinite(Number(track.duration)) ? Math.max(0.1, Number(track.duration)) : undefined,
        volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.6
      }
    })

  exportingJianyingProject.value = true

  try {
    const { blob, fileName } = await exportAssetWorkbenchJianyingProject({
      projectName: projectName.value,
      aspectRatio: projectAspectRatio.value,
      sceneOrder: orderedScenes.map(scene => scene.id),
      scenes: orderedScenes.map(scene => ({
        id: scene.id,
        title: scene.title,
        description: scene.description,
        videoUrl: scene.videoUrl || '',
        duration: scene.duration,
        narration: scene.narration || null
      })),
      options: {
        addSubtitles: finalStageMergeOptions.value.addSubtitles === true,
        transition: {
          type: transitionType,
          duration: transitionDuration
        },
        bgm: selectedBgm?.url || bgmUrl
          ? {
              url: selectedBgm?.url || bgmUrl,
              volume: selectedBgm && Number.isFinite(Number(selectedBgm.volume))
                ? Math.max(0, Math.min(1, Number(selectedBgm.volume)))
                : bgmVolume
            }
          : undefined,
        soundEffects
      }
    })

    downloadBlobFile(blob, fileName)
  } catch (error) {
    toast.error(resolveUiError(error, '导出剪映工程失败'))
  } finally {
    exportingJianyingProject.value = false
  }
}

async function handleExportFormattedScriptDocx() {
  if (exportingScriptDocx.value) return
  if (scenes.value.length === 0) return

  exportingScriptDocx.value = true

  try {
    const { blob, fileName } = await exportAssetWorkbenchScriptDocx({
      projectName: projectName.value,
      scenes: scenes.value.map(scene => ({
        title: scene.title,
        description: scene.description,
        narration: scene.narration || null,
        duration: scene.duration,
        setting: scene.setting
          ? {
              location: scene.setting.location,
              timeOfDay: scene.setting.timeOfDay
            }
          : undefined,
        characters: scene.characters?.map(character => ({
          name: character.name
        })) || []
      }))
    })

    downloadBlobFile(blob, fileName)
    toast.success('格式化 DOCX 已导出', {
      description: fileName
    })
  } catch (error) {
    toast.error(resolveUiError(error, '导出格式化 DOCX 失败'))
  } finally {
    exportingScriptDocx.value = false
  }
}

async function handleImportLibraryAsset(payload: {
  asset: LibraryAsset
  targetId?: string
  createNew: boolean
  tab: 'characters' | 'environments' | 'props' | 'others'
}) {
  const { asset } = payload
  try {
    if (!libraryPermissionCanUse(asset.permission)) {
      throw new Error('当前素材仅允许查看，不能加入项目')
    }
    if (payload.tab === 'characters') {
      if (asset.category === 'character_voice') {
        const target = characters.value.find(item => item.id === payload.targetId)
          || characters.value.find(item => !item.voiceAsset?.audioUrl)
          || characters.value[0]
        if (!target) throw new Error('当前项目没有可关联的角色')
        target.voiceAsset = {
          audioUrl: asset.url,
          libraryAssetId: asset.id,
          libraryAssetVersion: asset.version,
          locked: true,
          updatedAt: new Date().toISOString()
        }
        await saveProject()
      } else {
        const bundleName = asset.bundle?.characterName?.trim() || asset.name
        let target = payload.createNew
          ? undefined
          : characters.value.find(item => item.id === payload.targetId)
        target ||= characters.value.find(item => item.name.trim() === bundleName)
        const response = asset.bundle?.viewAssetIds
          || asset.bundle?.voiceAssetId
          || asset.bundle?.expressionAssetIds
          || asset.bundle?.poseAssetIds
          ? await listAllLibraryAssets()
          : null
        const libraryMap = new Map((response || []).map(item => [item.id, item]))
        const viewReferences = asset.bundle?.viewAssetIds
          ? Object.entries(asset.bundle.viewAssetIds)
              .map(([view, assetId]) => [view, libraryMap.get(assetId)] as const)
              .filter((entry): entry is readonly [string, LibraryAsset] => entry[1]?.mediaType === 'image')
          : []
        const views = viewReferences.length > 0
          ? Object.fromEntries(viewReferences.map(([view, item]) => [view, item.url]))
          : undefined
        const voice = asset.bundle?.voiceAssetId
          ? libraryMap.get(asset.bundle.voiceAssetId)
          : undefined
        const expressionReferences = (asset.bundle?.expressionAssetIds || [])
          .map(assetId => libraryMap.get(assetId))
          .filter((item): item is LibraryAsset => item?.mediaType === 'image')
        const poseReferences = (asset.bundle?.poseAssetIds || [])
          .map(assetId => libraryMap.get(assetId))
          .filter((item): item is LibraryAsset => item?.mediaType === 'image')
        const appearance = [asset.bundle?.appearance || asset.description || asset.name, asset.bundle?.clothing]
          .filter(Boolean)
          .join('；')
        const prompt = asset.bundle?.generationPrompt?.trim()
        const expressions = Object.fromEntries([
          ...expressionReferences.map((item, index) => [`expression_${index + 1}`, item.url]),
          ...poseReferences.map((item, index) => [`pose_${index + 1}`, item.url])
        ])
        const referencedImages = [
          ...viewReferences.map(([, item]) => item),
          ...expressionReferences,
          ...poseReferences
        ]
        if (!target) {
          target = {
            id: `char_${projectId.value || 'project'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: bundleName,
            appearance: prompt ? `${appearance}；生成提示：${prompt}` : appearance,
            role: asset.bundle?.role || '配角',
            gender: asset.bundle?.gender,
            age: asset.bundle?.age,
            baseImage: asset.url,
            views: views as CharacterData['views'],
            traits: asset.tags,
            expressions: Object.keys(expressions).length > 0 ? expressions : undefined,
            voiceAsset: voice?.mediaType === 'audio'
              ? { audioUrl: voice.url, libraryAssetId: voice.id, libraryAssetVersion: voice.version, locked: true, updatedAt: new Date().toISOString() }
              : undefined,
            assetHistory: ensureAssetHistoryEntry([], asset.url, {
              source: 'uploaded',
              createdAt: new Date().toISOString(),
              libraryAssetId: asset.id,
              libraryAssetVersion: asset.version
            }),
            generating: false,
            generatingViews: false
          }
          characters.value.push(target)
        } else {
          target.name = bundleName || target.name
          target.appearance = prompt ? `${appearance}；生成提示：${prompt}` : appearance || target.appearance
          target.baseImage = asset.url
          target.traits = asset.tags
          if (Object.keys(expressions).length > 0) target.expressions = expressions
          recordCharacterHistory(target.id, asset.url, {
            source: 'uploaded',
            libraryAssetId: asset.id,
            libraryAssetVersion: asset.version
          })
          if (views && Object.keys(views).length > 0) target.views = views as CharacterData['views']
          if (voice?.mediaType === 'audio') {
            target.voiceAsset = { audioUrl: voice.url, libraryAssetId: voice.id, libraryAssetVersion: voice.version, locked: true, updatedAt: new Date().toISOString() }
          }
        }
        for (const referencedImage of referencedImages) {
          target.assetHistory = ensureAssetHistoryEntry(target.assetHistory, referencedImage.url, {
            source: 'uploaded',
            createdAt: new Date().toISOString(),
            libraryAssetId: referencedImage.id,
            libraryAssetVersion: referencedImage.version
          })
        }
        await saveProject()
      }
      await saveWorkflowMeta()
    } else if (payload.tab === 'environments') {
      const targetId = payload.targetId || displayEnvironmentAssetCards.value[0]?.id
      if (!targetId) throw new Error('当前项目没有可替换的环境资产')
      recordEnvironmentHistory(targetId, asset.url, {
        source: 'uploaded',
        libraryAssetId: asset.id,
        libraryAssetVersion: asset.version
      })
      await applyEnvironmentReferenceImage(targetId, asset.url)
      await saveWorkflowMeta()
    } else {
      const target = payload.createNew
        ? undefined
        : propAssets.value.find(item => item.id === payload.targetId)
      const isVoice = asset.mediaType === 'audio'
      if (target) {
        target.name = asset.name
        target.description = asset.description
        if (isVoice) {
          target.mediaType = 'voice'
          target.voiceAsset = { audioUrl: asset.url, libraryAssetId: asset.id, libraryAssetVersion: asset.version, locked: true, updatedAt: new Date().toISOString() }
        } else {
          target.mediaType = target.category === 'other' ? 'image' : undefined
          target.referenceImage = asset.url
          target.libraryAssetId = asset.id
          target.libraryAssetVersion = asset.version
        }
      } else {
        propAssets.value.push({
          id: createPropAssetId(),
          name: asset.name,
          description: asset.description,
          category: payload.tab === 'props' ? 'prop' : 'other',
          mediaType: payload.tab === 'others' ? (isVoice ? 'voice' : 'image') : undefined,
          referenceImage: isVoice ? undefined : asset.url,
          libraryAssetId: asset.id,
          libraryAssetVersion: asset.version,
          voiceAsset: isVoice
            ? { audioUrl: asset.url, libraryAssetId: asset.id, libraryAssetVersion: asset.version, locked: true, updatedAt: new Date().toISOString() }
            : undefined
        })
      }
      await saveWorkflowMeta()
    }
    const linkedAssetIds = asset.bundle
      ? [
          ...Object.values(asset.bundle.viewAssetIds || {}),
          ...(asset.bundle.expressionAssetIds || []),
          ...(asset.bundle.poseAssetIds || []),
          asset.bundle.voiceAssetId
        ].filter((id): id is string => !!id)
      : []
    await Promise.allSettled([asset.id, ...new Set(linkedAssetIds)].map(id => markLibraryAssetUsed(id)))
    toast.success(`已使用资源：${asset.name}`)
  } catch (error) {
    toast.error(resolveUiError(error, '资源库导入失败'))
  }
}

async function handleSaveAssetsToLibrary(tab: 'characters' | 'environments' | 'props' | 'others') {
  try {
    const existing = await listAllLibraryAssets()
    type LibraryCreateInput = Parameters<typeof createLibraryAsset>[0]
    let savedCount = 0

    function findStoredAsset(job: LibraryCreateInput) {
      const sourceUrl = job.sourceUrl?.trim()
      return existing.find(asset => asset.category === job.category && (
        (asset.name === job.name && (asset.sourceProjectId || '') === (job.sourceProjectId || ''))
        || (!!sourceUrl && (asset.url === sourceUrl || asset.sourceUrl === sourceUrl))
      ))
    }

    async function storeProjectAsset(job: LibraryCreateInput) {
      const stored = findStoredAsset(job)
      if (stored) return stored
      let created = await createLibraryAsset(job)
      try {
        const metadata = await readRemoteLibraryMetadata(created.url, created.mediaType)
        created = await updateLibraryAsset(created.id, metadata)
      } catch {
        // The original file is already durable; metadata enrichment is best effort.
      }
      existing.push(created)
      savedCount += 1
      return created
    }

    if (tab === 'characters') {
      const viewLabels: Record<string, string> = {
        front: '正面',
        three_quarter: '四分之三侧面',
        side: '侧面',
        back: '背面',
        top_down: '俯视',
        bottom_up: '仰视'
      }
      for (const character of characters.value) {
        const voice = character.voiceAsset?.audioUrl
          ? await storeProjectAsset({
              mediaType: 'audio',
              category: 'character_voice',
              name: `${character.name}音色`,
              description: character.voiceTone || character.speakingStyle,
              sourceUrl: character.voiceAsset.audioUrl,
              sourceType: 'project',
              sourceProjectId: projectId.value,
              tags: character.traits
            })
          : undefined
        const views = Object.entries(character.views || {}).filter((entry): entry is [string, string] => !!entry[1])
        const primaryUrl = character.baseImage || views.find(([view]) => view === 'front')?.[1] || views[0]?.[1]
        if (!primaryUrl) continue
        let primary = await storeProjectAsset({
          mediaType: 'image',
          category: 'character',
          name: character.name,
          description: character.appearance,
          sourceUrl: primaryUrl,
          sourceType: 'project',
          sourceProjectId: projectId.value,
          tags: character.traits
        })
        const viewAssetIds: Record<string, string> = {}
        for (const [view, url] of views) {
          const asset = url === primaryUrl
            ? primary
            : await storeProjectAsset({
                mediaType: 'image',
                category: 'character',
                name: `${character.name}-${viewLabels[view] || view}`,
                description: `${character.appearance}；${viewLabels[view] || view}参考`,
                sourceUrl: url,
                sourceType: 'project',
                sourceProjectId: projectId.value,
                tags: [...(character.traits || []), '角色包依赖']
              })
          viewAssetIds[view] = asset.id
        }
        const expressionAssetIds: string[] = []
        const poseAssetIds: string[] = []
        for (const [referenceName, url] of Object.entries(character.expressions || {})) {
          if (!url) continue
          const isPose = /pose|action|动作|姿态/iu.test(referenceName)
          const asset = url === primaryUrl
            ? primary
            : await storeProjectAsset({
                mediaType: 'image',
                category: 'character',
                name: `${character.name}-${referenceName}`,
                description: `${character.appearance}；${referenceName}参考`,
                sourceUrl: url,
                sourceType: 'project',
                sourceProjectId: projectId.value,
                tags: [...(character.traits || []), isPose ? '动作参考' : '表情参考', '角色包依赖']
              })
          ;(isPose ? poseAssetIds : expressionAssetIds).push(asset.id)
        }
        primary = await updateLibraryAsset(primary.id, {
          bundle: {
            characterName: character.name,
            appearance: character.appearance,
            role: character.role,
            gender: character.gender,
            age: character.age,
            baseImageAssetId: primary.id,
            viewAssetIds: Object.keys(viewAssetIds).length > 0 ? viewAssetIds : undefined,
            expressionAssetIds: expressionAssetIds.length > 0 ? [...new Set(expressionAssetIds)] : undefined,
            poseAssetIds: poseAssetIds.length > 0 ? [...new Set(poseAssetIds)] : undefined,
            voiceAssetId: voice?.id
          }
        })
        const primaryIndex = existing.findIndex(asset => asset.id === primary.id)
        if (primaryIndex >= 0) existing[primaryIndex] = primary
      }
      toast.success(savedCount > 0 ? `已存入 ${savedCount} 个资源并更新角色包` : '角色包已更新')
      return
    }

    const jobs: Array<Parameters<typeof createLibraryAsset>[0]> = []
    if (tab === 'environments') {
      for (const environment of displayEnvironmentAssetCards.value) {
        const url = environment.referenceImage || environment.singleViewImage || environment.fourViewImage
        if (url) jobs.push({ mediaType: 'image', category: 'environment', name: environment.name, description: environment.description, sourceUrl: url, sourceType: 'project', sourceProjectId: projectId.value })
      }
    } else {
      const source = propAssets.value.filter(item => tab === 'props' ? item.category === 'prop' : item.category === 'other')
      for (const item of source) {
        if (item.referenceImage) jobs.push({ mediaType: 'image', category: tab === 'props' ? 'prop' : 'other', name: item.name, description: item.description, sourceUrl: item.referenceImage, sourceType: 'project', sourceProjectId: projectId.value })
        if (item.voiceAsset?.audioUrl) jobs.push({ mediaType: 'audio', category: 'narration', name: item.name, description: item.description, sourceUrl: item.voiceAsset.audioUrl, sourceType: 'project', sourceProjectId: projectId.value })
      }
    }
    for (const job of jobs) {
      await storeProjectAsset(job)
    }
    toast.success(savedCount > 0 ? `已存入 ${savedCount} 个资源` : '这些资源已在资源库中')
  } catch (error) {
    toast.error(resolveUiError(error, '存入资源库失败'))
  }
}

</script>

<template>
  <div class="h-full min-h-0 overflow-hidden p-3 flex flex-col gap-2">
    <AssetWorkbenchHeaderBar
      :project-name="projectName"
      :project-description="projectDescription"
      :selected-style-id="selectedStyleId"
      :project-style-id="projectStyleId"
      :script-parse-mode="scriptParseMode"
      :project-aspect-ratio="projectAspectRatio"
      :stages="autoStages"
      :active-stage="activeAutoStage"
      :auto-run-error="autoRunError"
      :save-error="saveError"
      :save-warning="saveWarning"
      @back="router.push('/projects')"
      @select-stage="(stage) => selectAutoStage(stage as AutoStageKey)"
    />

    <AssetWorkbenchParseStage
      v-if="activeAutoStage === 'parse'"
      v-model:novel-text="novelText"
      :script-parse-mode="scriptParseMode"
      :parsing="parsing"
      :episode-plan="episodePlan"
      :parse-progress="parseProgress"
      :scenes-count="scenes.length"
      :characters-count="characters.length"
      :hint="parseStageHint"
      @prepare-episodes="handlePrepareEpisodePlan"
    />

    <AssetWorkbenchStagePanel
      v-else-if="activeAutoStage === 'assets' || activeAutoStage === 'videos'"
    >
      <KeepAlive>
        <AssetWorkbenchAssetsStage
          v-if="activeAutoStage === 'assets'"
          key="assets-stage"
          :scenes-count="scenes.length"
          :characters="characters"
          :environment-asset-cards="displayEnvironmentAssetCards"
          :prop-assets="propAssets"
          :auto-running="autoRunning"
          :parse-stage-label="scriptParseMode === 'origin_explainer' ? '镜头规划' : '剧本解析'"
          :character-ready-count="characterReadyCount"
          :character-generating-count="characterGeneratingCount"
          :character-missing-count="characterMissingCount"
          :editing-character-id="editingCharacterId"
          :character-edit-draft="characterEditDraft"
          :uploading-character-id="uploadingCharacterId"
          :uploading-ark-character-id="uploadingArkCharacterId"
          :uploading-character-voice-id="uploadingCharacterVoiceId"
          :uploading-environment-asset-id="uploadingEnvironmentAssetId"
          :uploading-prop-id="uploadingPropId"
          :uploading-prop-voice-id="uploadingPropVoiceId"
          :generating-prop-id="generatingPropId"
          :get-character-scene-count="resolveCharacterSceneCount"
          :get-environment-scene-summary="resolveEnvironmentSceneSummary"
          :get-environment-mother-candidates="resolveEnvironmentMotherCandidates"
          :get-environment-selected-mother-id="resolveEnvironmentSelectedMotherId"
          :has-environment-representative-scene="hasEnvironmentRepresentativeScene"
          :get-prop-usage-count="resolvePropUsageCount"
          :set-character-edit-draft="updateCharacterEditDraft"
          @select-stage="(stage) => selectAutoStage(stage as AutoStageKey)"
          @preview-image="openImagePreview($event.src, $event.alt)"
          @start-character-edit="startEditCharacter"
          @add-character-variant="openCharacterVariantDialog"
          @remove-character-variant="removeCharacterVariant"
          @cancel-character-edit="cancelEditCharacter"
          @save-character-edit="saveCharacterEdit()"
          @save-character-edit-regenerate="saveCharacterEdit({ regenerate: true })"
          @generate-character="handleGenerateCharacter"
          @open-character-regenerate="openCharacterRegenerateDialog"
          @open-character-history="openCharacterHistory"
          @upload-character-image="handleCharacterImageUpload($event.characterId, $event.event)"
          @ingest-character-ark-asset="ingestCharacterToArkVirtualAsset($event)"
          @select-character-ark-asset="openCharacterArkAssetSelect"
          @upload-character-voice="handleCharacterVoiceUpload($event.characterId, $event.event)"
          @update-character-voice-lock="handleCharacterVoiceLockChange($event.characterId, $event.locked)"
          @edit-environment-scene="openEnvironmentAssetSceneEditor"
          @upload-environment-image="handleEnvironmentImageUpload($event.assetId, $event.event)"
          @open-environment-crop="openEnvironmentCropDialog($event.assetId, $event.captureMode)"
          @open-environment-regenerate="openEnvironmentRegenerateDialog"
          @open-environment-history="openEnvironmentHistory"
          @regenerate-environment="regenerateEnvironmentAsset"
          @update-environment-mother="handleEnvironmentMotherSelection($event)"
          @add-prop="addPropAsset"
          @remove-prop="removePropAsset"
          @generate-prop="handleGeneratePropImage"
          @upload-prop-image="handlePropImageUpload($event.propId, $event.event)"
          @upload-prop-voice="handlePropVoiceUpload($event.propId, $event.event)"
          @update-prop-voice-lock="handlePropVoiceLockChange($event.propId, $event.locked)"
          @open-prop-history="openPropHistory"
          @import-library-asset="handleImportLibraryAsset"
          @save-assets-to-library="handleSaveAssetsToLibrary"
        />

        <AssetWorkbenchVideosStage
          v-else
          :key="`videos-stage:${projectId || 'new'}`"
          :scenes="scenes"
          :project-aspect-ratio="projectAspectRatio"
          :script-parse-mode="scriptParseMode"
          :episode-plan="episodePlan"
          :episode-overviews="episodeOverviewById"
          :selected-scene-id="selectedSceneId"
          :selected-scene="selectedScene"
          :queue-summary="queueSummary"
          :auto-running="autoRunning"
          :parsing="parsing"
          :parse-progress-message="parseProgress.message"
          :scene-chat-open-scene-id="sceneChatOpenSceneId"
          :scene-chat-current-messages="sceneChatCurrentMessages"
          :scene-chat-composer-assets="sceneChatComposerAssets"
          :scene-chat-composer-text="sceneChatComposerText"
          :scene-chat-mention-open="sceneChatMentionOpen"
          :scene-chat-mention-candidates="sceneChatMentionCandidates"
          :scene-chat-mention-active-index="sceneChatMentionActiveIndex"
          :scene-chat-uploading="sceneChatUploading"
          :scene-chat-applying="sceneChatApplying"
          :scene-chat-error="sceneChatError"
          :scene-chat-can-submit="sceneChatCanSubmit"
          :resolve-scene-previous-last-frame-reference-enabled="resolveScenePreviousLastFrameReferenceEnabled"
          :resolve-scene-continuity-link-reason="resolveSceneContinuityLinkReason"
          :can-use-previous-last-frame-reference="canUsePreviousLastFrameReference"
          :resolve-scene-video-badge="resolveSceneVideoBadge"
          :resolve-scene-voice-reference-summary="resolveSceneVoiceReferenceSummary"
          :resolve-scene-description-render-segments="resolveSceneDescriptionRenderSegments"
          :resolve-scene-description-secondary-mention-items="resolveSceneDescriptionSecondaryMentionItems"
          :resolve-scene-reference-image="resolveSceneReferenceImage"
          :resolve-scene-environment-reference-image-for-mode="resolveSceneEnvironmentReferenceImageForMode"
          :scene-environment-asset-options="sceneEnvironmentAssetOptions"
          :resolve-scene-environment-reference-asset-selection="resolveSceneEnvironmentReferenceAssetSelection"
          :resolve-scene-narration-voice-options="resolveSceneNarrationVoiceOptions"
          :resolve-scene-narration-voice-reference-selection="resolveSceneNarrationVoiceReferenceSelection"
          :supports-narration-voice-reference="supportsExplicitVoiceAudioReference"
          :is-scene-busy="isSceneBusy"
          :is-scene-preparing="isScenePreparing"
          :can-merge-scene-by-index="canMergeSceneByIndex"
          :resolve-display-asset-by-id="resolveDisplayAssetById"
          :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
          :set-scene-chat-input-ref="setSceneChatInputRef"
          :set-scene-chat-mention-list-ref="setSceneChatMentionListRef"
          :set-scene-chat-composer-text="setSceneChatComposerText"
          :exporting-script-docx="exportingScriptDocx"
          :on-export-formatted-script-docx="handleExportFormattedScriptDocx"
          :on-parse-episode="(episodeId) => handleParseSingleEpisode({ id: episodeId })"
          :on-select-scene="selectScene"
          :on-open-scene-edit="openSceneEdit"
          :on-toggle-scene-chat="toggleSceneChat"
          :on-handle-split-scene="handleSplitScene"
          :on-handle-merge-with-next-scene="handleMergeWithNextScene"
          :on-handle-delete-scene="handleDeleteScene"
          :on-generate-scene-baseline="handleGenerateSceneBaseline"
          :on-retry-scene="retryScene"
          :on-open-scene-video-history="openSceneVideoHistory"
          :on-set-scene-previous-last-frame-reference="setScenePreviousLastFrameReference"
          :on-set-scene-environment-capture-mode="setSceneEnvironmentCaptureMode"
          :on-set-scene-environment-reference-asset="setSceneEnvironmentReferenceAsset"
          :on-set-scene-narration-voice-reference="setSceneNarrationVoiceReference"
          :on-preview-image="openImagePreview"
          :on-close-scene-chat="closeSceneChat"
          :on-handle-scene-chat-composer-input="handleSceneChatComposerInput"
          :on-handle-scene-chat-composer-cursor="handleSceneChatComposerCursor"
          :on-handle-scene-chat-composer-keydown="handleSceneChatComposerKeydown"
          :on-apply-scene-chat-mention="applySceneChatMention"
          :on-remove-scene-chat-composer-asset="removeSceneChatComposerAsset"
          :on-handle-scene-chat-image-upload="handleSceneChatImageUpload"
          :on-submit-scene-chat="submitSceneChat"
          :on-select-scene-description-version="selectSceneDescriptionVersion"
          :normalize-workflow-text="normalizeWorkflowText"
        />
      </KeepAlive>
    </AssetWorkbenchStagePanel>

    <AssetWorkbenchFinalStage
      v-else
      :hint="stageHints.final"
      :project-aspect-ratio="projectAspectRatio"
      :queue-done="queueSummary.done"
      :auto-running="autoRunning"
      :auto-run-current-stage="autoRunCurrentStage"
      :merge-running="mergeStatus.running"
      :exporting-jianying-project="exportingJianyingProject"
      :final-video-url="finalVideo?.videoUrl"
      :scenes="finalStageScenes"
      :scene-order="finalStageSceneOrder"
      :merge-options="finalStageMergeOptions"
      @run-final="handleRunFinalStage"
      @export-jianying-project="handleExportJianyingProject"
      @update-scene-order="handleFinalStageSceneOrderUpdate"
      @update-merge-options="handleFinalStageMergeOptionsUpdate"
    />

    <AssetWorkbenchDialogs
      :project-aspect-ratio="projectAspectRatio"
      :character-regenerate-dialog-open="characterRegenerateDialogOpen"
      :character-regenerate-prompt="characterRegeneratePrompt"
      :character-regenerate-error="characterRegenerateError"
      :character-regenerate-target="characterRegenerateTarget"
      :set-character-regenerate-dialog-open="setCharacterRegenerateDialogOpen"
      :set-character-regenerate-prompt="setCharacterRegeneratePrompt"
      :submit-character-regeneration="submitCharacterRegeneration"
      :environment-regenerate-dialog-open="environmentRegenerateDialogOpen"
      :environment-regenerate-prompt="environmentRegeneratePrompt"
      :environment-regenerate-error="environmentRegenerateError"
      :environment-regenerate-target="environmentRegenerateTarget"
      :environment-regenerate-loading="environmentRegenerateDialogLoading"
      :set-environment-regenerate-dialog-open="setEnvironmentRegenerateDialogOpen"
      :set-environment-regenerate-prompt="setEnvironmentRegeneratePrompt"
      :submit-environment-regeneration="submitEnvironmentRegeneration"
      :environment-crop-dialog-open="environmentCropDialogOpen"
      :environment-crop-error="environmentCropError"
      :environment-crop-target="environmentCropTarget"
      :environment-crop-source-image="environmentCropSourceImage"
      :environment-crop-source-aspect-ratio="environmentPanoramaSourceAspectRatio"
      :environment-crop-initial-selection="environmentCropInitialSelection"
      :environment-crop-initial-capture-mode="environmentCropInitialCaptureMode"
      :environment-crop-aspect-ratio="ENVIRONMENT_REFERENCE_ASPECT_RATIO"
      :environment-crop-saving="environmentCropSaving"
      :set-environment-crop-dialog-open="setEnvironmentCropDialogOpen"
      :submit-environment-crop-selection="submitEnvironmentCropSelection"
      :scene-edit-dialog-open="sceneEditDialogOpen"
      :set-scene-edit-dialog-open="setSceneEditDialogState"
      :editing-scene="editingScene"
      :scene-edit-asset-reference-options="sceneEditAssetReferenceOptions"
      :scene-edit-selected-asset-ids="sceneEditSelectedAssetIds"
      :all-assets="allAssets"
      :resolve-asset-mention-token-map="resolveAssetMentionTokenMap"
      :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
      :handle-scene-save="handleSceneSave"
      :handle-scene-asset-references-save="handleSceneAssetReferencesSave"
      :upload-scene-edit-other-assets="uploadSceneEditOtherAssets"
      :asset-history-dialog-open="assetHistoryDialogOpen"
      :set-asset-history-dialog-open="setAssetHistoryDialogOpen"
      :asset-history-dialog-title="assetHistoryDialogTitle"
      :asset-history-target-type="assetHistoryTargetType"
      :asset-history-target-label="assetHistoryTargetLabel"
      :asset-history-current-image="assetHistoryCurrentImage"
      :asset-history-entries="assetHistoryEntries"
      :asset-history-applying="assetHistoryApplying"
      :handle-asset-history-select="handleAssetHistorySelect"
      :scene-video-history-dialog-open="sceneVideoHistoryDialogOpen"
      :set-scene-video-history-dialog-open="setSceneVideoHistoryDialogOpen"
      :scene-video-history-target-label="sceneVideoHistoryTargetLabel"
      :scene-video-history-current-video-url="sceneVideoHistoryCurrentVideoUrl"
      :scene-video-history-entries="sceneVideoHistoryEntries"
      :scene-video-history-applying="sceneVideoHistoryApplying"
      :handle-scene-video-history-select="handleSceneVideoHistorySelect"
      :open-image-preview="openImagePreview"
      :image-preview-open="imagePreviewOpen"
      :set-image-preview-open="setImagePreviewState"
      :image-preview-src="imagePreviewSrc"
      :image-preview-alt="imagePreviewAlt"
    />

    <SettingsTextInputDialog
      :open="characterVariantDialogOpen"
      :title="characterVariantDialogTitle"
      label="变体名称"
      placeholder="现代形态"
      confirm-text="创建变体"
      :busy="characterVariantSubmitting"
      :error="characterVariantError || ''"
      @update:open="setCharacterVariantDialogOpen"
      @confirm="submitCharacterVariant"
    />

    <AssetWorkbenchArkVirtualAssetSelectDialog
      v-model:open="arkAssetSelectDialogOpen"
      :character-name="arkAssetSelectCharacter?.name"
      :current-asset-id="arkAssetSelectCharacter?.arkAsset?.assetId"
      @select="handleCharacterArkAssetSelect"
    />
  </div>
</template>
