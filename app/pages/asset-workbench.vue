<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type {
  AutoStageKey,
  AssetImageHistoryEntry,
  AssetVideoHistoryEntry,
  CharacterRoleOption,
  EnvironmentCropSelection,
  EnvironmentPanoramaState,
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
  normalizeCropSelection,
  renderCropSelectionToDataUrl
} from '~/lib/asset-workbench-environment-panorama'
import {
  applyAutomaticAssetPlan as buildAutomaticAssetPlan
} from '~/lib/asset-workbench-auto-plan'
import { findCharacterByAssetRefId } from '~/lib/asset-workbench-scene-references'
import {
  invalidateSceneGenerationState,
  invalidateSceneVideoState
} from '~/lib/asset-workbench-scenes'
import {
  resolveSceneEnvironmentAssetId
} from '~/lib/asset-workbench-environment'
import {
  AUTO_STAGE_HINTS,
  buildAutoStages
} from '~/lib/asset-workbench-progress'
import {
  buildSceneMentionDescription,
  resolveSceneDescriptionWithoutAssetMentions
} from '~/lib/asset-workbench-mentions'
import { resolveChatUploadAssetName } from '~/lib/asset-workbench-scene-chat'
import { applySceneBaselineReference } from '~/lib/asset-workbench-scene-generation'
import { uploadAssetImage, uploadImageFile } from '~/lib/asset-workbench-upload'

// 资产一致性工作流页面
definePageMeta({
  layout: 'default'
})

const route = useRoute()
const router = useRouter()
const { notifyGenerationCompleted } = useGenerationCompletionNotification()
const { resolveStyleById, loadStylePresets } = useStylePresets()
void loadStylePresets()

const MAX_ASSET_UPLOAD_SIZE = 20 * 1024 * 1024
const MAX_VOICE_UPLOAD_SIZE = 30 * 1024 * 1024
const supportsExplicitVoiceAudioReference = ref(false)

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
          }>
        }>
      }
    }>('/api/models/workflow')

    const workflows = response.data?.workflows || []
    const videoWorkflow = workflows.find(item => item.id === 'video_generation')
    const selectedModel = videoWorkflow?.selectedModel || ''
    const selectedProvider = videoWorkflow?.compatibleModels?.find(item => item.model === selectedModel)?.provider
    supportsExplicitVoiceAudioReference.value = selectedProvider === 'qwen'
  } catch (error) {
    console.warn('[asset-workbench] 读取视频模型能力失败，默认关闭显式音频引用标记:', error)
    supportsExplicitVoiceAudioReference.value = false
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
  selectedStyleId,
  novelText,
  scenes,
  characters,
  parsing,
  parsedTimelineText,
  saveError,
  saveProject,
  loadProject,
  deleteScene,
  mergeWithNextScene,
  parseScript,
  splitScene,
  updateScene,
  generateCharacter: generateCharacterCore,
  mergeAllVideos,
  mergeStatus,
  finalVideo,
  refreshCharacterVoiceAssets,
  resolveProjectStatus
} = useAssetWorkbench()

const selectedSceneId = ref<string>('')

const sceneConfigs = ref<Record<string, SceneConsistencyConfig>>({})
const propAssets = ref<PropAsset[]>([])
const environmentAssetHistories = ref<Record<string, AssetImageHistoryEntry[]>>({})
const environmentPanoramaStates = ref<Record<string, EnvironmentPanoramaState>>({})

const batchRunning = ref(false)
const queueItems = ref<QueueItem[]>([])
const sceneEditDialogOpen = ref(false)
const editingScene = ref<SceneData | null>(null)

const characterRoleOptions: CharacterRoleOption[] = [
  { value: 'protagonist', label: '主角' },
  { value: 'antagonist', label: '反派' },
  { value: 'supporting', label: '配角' },
  { value: 'extra', label: '群演' }
]

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
  assetsPrimaryActionLabel,
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
  propAssets,
  environmentAssetHistories,
  environmentPanoramaStates,
  sceneConfigs,
  selectedSceneId,
  selectedStyleId,
  projectStyleId,
  supportsExplicitVoiceAudioReference,
  queueItems,
  resolveStyleById,
  resolveSceneDescriptionWithoutAssetMentions,
  uniqueSorted
})

