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
  AssetTab,
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
import { invalidateSceneGenerationState, invalidateSceneVideoState } from '~/lib/asset-workbench-scenes'
import {
  buildSceneMentionDescription,
  extractSceneDescriptionMentionTokens,
  resolveSceneDescriptionWithoutAssetMentions
} from '~/lib/asset-workbench-mentions'
import type { GenerateSceneBaselineOptions } from '~/lib/asset-workbench-scene-generation'
import { applyArkVirtualAssetBinding } from '~/lib/ark-virtual-assets'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'
import { requestSceneChatDescriptionRewrite } from '~/lib/asset-workbench-scene-chat'
import { Sparkles, X } from 'lucide-vue-next'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { SheetContent } from '@/components/ui/sheet'
import type { ShotReview } from '~/lib/asset-workbench-videos-stage-context'
import { evaluateVideoReviewMetadata } from '~/lib/video-review-frames'
import { actionableReviewIssues, buildVideoReviewRepairInstruction } from '~/lib/video-review-repair'

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
type AssistantAssetType = 'character' | 'environment' | 'prop' | 'other'
const assistantAssetTab = ref<AssetTab>('characters')
const focusedAssistantAsset = ref<{ type: AssistantAssetType, id: string } | null>(null)
const directorMode = ref<'scene' | 'asset'>('scene')
const directorAssetId = ref('')
const assistantAssetOptions = computed(() => {
  if (assistantAssetTab.value === 'characters') return characters.value.map(item => ({ id: item.id, name: item.name, type: 'character' as const }))
  if (assistantAssetTab.value === 'environments') return environmentAssetCards.value.map(item => ({ id: item.id, name: item.name, type: 'environment' as const }))
  return propAssets.value
    .filter(item => assistantAssetTab.value === 'others' ? item.category === 'other' : item.category !== 'other')
    .map(item => ({ id: item.id, name: item.name, type: (item.category === 'other' ? 'other' : 'prop') as 'other' | 'prop' }))
})
const directorAsset = computed(() => assistantAssetOptions.value.find(item => item.id === directorAssetId.value))
const directorAssetSupportsImageEdit = computed(() => {
  if (!directorAsset.value) return false
  if (directorAsset.value.type === 'character' || directorAsset.value.type === 'environment') return true
  const asset = propAssets.value.find(item => item.id === directorAssetId.value)
  return !asset?.mediaType || asset.mediaType === 'image'
})
const directorAssetPlaceholder = computed(() => {
  if (directorAsset.value?.type === 'environment') return '例如：保持建筑布局，把时间改成雨夜，路面增加倒影'
  if (directorAsset.value?.type === 'prop' || directorAsset.value?.type === 'other') return '例如：保留轮廓，把表面改得更旧，增加使用痕迹'
  return '例如：保留角色身份和服装，把表情改得更克制'
})
const assistantContextLabel = computed(() => {
  if (activeAutoStage.value === 'videos') return selectedScene.value?.title || '当前分镜'
  if (activeAutoStage.value === 'assets') {
    const focused = assistantAssetOptions.value.find(item => item.id === focusedAssistantAsset.value?.id)
    return focused?.name || ({ characters: '角色资产', environments: '环境资产', props: '道具资产', others: '其他素材' }[assistantAssetTab.value])
  }
  return '当前项目'
})
const directorOpen = ref(false)
const directorInstruction = ref('')
const directorScope = ref<'scene' | 'episode' | 'project'>('scene')
const directorBusy = ref(false)
const directorError = ref('')
const directorDrafts = ref<Array<{ id: string, title: string, before: string, after: string }>>([])
const shotReviews = ref<Record<string, ShotReview>>({})
const reviewRunning = ref(false)
const autoRepairReviews = ref(true)
const automaticRepairAttempts = ref<Record<string, number>>({})
const repairingShotIds = ref<Record<string, boolean>>({})
const directorTargets = computed(() => {
  const selected = scenes.value.find(scene => scene.id === selectedSceneId.value) || scenes.value[0]
  if (!selected) return []
  if (directorScope.value === 'scene') return [selected]
  if (directorScope.value === 'episode') return scenes.value.filter(scene => scene.episodeId === selected.episodeId)
  return scenes.value
})
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

async function previewDirectorChange() {
  const instruction = directorInstruction.value.trim()
  if (!canEditProject.value || !instruction || !projectId.value) return
  directorBusy.value = true
  directorError.value = ''
  directorDrafts.value = []
  try {
    const drafts = [] as typeof directorDrafts.value
    for (const scene of directorTargets.value) {
      const after = await requestSceneChatDescriptionRewrite({
        projectId: projectId.value,
        scene,
        userMessage: instruction,
        history: [],
        mentionedAssets: [],
        workflowStylePrompt: workflowStylePrompt.value,
        buildAssetWorkflowScenePayload
      })
      if (after !== scene.description) drafts.push({ id: scene.id, title: scene.title, before: scene.description, after })
    }
    directorDrafts.value = drafts
  } catch (error) {
    directorError.value = getDisplayErrorMessage(error, 'AI 修改预览失败')
  } finally {
    directorBusy.value = false
  }
}

