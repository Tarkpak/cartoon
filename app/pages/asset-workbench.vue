<script setup lang="ts">
import ProjectEditSessionBanner from '@/components/projects/ProjectEditSessionBanner.vue'
import ProjectMembersDialog from '@/components/projects/ProjectMembersDialog.vue'
import ProjectCollaboratorsMenu from '@/components/projects/ProjectCollaboratorsMenu.vue'
import ProjectConflictDialog from '@/components/projects/ProjectConflictDialog.vue'
import { useAssetWorkbenchArkBindings } from '~/composables/useAssetWorkbenchArkBindings'
import { useAssetWorkbenchAssetHistory } from '~/composables/useAssetWorkbenchAssetHistory'
import { useAssetWorkbenchAssetUploads } from '~/composables/useAssetWorkbenchAssetUploads'
import { useAssetWorkbenchAutoAssetPlan } from '~/composables/useAssetWorkbenchAutoAssetPlan'
import { useAssetWorkbenchCharacterGeneration } from '~/composables/useAssetWorkbenchCharacterGeneration'
import { useAssetWorkbenchDependencyInvalidation } from '~/composables/useAssetWorkbenchDependencyInvalidation'
import { useAssetWorkbenchEnvironmentAssets } from '~/composables/useAssetWorkbenchEnvironmentAssets'
import { useAssetWorkbenchEnvironmentCrop } from '~/composables/useAssetWorkbenchEnvironmentCrop'
import { useAssetWorkbenchEnvironmentGeneration } from '~/composables/useAssetWorkbenchEnvironmentGeneration'
import { useAssetWorkbenchEnvironmentReferences } from '~/composables/useAssetWorkbenchEnvironmentReferences'
import { useAssetWorkbenchEpisodeParsing } from '~/composables/useAssetWorkbenchEpisodeParsing'
import { useAssetWorkbenchExport } from '~/composables/useAssetWorkbenchExport'
import { useAssetWorkbenchFinalStageOptions } from '~/composables/useAssetWorkbenchFinalStageOptions'
import { useAssetWorkbenchHistoryDialogs } from '~/composables/useAssetWorkbenchHistoryDialogs'
import { useAssetWorkbenchLibrary } from '~/composables/useAssetWorkbenchLibrary'
import { useAssetWorkbenchModelCapabilities } from '~/composables/useAssetWorkbenchModelCapabilities'
import { useAssetWorkbenchNovelTextAutoSave } from '~/composables/useAssetWorkbenchNovelTextAutoSave'
import { useAssetWorkbenchSceneReferenceOptions } from '~/composables/useAssetWorkbenchSceneReferenceOptions'
import { useAssetWorkbenchStageProgress } from '~/composables/useAssetWorkbenchStageProgress'
import { useAssetWorkbenchVoiceAssets } from '~/composables/useAssetWorkbenchVoiceAssets'
import { useAssetWorkbenchWorkflowMetaAutoSave } from '~/composables/useAssetWorkbenchWorkflowMetaAutoSave'
import { buildEpisodeOverviews } from '~/lib/asset-workbench-episode-overview'
import { provideAssetsStageContext } from '~/lib/asset-workbench-assets-stage-context'
import { provideVideosStageContext } from '~/lib/asset-workbench-videos-stage-context'
import { hasWindowsTitlebarControls } from '~/lib/desktop-titlebar'
import { projectAccessCan } from '#shared/types/project'
import type { CharacterData, SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type {
  AutoStageKey,
  AssetImageHistoryEntry,
  ArkVirtualAssetBinding,
  EnvironmentAssetCard,
  EnvironmentPanoramaState,
  FinalMergeOptions,
  QueueItem
} from '~/lib/asset-workbench-types'
import { createPropAssetId } from '~/lib/asset-workbench-types'
import { getValidAssetIdSet } from '~/lib/asset-workbench-reference-detection'
import {
  normalizeToken,
  uniqueSorted
} from '~/lib/asset-workbench-strings'
import { findCharacterByAssetRefId } from '~/lib/asset-workbench-scene-references'
import { invalidateSceneGenerationState } from '~/lib/asset-workbench-scenes'
import {
  buildSceneMentionDescription,
  extractSceneDescriptionMentionTokens,
  resolveSceneDescriptionWithoutAssetMentions
} from '~/lib/asset-workbench-mentions'
import type { GenerateSceneBaselineOptions } from '~/lib/asset-workbench-scene-generation'
import { applyArkVirtualAssetBinding } from '~/lib/ark-virtual-assets'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

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
const {
  supportsExplicitVoiceAudioReference,
  supportsVideoReference,
  environmentPanoramaSourceAspectRatio
} = useAssetWorkbenchModelCapabilities()

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
  projectAccess,
  projectEditable,
  editSession,
  acquiringEditSession,
  requestProjectEditing,
  downloadEditBackup,
  collaborationMergePreview,
  collaborationParticipants,
  updateCollaborationActivity,
  cancelProjectMerge,
  applyProjectMerge,
  acknowledgeWorkflowNormalization,
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

const { confirm } = useConfirm()
const canEditProject = computed(() => projectEditable.value && (!projectAccess.value || projectAccessCan(projectAccess.value, 'edit')))
const canExportProject = computed(() => !projectAccess.value || projectAccessCan(projectAccess.value, 'export'))
const readOnlyHint = computed(() => {
  if (!projectAccess.value || projectAccessCan(projectAccess.value, 'edit') || acquiringEditSession.value) return null
  return `当前以只读权限打开项目。你可以查看内容${canExportProject.value ? '并导出结果' : ''}，修改和生成操作已受限。`
})
const projectMembersOpen = ref(false)

const selectedSceneId = ref<string>('')
useAssetWorkbenchArkBindings({ characters, loading, projectId, saveProject })

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

const { refreshSceneVoiceAssets } = useAssetWorkbenchVoiceAssets({ projectId, characters, propAssets })

const arkAssetSelectCharacter = computed(() => {
  return characters.value.find(character => character.id === arkAssetSelectCharacterId.value)
})
const editingScene = ref<SceneData | null>(null)
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
  assetPreparationSummary,
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
  onNormalized: acknowledgeWorkflowNormalization,
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

const {
  recordCharacterHistory,
  recordEnvironmentHistory,
  recordPropHistory,
  recordSceneVideoHistory
} = useAssetWorkbenchAssetHistory({ scenes, characters, propAssets, environmentAssetHistories })

const {
  resolveEnvironmentPanoramaState,
  resolveEnvironmentHistoryImageByView,
  setEnvironmentPanoramaState,
  resolveSceneBaselineReferenceImage,
  resolveSceneEnvironmentReferenceImageForMode,
  createEnvironmentCropImage,
  applyEnvironmentReferenceImage
} = useAssetWorkbenchEnvironmentReferences({
  projectId,
  scenes,
  sceneConfigs,
  environmentPanoramaStates,
  referenceAspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
  panoramaSourceAspectRatio: environmentPanoramaSourceAspectRatio,
  resolveEnvironmentCard,
  resolveSceneReferenceImage,
  synchronizeQueueItems,
  saveProject
})

const {
  displayEnvironmentAssetCards,
  setEnvironmentAssetGenerationState,
  resolveEnvironmentAssetReferenceImage,
  resolveEnvironmentMotherCandidates,
  resolveEnvironmentSelectedMotherId,
  resolveEnvironmentSelectedMotherReferenceImage,
  handleEnvironmentMotherSelection
} = useAssetWorkbenchEnvironmentAssets({
  environmentAssetCards,
  environmentAssetGenerationStates,
  environmentMotherAssetSelections,
  resolveEnvironmentCard,
  resolveEnvironmentPanoramaState
})

const {
  sceneEnvironmentAssetOptions,
  resolveSceneEnvironmentReferenceAssetSelection,
  resolveSceneNarrationVoiceOptions,
  resolveSceneNarrationVoiceReferenceSelection
} = useAssetWorkbenchSceneReferenceOptions({
  scenes,
  sceneConfigs,
  propAssets,
  displayEnvironmentAssetCards,
  resolveEnvironmentCard,
  resolveEnvironmentAssetReferenceImage
})

const {
  generateCharacter,
  batchGenerateCharacters
} = useAssetWorkbenchCharacterGeneration({
  characters,
  generateCharacterCore,
  recordCharacterHistory,
  saveProject,
  saveWorkflowMeta,
  // Defined further down by useAssetWorkbenchAssetMedia; only called after setup.
  ingestCharacterToArkVirtualAsset: (characterId, options) => ingestCharacterToArkVirtualAsset(characterId, options)
})

const {
  editingCharacterId,
  characterCreateDialogOpen,
  characterCreateError,
  characterCreateSubmitting,
  setCharacterCreateDialogOpen,
  submitCharacterCreate,
  removeCharacter,
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

const { invalidateSceneGenerations } = useAssetWorkbenchDependencyInvalidation({
  scenes,
  characters,
  propAssets,
  sceneConfigs,
  workflowMetaReady,
  hydratingWorkflowMeta,
  synchronizeQueueItems,
  saveProject
})

const {
  clearParsedSceneStateForEpisodePlanChange,
  prepareEpisodePlanWithAssetHydration,
  applyAutomaticAssetPlan,
  persistAutomaticAssetPlan
} = useAssetWorkbenchAutoAssetPlan({
  scenes,
  characters,
  propAssets,
  environmentAssets,
  episodePlan,
  sceneConfigs,
  queueItems,
  finalVideo,
  selectedSceneId,
  workflowMetaReady,
  hydratingWorkflowMeta,
  ensureSceneConfig,
  prepareEpisodePlan,
  saveProject,
  saveWorkflowMeta,
  synchronizeQueueItems,
  synchronizeSceneDescriptionsWithAssetMentions,
  invalidateSceneGenerations,
  resolveSceneConfigGenerationKey
})

const {
  buildAssetWorkflowScenePayload,
  generateSceneBaseline,
  ensureCharacterAssetsReady,
  runBatchSceneGeneration,
  retryScene,
  retryScenes,
  retryFailedQueueItemsOnce,
  resumeActiveSceneVideoTasks
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

// 项目加载完成后，接着等待刷新前仍在后端进行的分镜视频任务
watch(loading, (isLoading, wasLoading) => {
  if (isLoading || !wasLoading) return
  if (!projectId.value || !canEditProject.value || editSession.value.collaboration) return
  void resumeActiveSceneVideoTasks()
})

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

const {
  finalStageScenes,
  handleFinalStageSceneOrderUpdate,
  handleFinalStageMergeOptionsUpdate
} = useAssetWorkbenchFinalStageOptions({
  scenes,
  finalStageSceneOrder,
  finalStageMergeOptions,
  resolveSceneReferenceImage,
  scheduleWorkflowMetaSave
})

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
  hasEpisodePlan: computed(() => episodePlan.value.some(episode => !episode.id.startsWith('legacy-unassigned'))),
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

const {
  handlePrepareEpisodePlan,
  handleParseSingleEpisode
} = useAssetWorkbenchEpisodeParsing({
  novelText,
  scenes,
  episodePlan,
  parsing,
  parseProgress,
  scriptParseMode,
  workflowStylePrompt,
  parseScript,
  prepareEpisodePlanWithAssetHydration,
  persistAutomaticAssetPlan,
  synchronizeSceneConfigs,
  synchronizeQueueItems,
  selectAutoStage,
  resolveUiError
})

const {
  autoStages,
  workbenchTasks,
  openSceneEditWhenEditable,
  openWorkbenchTask,
  retryFailedSceneTasks,
  stageHints,
  parseStageHint
} = useAssetWorkbenchStageProgress({
  scenes,
  characters,
  environmentAssetCards,
  episodePlan,
  queueItems,
  queueSummary,
  finalVideo,
  parsing,
  parseProgress,
  scriptParseMode,
  assetsReady,
  assetPreparationSummary,
  autoRunning,
  autoRunCurrentStage,
  canEditProject,
  selectAutoStage,
  selectScene,
  openSceneEdit,
  retryScenes
})

const episodeOverviewById = computed(() => buildEpisodeOverviews(episodePlan.value, scenes.value))

useAssetWorkbenchNovelTextAutoSave({
  loading,
  saving,
  projectId,
  projectStyleId,
  novelText,
  episodePlan,
  workflowMetaReady,
  hydratingWorkflowMeta,
  canEditProject,
  saveProject,
  saveWorkflowMeta,
  clearParsedSceneStateForEpisodePlanChange
})

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
  uploadingPropVideoId,
  generatingPropId,
  openImagePreview,
  handleCharacterImageUpload: handleCharacterImageUploadCore,
  ingestCharacterToArkVirtualAsset,
  handleCharacterVoiceUpload,
  handleCharacterVoiceLockChange,
  handleEnvironmentImageUpload,
  handlePropImageUpload: handlePropImageUploadCore,
  handlePropVoiceUpload,
  handlePropVideoUpload,
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

const {
  environmentCropDialogOpen,
  environmentCropSaving,
  environmentCropError,
  environmentCropTarget,
  environmentCropSourceImage,
  environmentCropInitialSelection,
  environmentCropInitialCaptureMode,
  openEnvironmentCropDialog,
  setEnvironmentCropDialogOpen,
  submitEnvironmentCropSelection
} = useAssetWorkbenchEnvironmentCrop({
  referenceAspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
  panoramaSourceAspectRatio: environmentPanoramaSourceAspectRatio,
  resolveEnvironmentCard,
  resolveEnvironmentPanoramaState,
  resolveEnvironmentHistoryImageByView,
  createEnvironmentCropImage,
  applyEnvironmentReferenceImage,
  recordEnvironmentHistory,
  saveWorkflowMeta,
  resolveUiError
})
const environmentRegenerateDialogLoading = computed(() => {
  const targetId = environmentRegenerateTarget.value?.id
  if (!targetId) return false

  const state = environmentAssetGenerationStates.value[targetId]
  if (state?.status === 'generating') return true

  return environmentRegenerateTarget.value?.referenceStatus === 'generating'
})

const {
  assetHistoryDialogOpen,
  assetHistoryApplying,
  sceneVideoHistoryDialogOpen,
  sceneVideoHistoryApplying,
  assetHistoryDialogTitle,
  assetHistoryTargetType,
  assetHistoryTargetLabel,
  assetHistoryCurrentImage,
  assetHistoryEntries,
  sceneVideoHistoryTargetLabel,
  sceneVideoHistoryCurrentVideoUrl,
  sceneVideoHistoryEntries,
  setAssetHistoryDialogOpen,
  setSceneVideoHistoryDialogOpen,
  openCharacterHistory,
  openEnvironmentHistory,
  openPropHistory,
  openSceneVideoHistory,
  handleAssetHistorySelect,
  handleSceneVideoHistorySelect
} = useAssetWorkbenchHistoryDialogs({ characters, propAssets, scenes, resolveEnvironmentCard, resolveEnvironmentPanoramaState, applyEnvironmentReferenceImage, saveProject, saveWorkflowMeta, synchronizeQueueItems })

const {
  handleCharacterImageUpload,
  handlePropImageUpload,
  handleGeneratePropImage,
  uploadSceneEditOtherAssets
} = useAssetWorkbenchAssetUploads({
  projectId,
  characters,
  propAssets,
  maxAssetUploadSize: MAX_ASSET_UPLOAD_SIZE,
  handleCharacterImageUploadCore,
  handlePropImageUploadCore,
  generatePropImageCore,
  recordCharacterHistory,
  recordPropHistory,
  saveWorkflowMeta,
  resolveUiError
})

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
  projectId,
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

watch(
  () => scenes.value.map(scene => scene.id),
  (sceneIds) => {
    synchronizeSceneConfigs()
    synchronizeQueueItems()
    syncSceneChatValidScenes(sceneIds)
  },
  { immediate: true }
)

useAssetWorkbenchWorkflowMetaAutoSave({
  scenes,
  characters,
  propAssets,
  sceneConfigs,
  environmentAssetHistories,
  environmentPanoramaStates,
  environmentMotherAssetSelections,
  finalVideo,
  workflowMetaReady,
  hydratingWorkflowMeta,
  scheduleWorkflowMetaSave
})

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

watch(selectedScene, (scene) => {
  if (!scene) {
    selectedSceneId.value = ''
    return
  }

  if (!selectedSceneId.value) {
    selectedSceneId.value = scene.id
  }
})

const {
  regenerateEnvironmentAsset,
  submitEnvironmentRegeneration
} = useAssetWorkbenchEnvironmentGeneration({
  projectId,
  referenceAspectRatio: ENVIRONMENT_REFERENCE_ASPECT_RATIO,
  workflowStylePrompt,
  autoRunError,
  environmentAssetGenerationStates,
  environmentRegenerateTarget,
  environmentRegeneratePrompt,
  environmentRegenerateError,
  setEnvironmentRegenerateDialogOpen,
  submitEnvironmentRegenerationCore,
  setEnvironmentAssetGenerationState,
  setEnvironmentPanoramaState,
  resolveEnvironmentCard,
  resolveEnvironmentPanoramaState,
  resolveEnvironmentAssetReferenceImage,
  resolveEnvironmentRepresentativeScene,
  resolveEnvironmentSelectedMotherReferenceImage,
  resolveAssetByMentionTokenMap,
  resolveDisplayAssetById,
  createEnvironmentCropImage,
  recordEnvironmentHistory,
  handleGenerateSceneBaseline,
  saveWorkflowMeta,
  resolveUiError,
  notifyGenerationCompleted,
  notifyGenerationFailed
})

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

const {
  exportingScriptDocx,
  exportingJianyingProject,
  handleExportJianyingProject,
  handleExportFormattedScriptDocx
} = useAssetWorkbenchExport({ projectId, projectName, projectAspectRatio, scenes, finalStageSceneOrder, finalStageMergeOptions, resolveUiError })

const {
  savingLibraryAssetKey,
  handleImportLibraryAsset,
  handleSaveAssetsToLibrary
} = useAssetWorkbenchLibrary({ projectId, characters, propAssets, displayEnvironmentAssetCards, canExportProject, saveProject, saveWorkflowMeta, resolveUiError, applyEnvironmentReferenceImage, recordCharacterHistory, recordEnvironmentHistory })

async function confirmProjectTakeover() {
  if (await confirm({ title: '接管项目编辑权', description: '当前编辑者将转为只读，未提交修改会保留。确定要接管吗？', confirmText: '接管编辑权' })) {
    await requestProjectEditing(true)
  }
}

function reportWorkbenchActivity() {
  const scene = activeAutoStage.value === 'videos' ? scenes.value.find(item => item.id === selectedSceneId.value) : undefined
  updateCollaborationActivity(scene?.episodeId ? { type: 'episode', id: scene.episodeId } : { type: 'settings', id: 'settings' })
}

// The assets stage reads its state and calls its actions through an injected
// context instead of ~30 props and ~35 events on the template.
provideAssetsStageContext({
  state: reactive({
    toolbarActive: computed(() => activeAutoStage.value === 'assets'),
    readOnly: computed(() => !canEditProject.value),
    canSaveToLibrary: canExportProject,
    scenesCount: computed(() => scenes.value.length),
    characters,
    environmentAssetCards: displayEnvironmentAssetCards,
    propAssets,
    savingLibraryAssetKey,
    autoRunning,
    parseStageLabel: computed(() => scriptParseMode.value === 'origin_explainer' ? '镜头规划' : '剧本解析'),
    characterReadyCount,
    characterGeneratingCount,
    characterMissingCount,
    editingCharacterId,
    characterEditDraft,
    uploadingCharacterId,
    uploadingArkCharacterId,
    uploadingCharacterVoiceId,
    uploadingEnvironmentAssetId,
    uploadingPropId,
    uploadingPropVoiceId,
    uploadingPropVideoId,
    videoReferenceSupported: supportsVideoReference,
    generatingPropId,
    getCharacterSceneCount: resolveCharacterSceneCount,
    getEnvironmentSceneSummary: resolveEnvironmentSceneSummary,
    getEnvironmentMotherCandidates: resolveEnvironmentMotherCandidates,
    getEnvironmentSelectedMotherId: resolveEnvironmentSelectedMotherId,
    hasEnvironmentRepresentativeScene,
    getPropUsageCount: resolvePropUsageCount,
    setCharacterEditDraft: updateCharacterEditDraft
  }),
  actions: {
    selectStage: stage => selectAutoStage(stage),
    previewImage: ({ src, alt }) => openImagePreview(src, alt),
    startCharacterEdit: startEditCharacter,
    addCharacter: () => setCharacterCreateDialogOpen(true),
    removeCharacter,
    addCharacterVariant: openCharacterVariantDialog,
    removeCharacterVariant,
    cancelCharacterEdit: cancelEditCharacter,
    saveCharacterEdit: () => saveCharacterEdit(),
    saveCharacterEditRegenerate: () => saveCharacterEdit({ regenerate: true }),
    generateCharacter: handleGenerateCharacter,
    openCharacterRegenerate: openCharacterRegenerateDialog,
    openCharacterHistory,
    uploadCharacterImage: ({ characterId, event }) => handleCharacterImageUpload(characterId, event),
    ingestCharacterArkAsset: characterId => ingestCharacterToArkVirtualAsset(characterId),
    selectCharacterArkAsset: openCharacterArkAssetSelect,
    uploadCharacterVoice: ({ characterId, event }) => handleCharacterVoiceUpload(characterId, event),
    updateCharacterVoiceLock: ({ characterId, locked }) => handleCharacterVoiceLockChange(characterId, locked),
    editEnvironmentScene: openEnvironmentAssetSceneEditor,
    uploadEnvironmentImage: ({ assetId, event }) => handleEnvironmentImageUpload(assetId, event),
    openEnvironmentCrop: ({ assetId, captureMode }) => openEnvironmentCropDialog(assetId, captureMode),
    openEnvironmentRegenerate: openEnvironmentRegenerateDialog,
    openEnvironmentHistory,
    regenerateEnvironment: regenerateEnvironmentAsset,
    updateEnvironmentMother: handleEnvironmentMotherSelection,
    addProp: addPropAsset,
    removeProp: removePropAsset,
    generateProp: handleGeneratePropImage,
    uploadPropImage: ({ propId, event }) => handlePropImageUpload(propId, event),
    uploadPropVoice: ({ propId, event }) => handlePropVoiceUpload(propId, event),
    uploadPropVideo: ({ propId, event }) => handlePropVideoUpload(propId, event),
    updatePropVoiceLock: ({ propId, locked }) => handlePropVoiceLockChange(propId, locked),
    openPropHistory,
    importLibraryAsset: handleImportLibraryAsset,
    saveAssetsToLibrary: tab => handleSaveAssetsToLibrary(tab),
    saveAssetToLibrary: ({ tab, targetId }) => handleSaveAssetsToLibrary(tab, targetId)
  }
})

// The videos stage gets its ~75 inputs the same way.
provideVideosStageContext({
  state: reactive({
    toolbarActive: computed(() => activeAutoStage.value === 'videos'),
    readOnly: computed(() => !canEditProject.value),
    canExport: canExportProject,
    scenes,
    projectName,
    projectAspectRatio,
    scriptParseMode,
    episodePlan,
    episodeOverviews: episodeOverviewById,
    selectedSceneId,
    selectedScene,
    queueSummary,
    autoRunning,
    parsing,
    parseProgress,
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
    resolveScenePreviousLastFrameReferenceEnabled,
    resolveSceneContinuityLinkReason,
    canUsePreviousLastFrameReference,
    resolveSceneVideoBadge,
    resolveSceneVoiceReferenceSummary,
    resolveSceneDescriptionRenderSegments,
    resolveSceneDescriptionSecondaryMentionItems,
    resolveSceneReferenceImage,
    resolveSceneEnvironmentReferenceImageForMode,
    sceneEnvironmentAssetOptions,
    resolveSceneEnvironmentReferenceAssetSelection,
    resolveSceneNarrationVoiceOptions,
    resolveSceneNarrationVoiceReferenceSelection,
    supportsNarrationVoiceReference: supportsExplicitVoiceAudioReference,
    isSceneBusy,
    isScenePreparing,
    canMergeSceneByIndex,
    resolveDisplayAssetById,
    resolveDisplayAssetTypeLabel,
    setSceneChatInputRef,
    setSceneChatMentionListRef,
    setSceneChatComposerText,
    exportingScriptDocx,
    normalizeWorkflowText
  }),
  actions: {
    exportFormattedScriptDocx: handleExportFormattedScriptDocx,
    goToParse: () => selectAutoStage('parse'),
    parseEpisode: episodeId => handleParseSingleEpisode({ id: episodeId }),
    selectScene,
    openSceneEdit: openSceneEditWhenEditable,
    toggleSceneChat,
    handleSplitScene,
    handleMergeWithNextScene,
    handleDeleteScene,
    generateSceneBaseline: handleGenerateSceneBaseline,
    retryScene,
    applySubtitleErasure: async (scene) => {
      updateScene(scene)
      await saveProject()
    },
    openSceneVideoHistory,
    setScenePreviousLastFrameReference,
    setSceneEnvironmentCaptureMode,
    setSceneEnvironmentReferenceAsset,
    setSceneNarrationVoiceReference,
    previewImage: openImagePreview,
    closeSceneChat,
    handleSceneChatComposerInput,
    handleSceneChatComposerCursor,
    handleSceneChatComposerKeydown,
    applySceneChatMention,
    removeSceneChatComposerAsset,
    handleSceneChatImageUpload,
    submitSceneChat,
    selectSceneDescriptionVersion
  }
})
</script>

<template>
  <div class="h-full min-h-0 overflow-hidden px-3 pb-3 flex flex-col gap-2" :class="hasWindowsTitlebarControls() ? 'pt-2' : 'pt-3'" @input="reportWorkbenchActivity">
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
      :read-only-hint="readOnlyHint"
      @back="router.push('/projects')"
      @select-stage="(stage) => selectAutoStage(stage as AutoStageKey)"
    >
      <template #actions>
        <AssetWorkbenchTaskPanel
          :tasks="workbenchTasks"
          :read-only="!canEditProject"
          @open="openWorkbenchTask"
          @retry-failed-scenes="retryFailedSceneTasks"
        />
        <ProjectEditSessionBanner
          compact
          :session="editSession"
          :busy="acquiringEditSession"
        />
        <ProjectCollaboratorsMenu
          v-if="projectId"
          :session="editSession"
          :participants="collaborationParticipants"
          :can-manage="projectAccessCan(projectAccess, 'manage_members')"
          @manage="projectMembersOpen = true"
        />
      </template>
    </AssetWorkbenchHeaderBar>

    <!-- Only takes a row when the session needs action (locked, offline, conflict). -->
    <ProjectEditSessionBanner
      alert-only
      :session="editSession"
      :participants="collaborationParticipants"
      :busy="acquiringEditSession"
      @retry="requestProjectEditing()"
      @takeover="confirmProjectTakeover"
      @download-backup="downloadEditBackup()"
    />

    <ProjectMembersDialog v-if="projectId" v-model:open="projectMembersOpen" :project-id="projectId" />
    <ProjectConflictDialog :preview="collaborationMergePreview" :busy="saving" :error="saveError" @cancel="cancelProjectMerge" @apply="applyProjectMerge" />

    <AssetWorkbenchParseStage
      v-if="activeAutoStage === 'parse'"
      :read-only="!canEditProject"
      v-model:novel-text="novelText"
      :script-parse-mode="scriptParseMode"
      :parsing="parsing"
      :episode-plan="episodePlan"
      :parse-progress="parseProgress"
      :environment-assets-count="displayEnvironmentAssetCards.length"
      :characters-count="characters.length"
      :hint="parseStageHint"
      @prepare-episodes="handlePrepareEpisodePlan"
      @go-to-videos="selectAutoStage('videos')"
    />

    <!-- Keep the cache mounted across every stage. Leaving assets/videos must
         deactivate the cached child (including its toolbar Teleport), rather
         than destroy the cache while that child is still active. -->
    <AssetWorkbenchStagePanel
      v-show="activeAutoStage === 'assets' || activeAutoStage === 'videos'"
      content-class="flex-1 min-h-0 overflow-hidden flex flex-col gap-2"
    >
      <KeepAlive>
        <AssetWorkbenchAssetsStage
          v-if="activeAutoStage === 'assets'"
          key="assets-stage"
        />

        <AssetWorkbenchVideosStage
          v-else-if="activeAutoStage === 'videos'"
          :key="`videos-stage:${projectId || 'new'}`"
        />
      </KeepAlive>
    </AssetWorkbenchStagePanel>

    <AssetWorkbenchFinalStage
      v-if="activeAutoStage === 'final'"
      :read-only="!canEditProject"
      :can-export="canExportProject"
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
      :open="characterCreateDialogOpen"
      title="新增角色"
      label="角色名称"
      placeholder="角色名称"
      confirm-text="创建角色"
      :busy="characterCreateSubmitting"
      :error="characterCreateError || ''"
      @update:open="setCharacterCreateDialogOpen"
      @confirm="submitCharacterCreate"
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