const {
  workflowMetaReady,
  hydratingWorkflowMeta,
  loadWorkflowMeta,
  saveWorkflowMeta,
  scheduleWorkflowMetaSave
} = useAssetWorkflowMeta({
  projectId,
  scenes,
  characters,
  sceneConfigs,
  propAssets,
  environmentAssetHistories,
  environmentPanoramaStates,
  finalVideo,
  resolveProjectStatus,
  onHydrated: () => {
    synchronizeSceneConfigs()
    synchronizeQueueItems()
  }
})

function synchronizeSceneDescriptionsWithAssetMentions(): boolean {
  const tokenMap = resolveAssetMentionTokenMap()
  let changed = false

  for (const scene of scenes.value) {
    const config = sceneConfigs.value[scene.id]
    if (!config) continue

    const mentionTokens = uniqueSorted(config.mustReferenceAssetIds)
      .map(assetId => tokenMap.get(assetId) || '')
      .filter(Boolean)

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
  const message = error instanceof Error ? error.message : fallback
  return normalizeWorkflowText(message || fallback)
}

function recordCharacterHistory(
  characterId: string,
  image: string | undefined,
  options: {
    source: 'generated' | 'uploaded' | 'legacy'
    prompt?: string
  }
) {
  const character = characters.value.find(item => item.id === characterId)
  if (!character) return

  character.assetHistory = ensureAssetHistoryEntry(character.assetHistory, image, {
    source: options.source,
    prompt: options.prompt,
    createdAt: new Date().toISOString()
  })
}

function recordEnvironmentHistory(
  assetId: string,
  image: string,
  options: {
    source?: 'generated' | 'uploaded' | 'cropped' | 'legacy'
    prompt?: string
  } = {}
) {
  environmentAssetHistories.value = {
    ...environmentAssetHistories.value,
    [assetId]: ensureAssetHistoryEntry(environmentAssetHistories.value[assetId], image, {
      source: options.source,
      prompt: options.prompt,
      createdAt: new Date().toISOString()
    })
  }
}

function resolveEnvironmentPanoramaState(assetId: string): EnvironmentPanoramaState | undefined {
  return environmentPanoramaStates.value[assetId]
}

function setEnvironmentPanoramaState(
  assetId: string,
  state: EnvironmentPanoramaState | undefined
) {
  const hasPayload = !!state?.panoramaImage?.trim() || !!state?.crop
  const nextStates = { ...environmentPanoramaStates.value }

  if (!hasPayload) {
    if (!(assetId in nextStates)) return
    const { [assetId]: _removed, ...remainingStates } = nextStates
    environmentPanoramaStates.value = remainingStates
    return
  }

  nextStates[assetId] = {
    panoramaImage: state?.panoramaImage?.trim() || undefined,
    crop: state?.crop
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
  const assetId = resolveSceneEnvironmentAssetId(scene)
  return resolveEnvironmentPanoramaState(assetId)?.panoramaImage?.trim()
    || resolveSceneReferenceImage(scene)
    || scene.firstFrame
}

async function createEnvironmentCropImage(options: {
  assetId: string
  sourceImage: string
  crop?: EnvironmentCropSelection
}) {
  const metrics = await loadCropImageMetrics(options.sourceImage)
  const crop = normalizeCropSelection(
    options.crop,
    metrics.width,
    metrics.height
  ) || buildDefaultCropSelection({
    imageWidth: metrics.width,
    imageHeight: metrics.height
  })

  const imageData = await renderCropSelectionToDataUrl({
    sourceImage: options.sourceImage,
    selection: crop
  })
  const imageUrl = await uploadAssetImage(imageData, buildEnvironmentCropUploadPrefix(options.assetId))

  return {
    imageUrl,
    crop
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

    applySceneBaselineReference(scene, imageUrl)
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
    workflowType?: 'asset_consistency'
    regenerationPrompt?: string
    referenceImage?: string
  },
  options: {
    persistHistory?: boolean
  } = {}
) {
  const previousImage = character.baseImage?.trim() || ''

  await generateCharacterCore(character, input)

  const nextImage = character.baseImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  recordCharacterHistory(character.id, nextImage, {
    source: 'generated',
    prompt: input?.regenerationPrompt?.trim() || undefined
  })

  if (options.persistHistory !== false) {
    await saveWorkflowMeta()
  }
}

async function batchGenerateCharacters(
  onProgress?: (current: number, total: number, name: string) => void,
  input?: { workflowType?: 'asset_consistency' }
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
      await generateCharacter(character, input, { persistHistory: false })
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
  startEditCharacter,
  updateCharacterEditDraft,
  cancelEditCharacter,
  handleGenerateCharacter,
  saveCharacterEdit,
  openCharacterRegenerateDialog,
  setCharacterRegenerateDialogOpen,
  setCharacterRegeneratePrompt,
  submitCharacterRegeneration
} = useAssetWorkbenchCharacterActions({
  characters,
  scenes,
  saveProject,
  generateCharacter,
  resolveUiError
})

const {
  resolveCharacterSceneCount,
  resolvePropUsageCount,
  synchronizeSceneConfigs,
  ensureSceneConfig,
  resolveAssetName,
  resolveSceneReferenceAssetIds,
  setSceneAssetReferences,
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
  isSceneBusy
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
  projectAspectRatio,
  normalizeWorkflowText,
  resolveUiError,
  ensureSceneConfig,
  resolveAssetName,
  resolveSceneDescriptionWithoutAssetMentions,
  synchronizeQueueItems,
  saveProject,
  refreshCharacterVoiceAssets,
  generateCharacter,
  batchGenerateCharacters,
  persistAutomaticAssetPlan,
  recordEnvironmentHistory,
  resolveEnvironmentPanoramaState,
  setEnvironmentPanoramaState,
  createEnvironmentCropImage,
  resolveSceneBaselineReferenceImage,
  recordSceneVideoHistory,
  onModelTaskCompleted: notifyGenerationCompleted
})

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
    resolveSceneEnvironmentAssetId,
    resolveSceneDescriptionWithoutAssetMentions
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
  const autoPlanResult = applyAutomaticAssetPlan(options)
  const descriptionMentionChanged = synchronizeSceneDescriptionsWithAssetMentions()

  if (
    autoPlanResult.characterChanged
    || autoPlanResult.generationInvalidated
    || descriptionMentionChanged
  ) {
    await saveProject()
  }
  if (autoPlanResult.configChanged) {
    await saveWorkflowMeta()
  }

  return {
    ...autoPlanResult,
    descriptionMentionChanged
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
    continuityNotes: config?.continuityNotes?.trim() || ''
  })
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