async function applyDirectorChange() {
  if (!canEditProject.value || directorBusy.value || directorDrafts.value.length === 0) return
  directorBusy.value = true
  directorError.value = ''
  try {
    for (const draft of directorDrafts.value) {
      const scene = scenes.value.find(item => item.id === draft.id)
      if (!scene || scene.description !== draft.before) throw new Error(`分镜「${draft.title}」已发生变化，请重新预览`)
    }
    for (const draft of directorDrafts.value) {
      const scene = scenes.value.find(item => item.id === draft.id)!
      scene.descriptionHistory = [
        ...(scene.descriptionHistory || []),
        { id: `director_${Date.now()}_${scene.id}`, description: draft.before, createdAt: Date.now(), label: 'AI 修改前' }
      ].slice(-20)
      scene.description = draft.after
      invalidateSceneGenerationState(scene)
    }
    await saveProject()
    toast.success(`已更新 ${directorDrafts.value.length} 个分镜，请在视频阶段重生成受影响片段`)
    directorDrafts.value = []
    directorOpen.value = false
    selectAutoStage('videos')
  } catch (error) {
    directorError.value = getDisplayErrorMessage(error, '应用 AI 修改失败')
  } finally {
    directorBusy.value = false
  }
}

async function applyAssistantAssetInstruction() {
  const target = directorAsset.value
  const instruction = directorInstruction.value.trim()
  if (!canEditProject.value || !target || !instruction || directorBusy.value) return
  directorBusy.value = true
  directorError.value = ''
  try {
    if (target.type === 'character') {
      const character = characters.value.find(item => item.id === target.id)
      if (!character?.baseImage) throw new Error('请先生成该角色的基础参考图')
      openCharacterRegenerateDialog(character)
      setCharacterRegeneratePrompt(instruction)
      directorOpen.value = false
      await submitCharacterRegeneration()
    } else if (target.type === 'environment') {
      const environment = environmentAssetCards.value.find(item => item.id === target.id)
      if (!environment?.referenceImage && !environment?.panoramaImage) throw new Error('请先生成该环境的基础参考图')
      openEnvironmentRegenerateDialog(target.id)
      setEnvironmentRegeneratePrompt(instruction)
      directorOpen.value = false
      await submitEnvironmentRegeneration()
    } else {
      const asset = propAssets.value.find(item => item.id === target.id)
      if (!asset || (asset.mediaType && asset.mediaType !== 'image')) throw new Error('当前素材不是图片，请在分镜中指定它的使用方式')
      asset.description = `${asset.description.trim()}\n修改要求：${instruction}`.trim()
      await saveWorkflowMeta()
      directorOpen.value = false
      await handleGeneratePropImage(asset.id)
    }
  } catch (error) {
    directorOpen.value = true
    directorError.value = getDisplayErrorMessage(error, '资产修改失败')
  } finally {
    directorBusy.value = false
  }
}

async function reviewShot(scene: SceneData) {
  if (!projectId.value || !scene.videoUrl || reviewRunning.value) return
  reviewRunning.value = true
  const videoUrl = scene.videoUrl
  let shouldAutoRepair = false
  shotReviews.value[scene.id] = { videoUrl, status: 'running', summary: '正在抽帧并审片', issues: [], unverified: [] }
  try {
    const index = scenes.value.findIndex(item => item.id === scene.id)
    const response = await $fetch<{ success: boolean, actualDuration: number, dimensions: string, data: { passed: boolean, summary: string, issues: ShotReview['issues'], unverified: string[] } }>('/api/asset-workflow/video/review', {
      method: 'POST',
      body: {
        projectId: projectId.value,
        videoUrl,
        scene: { title: scene.title, description: scene.description, characters: scene.characters, duration: scene.duration, setting: scene.setting },
        neighbors: { previous: scenes.value[index - 1]?.description, next: scenes.value[index + 1]?.description }
      }
    })
    if (scene.videoUrl !== videoUrl) return
    const issues = Array.isArray(response.data.issues) ? response.data.issues : []
    shouldAutoRepair = autoRepairReviews.value
      && (automaticRepairAttempts.value[scene.id] || 0) < 1
      && actionableReviewIssues(issues).length > 0
    issues.push(...evaluateVideoReviewMetadata(response, scene.duration, projectAspectRatio.value))
    shotReviews.value[scene.id] = { videoUrl, status: issues.length || !response.data.passed ? 'issues' : 'passed', summary: response.data.summary || '审片完成', issues, unverified: Array.isArray(response.data.unverified) ? response.data.unverified : [] }
  } catch (error) {
    if (scene.videoUrl === videoUrl) shotReviews.value[scene.id] = { videoUrl, status: 'error', summary: getDisplayErrorMessage(error, '审片失败，请检查可看图模型配置'), issues: [], unverified: [] }
  } finally {
    reviewRunning.value = false
    if (shouldAutoRepair) void repairShotFromReview(scene.id, true)
    void reviewPendingShots()
  }
}