const {
  autoRunning,
  autoRunError,
  autoRunCurrentStage,
  activeAutoStage,
  selectAutoStage,
  handleParseScript,
  copyParsedTimelineText,
  runSimpleAssetsStep,
  runSimpleVideosStep,
  runSimpleFinalStep
} = useAssetWorkbenchAutoFlow({
  route,
  router,
  projectId,
  projectAssetWorkflow,
  selectedStyleId,
  projectStyleId,
  selectedSceneId,
  workflowStylePrompt,
  novelText,
  scenes,
  parsedTimelineText,
  queueSummary,
  assetsReady,
  finalVideo,
  resolveUiError,
  parseScript,
  mergeAllVideos,
  loadProject,
  loadWorkflowMeta,
  saveWorkflowMeta,
  persistAutomaticAssetPlan,
  synchronizeSceneConfigs,
  synchronizeQueueItems,
  ensureCharacterAssetsReady,
  runBatchSceneGeneration,
  retryFailedQueueItemsOnce
})

const autoStages = computed(() => {
  const videosDone = queueSummary.value.total > 0
    && queueSummary.value.done === queueSummary.value.total

  return buildAutoStages({
    hasScenes: scenes.value.length > 0,
    assetsReady: assetsReady.value,
    videosDone,
    finalDone: !!finalVideo.value?.videoUrl,
    autoRunning: autoRunning.value,
    autoRunCurrentStage: autoRunCurrentStage.value
  })
})

const stageHints = AUTO_STAGE_HINTS

const {
  imagePreviewOpen,
  imagePreviewSrc,
  imagePreviewAlt,
  environmentRegenerateDialogOpen,
  environmentRegeneratePrompt,
  environmentRegenerateError,
  environmentRegenerateTarget,
  uploadingCharacterId,
  uploadingCharacterVoiceId,
  uploadingEnvironmentAssetId,
  uploadingPropId,
  openImagePreview,
  handleCharacterImageUpload: handleCharacterImageUploadCore,
  handleCharacterVoiceUpload,
  handleCharacterVoiceLockChange,
  handleEnvironmentImageUpload: handleEnvironmentImageUploadCore,
  handlePropImageUpload: handlePropImageUploadCore,
  openEnvironmentRegenerateDialog,
  setEnvironmentRegenerateDialogOpen,
  setEnvironmentRegeneratePrompt,
  submitEnvironmentRegeneration
} = useAssetWorkbenchAssetMedia({
  maxAssetUploadSize: MAX_ASSET_UPLOAD_SIZE,
  maxVoiceUploadSize: MAX_VOICE_UPLOAD_SIZE,
  statusError: autoRunError,
  scenes,
  characters,
  propAssets,
  saveProject,
  saveWorkflowMeta,
  resolveUiError,
  synchronizeQueueItems,
  resolveSceneReferenceImage,
  resolveEnvironmentCard,
  resolveEnvironmentRepresentativeScene,
  setEnvironmentPanoramaState,
  generateSceneBaseline
})

const environmentCropDialogOpen = ref(false)
const environmentCropTargetId = ref<string | null>(null)
const environmentCropSaving = ref(false)
const environmentCropError = ref<string | null>(null)

watch(environmentCropDialogOpen, (open) => {
  if (open) return
  environmentCropTargetId.value = null
  environmentCropError.value = null
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

function openEnvironmentCropDialog(assetId: string) {
  const asset = resolveEnvironmentCard(assetId)
  if (!asset?.panoramaImage?.trim() && !asset?.referenceImage?.trim()) {
    alert('请先生成或上传环境图，再选取截图区域')
    return
  }

  environmentCropTargetId.value = assetId
  environmentCropError.value = null
  environmentCropDialogOpen.value = true
}

function setEnvironmentCropDialogOpen(open: boolean) {
  environmentCropDialogOpen.value = open
  if (!open) {
    environmentCropTargetId.value = null
    environmentCropError.value = null
  }
}

async function submitEnvironmentCropSelection(selection: EnvironmentCropSelection) {
  const target = environmentCropTarget.value
  const sourceImage = environmentCropSourceImage.value
  if (!target || !sourceImage) return

  environmentCropSaving.value = true
  environmentCropError.value = null

  try {
    const result = await createEnvironmentCropImage({
      assetId: target.id,
      sourceImage,
      crop: selection
    })

    await applyEnvironmentReferenceImage(target.id, result.imageUrl, {
      panoramaImage: target.panoramaImage?.trim() || sourceImage,
      crop: result.crop
    })
    recordEnvironmentHistory(target.id, result.imageUrl, { source: 'cropped' })
    await saveWorkflowMeta()
    setEnvironmentCropDialogOpen(false)
  } catch (error) {
    environmentCropError.value = resolveUiError(error, '环境截图区域保存失败')
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

      await applyEnvironmentReferenceImage(target.id, nextImage, {
        panoramaImage: nextImage
      })
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

  const nextImage = target?.baseImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  recordCharacterHistory(characterId, nextImage, { source: 'uploaded' })
  await saveWorkflowMeta()
}

async function handleEnvironmentImageUpload(assetId: string, event: Event) {
  const previousImage = resolveEnvironmentCard(assetId)?.referenceImage?.trim() || ''

  await handleEnvironmentImageUploadCore(assetId, event)

  const nextImage = resolveEnvironmentCard(assetId)?.referenceImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  recordEnvironmentHistory(assetId, nextImage, { source: 'uploaded' })
  await saveWorkflowMeta()
}

async function handlePropImageUpload(propId: string, event: Event) {
  const target = propAssets.value.find(item => item.id === propId)
  const previousImage = target?.referenceImage?.trim() || ''

  await handlePropImageUploadCore(propId, event)

  const nextImage = target?.referenceImage?.trim() || ''
  if (!nextImage || nextImage === previousImage) return

  recordPropHistory(propId, nextImage, { source: 'uploaded' })
  await saveWorkflowMeta()
}

async function uploadSceneEditOtherAssets(options: {
  sceneId: string
  files: File[]
  names?: string[]
}): Promise<string[]> {
  const sceneId = options.sceneId?.trim()
  if (!sceneId) {
    throw new Error('场景ID无效，无法上传资产')
  }

  const files = Array.isArray(options.files) ? options.files : []
  const names = Array.isArray(options.names) ? options.names : []
  if (files.length === 0) return []

  const createdAssetIds: string[] = []
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
        referenceImage: imageUrl
      })
      recordPropHistory(propId, imageUrl, { source: 'uploaded' })
      createdAssetIds.push(`prop:${propId}`)
    }

    await saveWorkflowMeta()
    return createdAssetIds
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
  onModelTaskCompleted: notifyGenerationCompleted
})

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
  const targetScene = resolveEnvironmentRepresentativeScene(assetId)
  if (!targetScene) return
  await generateSceneBaseline(targetScene.id)
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