async function repairShotFromReview(sceneId: string, automatic = false) {
  const scene = scenes.value.find(item => item.id === sceneId)
  const review = shotReviews.value[sceneId]
  if (!canEditProject.value || !projectId.value || !scene || !review || !['issues', 'error'].includes(review.status) || repairingShotIds.value[sceneId]) return
  const instruction = buildVideoReviewRepairInstruction(review.issues, scene.duration)
  if (!instruction) return
  if (automatic) automaticRepairAttempts.value[sceneId] = (automaticRepairAttempts.value[sceneId] || 0) + 1
  repairingShotIds.value[sceneId] = true
  shotReviews.value[sceneId] = { ...review, status: 'repairing', summary: automatic ? '正在自动修正提示词并重生成' : '正在按审片建议修正提示词并重生成' }
  try {
    const before = scene.description
    const rewritten = await requestSceneChatDescriptionRewrite({
      projectId: projectId.value,
      scene,
      userMessage: instruction,
      history: [],
      mentionedAssets: [],
      workflowStylePrompt: workflowStylePrompt.value,
      buildAssetWorkflowScenePayload
    })
    if (scene.description !== before || scene.videoUrl !== review.videoUrl) throw new Error('分镜已被其他操作修改，请重新审片')
    if (rewritten === before) throw new Error('AI 未产生有效的分镜修改，请人工复核审片建议')
    scene.descriptionHistory = [
      ...(scene.descriptionHistory || []),
      { id: `review_repair_${Date.now()}_${scene.id}`, description: before, createdAt: Date.now(), label: '审片修复前' }
    ].slice(-20)
    scene.description = rewritten
    invalidateSceneVideoState(scene)
    if (!await saveProject()) throw new Error('保存修复后的分镜描述失败，未启动重生成')
    await retryScene(scene.id)
    if (scene.videoStatus !== 'done' || !scene.videoUrl || scene.videoUrl === review.videoUrl) {
      throw new Error(scene.videoError || '重生成未得到新的视频，请在分镜任务中查看原因')
    }
    // 新视频地址变化后，现有 watcher 会自动触发复审。
  } catch (error) {
    shotReviews.value[sceneId] = { ...review, status: 'error', summary: getDisplayErrorMessage(error, '审片修复失败'), issues: review.issues }
  } finally {
    delete repairingShotIds.value[sceneId]
  }
}

async function reviewPendingShots() {
  if (!canEditProject.value || reviewRunning.value) return
  const next = scenes.value.find(scene => scene.videoStatus === 'done' && scene.videoUrl && shotReviews.value[scene.id]?.videoUrl !== scene.videoUrl)
  if (next) await reviewShot(next)
}

function retryShotReview(sceneId: string) {
  delete shotReviews.value[sceneId]
  void reviewPendingShots()
}

function openDirector(sceneId: string) {
  directorMode.value = 'scene'
  selectedSceneId.value = sceneId
  directorScope.value = 'scene'
  directorDrafts.value = []
  directorError.value = ''
  directorOpen.value = true
}