async function handleBatchGenerateCharacters() {
  await batchGenerateCharacters(undefined, {
    workflowType: 'asset_consistency'
  })
}
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden p-3 flex flex-col gap-2">
    <AssetWorkbenchHeaderBar
      :project-name="projectName"
      :project-description="projectDescription"
      :selected-style-id="selectedStyleId"
      :project-style-id="projectStyleId"
      :project-aspect-ratio="projectAspectRatio"
      :stages="autoStages"
      :active-stage="activeAutoStage"
      :auto-run-error="autoRunError"
      :save-error="saveError"
      @back="router.push('/projects')"
      @select-stage="(stage) => selectAutoStage(stage as AutoStageKey)"
    />

    <AssetWorkbenchParseStage
      v-if="activeAutoStage === 'parse'"
      v-model:novel-text="novelText"
      :parsing="parsing"
      :parsed-timeline-text="parsedTimelineText"
      :scenes-count="scenes.length"
      :characters-count="characters.length"
      :hint="stageHints.parse"
      @copy-timeline="copyParsedTimelineText"
      @parse="handleParseScript"
    />

    <AssetWorkbenchStagePanel
      v-else-if="activeAutoStage === 'assets'"
    >
      <AssetWorkbenchAssetsStage
        :scenes-count="scenes.length"
        :characters="characters"
        :environment-asset-cards="environmentAssetCards"
        :prop-assets="propAssets"
        :auto-running="autoRunning"
        :auto-run-current-stage="autoRunCurrentStage"
        :character-ready-count="characterReadyCount"
        :character-generating-count="characterGeneratingCount"
        :character-missing-count="characterMissingCount"
        :assets-primary-action-label="assetsPrimaryActionLabel"
        :editing-character-id="editingCharacterId"
        :character-edit-draft="characterEditDraft"
        :character-role-options="characterRoleOptions"
        :uploading-character-id="uploadingCharacterId"
        :uploading-character-voice-id="uploadingCharacterVoiceId"
        :uploading-environment-asset-id="uploadingEnvironmentAssetId"
        :uploading-prop-id="uploadingPropId"
        :get-character-scene-count="resolveCharacterSceneCount"
        :get-environment-scene-summary="resolveEnvironmentSceneSummary"
        :has-environment-representative-scene="hasEnvironmentRepresentativeScene"
        :get-prop-usage-count="resolvePropUsageCount"
        :set-character-edit-draft="updateCharacterEditDraft"
        @run-assets="runSimpleAssetsStep"
        @generate-characters="handleBatchGenerateCharacters"
        @select-stage="(stage) => selectAutoStage(stage as AutoStageKey)"
        @preview-image="openImagePreview($event.src, $event.alt)"
        @start-character-edit="startEditCharacter"
        @cancel-character-edit="cancelEditCharacter"
        @save-character-edit="saveCharacterEdit()"
        @save-character-edit-regenerate="saveCharacterEdit({ regenerate: true })"
        @generate-character="handleGenerateCharacter"
        @open-character-regenerate="openCharacterRegenerateDialog"
        @open-character-history="openCharacterHistory"
        @upload-character-image="handleCharacterImageUpload($event.characterId, $event.event)"
        @upload-character-voice="handleCharacterVoiceUpload($event.characterId, $event.event)"
        @update-character-voice-lock="handleCharacterVoiceLockChange($event.characterId, $event.locked)"
        @edit-environment-scene="openEnvironmentAssetSceneEditor"
        @upload-environment-image="handleEnvironmentImageUpload($event.assetId, $event.event)"
        @open-environment-crop="openEnvironmentCropDialog"
        @open-environment-regenerate="openEnvironmentRegenerateDialog"
        @open-environment-history="openEnvironmentHistory"
        @regenerate-environment="regenerateEnvironmentAsset"
        @add-prop="addPropAsset"
        @remove-prop="removePropAsset"
        @upload-prop-image="handlePropImageUpload($event.propId, $event.event)"
        @open-prop-history="openPropHistory"
      />
    </AssetWorkbenchStagePanel>

    <AssetWorkbenchStagePanel
      v-else-if="activeAutoStage === 'videos'"
    >
      <AssetWorkbenchVideosStage
        :scenes="scenes"
        :selected-scene-id="selectedSceneId"
        :selected-scene="selectedScene"
        :queue-summary="queueSummary"
        :auto-running="autoRunning"
        :auto-run-current-stage="autoRunCurrentStage"
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
        :resolve-scene-video-badge="resolveSceneVideoBadge"
        :resolve-scene-voice-reference-summary="resolveSceneVoiceReferenceSummary"
        :resolve-scene-description-render-segments="resolveSceneDescriptionRenderSegments"
        :resolve-scene-description-secondary-mention-items="resolveSceneDescriptionSecondaryMentionItems"
        :resolve-scene-reference-image="resolveSceneReferenceImage"
        :is-scene-busy="isSceneBusy"
        :is-scene-preparing="isScenePreparing"
        :can-merge-scene-by-index="canMergeSceneByIndex"
        :resolve-display-asset-by-id="resolveDisplayAssetById"
        :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
        :set-scene-chat-input-ref="setSceneChatInputRef"
        :set-scene-chat-mention-list-ref="setSceneChatMentionListRef"
        :set-scene-chat-composer-text="setSceneChatComposerText"
        :on-run-videos-step="runSimpleVideosStep"
        :on-retry-failed-queue-items="retryFailedQueueItemsOnce"
        :on-select-scene="selectScene"
        :on-open-scene-edit="openSceneEdit"
        :on-toggle-scene-chat="toggleSceneChat"
        :on-handle-split-scene="handleSplitScene"
        :on-handle-merge-with-next-scene="handleMergeWithNextScene"
        :on-handle-delete-scene="handleDeleteScene"
        :on-generate-scene-baseline="generateSceneBaseline"
        :on-retry-scene="retryScene"
        :on-open-scene-video-history="openSceneVideoHistory"
        :on-preview-image="openImagePreview"
        :on-close-scene-chat="closeSceneChat"
        :on-handle-scene-chat-composer-input="handleSceneChatComposerInput"
        :on-handle-scene-chat-composer-cursor="handleSceneChatComposerCursor"
        :on-handle-scene-chat-composer-keydown="handleSceneChatComposerKeydown"
        :on-apply-scene-chat-mention="applySceneChatMention"
        :on-remove-scene-chat-composer-asset="removeSceneChatComposerAsset"
        :on-handle-scene-chat-image-upload="handleSceneChatImageUpload"
        :on-submit-scene-chat="submitSceneChat"
        :normalize-workflow-text="normalizeWorkflowText"
      />
    </AssetWorkbenchStagePanel>

    <AssetWorkbenchFinalStage
      v-else
      :hint="stageHints.final"
      :queue-done="queueSummary.done"
      :auto-running="autoRunning"
      :auto-run-current-stage="autoRunCurrentStage"
      :merge-running="mergeStatus.running"
      :final-video-url="finalVideo?.videoUrl"
      @run-final="runSimpleFinalStep"
    />

    <AssetWorkbenchDialogs
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
      :set-environment-regenerate-dialog-open="setEnvironmentRegenerateDialogOpen"
      :set-environment-regenerate-prompt="setEnvironmentRegeneratePrompt"
      :submit-environment-regeneration="submitEnvironmentRegeneration"
      :environment-crop-dialog-open="environmentCropDialogOpen"
      :environment-crop-error="environmentCropError"
      :environment-crop-target="environmentCropTarget"
      :environment-crop-source-image="environmentCropSourceImage"
      :environment-crop-initial-selection="environmentCropInitialSelection"
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
  </div>
</template>