watch(() => scenes.value.map(scene => `${scene.id}:${scene.videoStatus}:${scene.videoUrl || ''}`).join('|'), () => { void reviewPendingShots() }, { immediate: true })
watch(canEditProject, () => { void reviewPendingShots() })

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
  () => scenes.value.map(scene => ({ id: scene.id, episodeId: scene.episodeId, episodeIndex: scene.episodeIndex })),
  (currentScenes, previousScenes) => {
    const previousSelection = previousScenes?.find(scene => scene.id === selectedSceneId.value)
    if (previousSelection && !currentScenes.some(scene => scene.id === previousSelection.id)) {
      const replacement = currentScenes.find(scene => previousSelection.episodeId
        ? scene.episodeId === previousSelection.episodeId
        : scene.episodeIndex === previousSelection.episodeIndex)
      if (replacement) selectedSceneId.value = replacement.id
    }
    synchronizeSceneConfigs()
    synchronizeQueueItems()
    syncSceneChatValidScenes(currentScenes.map(scene => scene.id))
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
    setAssistantAssetTab: (tab) => {
      assistantAssetTab.value = tab
      focusedAssistantAsset.value = null
    },
    focusAssistantAsset: (type, id) => {
      if (focusedAssistantAsset.value?.type !== type || focusedAssistantAsset.value.id !== id) focusedAssistantAsset.value = { type, id }
    },
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
    shotReviews,
    autoRepairReviews,
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
    openDirector,
    retryShotReview,
    repairShotFromReview,
    setAutoRepairReviews: (enabled: boolean) => { autoRepairReviews.value = enabled },
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

    <Dialog v-model:open="directorOpen">
      <SheetContent class="w-[min(92vw,460px)] max-w-none gap-0 p-0">
      <div class="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div class="min-w-0">
          <DialogTitle class="text-base font-semibold">对话修改</DialogTitle>
          <p class="mt-1 truncate text-xs text-muted-foreground">{{ directorMode === 'asset' ? (directorAsset?.name || assistantContextLabel) : (selectedScene?.title || '当前分镜') }} · {{ directorMode === 'asset' ? '修改当前资产' : '先预览，再应用修改' }}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" class="h-8 w-8 shrink-0" aria-label="关闭对话修改" @click="directorOpen = false"><X class="h-4 w-4" /></Button>
      </div>
      <section class="min-h-0 flex-1 space-y-3 overflow-y-auto p-5" aria-label="对话修改剧集">
      <div v-if="directorMode === 'asset'" class="space-y-3">
        <div class="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          已识别当前{{ { characters: '角色', environments: '环境', props: '道具', others: '其他素材' }[assistantAssetTab] }}页面。选择具体资产后，指令会用于该资产的图片重生成。
        </div>
        <label class="block space-y-1 text-xs font-medium">
          <span>修改对象</span>
          <select v-model="directorAssetId" class="h-9 w-full rounded-md border bg-background px-2" aria-label="修改对象">
            <option value="">请选择资产</option>
            <option v-for="asset in assistantAssetOptions" :key="asset.id" :value="asset.id">{{ asset.name }}</option>
          </select>
        </label>
        <Textarea v-model="directorInstruction" class="min-h-28 text-sm" :placeholder="directorAssetPlaceholder" />
        <p v-if="directorAssetId && !directorAssetSupportsImageEdit" class="text-xs text-muted-foreground">当前是声音或视频素材。请在分镜中描述它的使用方式；此入口只修改图片资产。</p>
        <p v-if="directorError" class="text-xs text-destructive" role="alert">{{ directorError }}</p>
        <Button class="w-full" :disabled="directorBusy || !directorAssetSupportsImageEdit || !directorInstruction.trim()" @click="applyAssistantAssetInstruction">{{ directorBusy ? '正在修改资产…' : '按指令重生成资产' }}</Button>
      </div>
      <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <Sparkles class="h-4 w-4 text-primary" />
        <strong class="text-sm">告诉 AI 想改什么</strong>
        <select v-model="directorScope" class="ml-auto h-8 rounded-md border bg-background px-2 text-xs" aria-label="修改范围" @change="directorDrafts = []">
          <option value="scene">当前分镜</option>
          <option value="episode">当前集</option>
          <option value="project">整个项目</option>
        </select>
        <span class="text-xs text-muted-foreground">预计影响 {{ directorTargets.length }} 个分镜</span>
      </div>
      <Textarea v-model="directorInstruction" class="mt-2 min-h-16 text-sm" placeholder="例如：把当前集的追逐戏改成雨夜，保持角色服装和剧情不变" @input="directorDrafts = []" />
      <div class="mt-2 flex items-center gap-2">
        <Button size="sm" :disabled="directorBusy || !directorInstruction.trim()" @click="previewDirectorChange">{{ directorBusy ? '正在生成修改方案…' : '预览修改方案' }}</Button>
        <Button v-if="directorDrafts.length" size="sm" variant="secondary" :disabled="directorBusy" @click="applyDirectorChange">应用到 {{ directorDrafts.length }} 个分镜</Button>
        <Button size="sm" variant="ghost" @click="directorOpen = false">关闭</Button>
      </div>
      <p v-if="directorError" class="mt-2 text-xs text-destructive" role="alert">{{ directorError }}</p>
      <div v-if="directorDrafts.length" class="mt-3 space-y-2 border-t pt-3">
        <details v-for="draft in directorDrafts" :key="draft.id" class="rounded-md bg-muted/40 p-2 text-xs">
          <summary class="cursor-pointer font-medium">{{ draft.title }} · 描述将更新，原视频需重生成</summary>
          <p class="mt-2 whitespace-pre-wrap text-muted-foreground">{{ draft.after }}</p>
        </details>
      </div>
      </template>
      </section>
      </SheetContent>
    </Dialog>

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
