<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { PropAsset, SceneConsistencyConfig } from '~/composables/useAssetWorkflowMeta'
import type {
  AutoStageKey,
  CharacterRoleOption,
  QueueItem
} from '~/lib/asset-workbench-types'
import { createPropAssetId } from '~/lib/asset-workbench-types'
import {
  getValidAssetIdSet,
  resolveCharacterRefsFromScene
} from '~/lib/asset-workbench-reference-detection'
import {
  normalizeToken,
  uniqueSorted
} from '~/lib/asset-workbench-strings'
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

// 资产一致性工作流页面
definePageMeta({
  layout: 'default'
})

const route = useRoute()
const router = useRouter()
const { resolveStyleById, loadStylePresets } = useStylePresets()
void loadStylePresets()

const MAX_ASSET_UPLOAD_SIZE = 20 * 1024 * 1024
const MAX_VOICE_UPLOAD_SIZE = 30 * 1024 * 1024

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
  generateCharacter,
  batchGenerateCharacters,
  mergeAllVideos,
  mergeStatus,
  finalVideo,
  refreshCharacterVoiceAssets,
  resolveProjectStatus
} = useAssetWorkbench()

const selectedSceneId = ref<string>('')

const sceneConfigs = ref<Record<string, SceneConsistencyConfig>>({})
const propAssets = ref<PropAsset[]>([])

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
  sceneConfigs,
  selectedSceneId,
  selectedStyleId,
  projectStyleId,
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
  sceneConfigs,
  propAssets,
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
  persistAutomaticAssetPlan
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
  handleCharacterImageUpload,
  handleCharacterVoiceUpload,
  handleCharacterVoiceLockChange,
  handleEnvironmentImageUpload,
  handlePropImageUpload,
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
  generateSceneBaseline
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
  saveProject
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
        @upload-character-image="handleCharacterImageUpload($event.characterId, $event.event)"
        @upload-character-voice="handleCharacterVoiceUpload($event.characterId, $event.event)"
        @update-character-voice-lock="handleCharacterVoiceLockChange($event.characterId, $event.locked)"
        @edit-environment-scene="openEnvironmentAssetSceneEditor"
        @upload-environment-image="handleEnvironmentImageUpload($event.assetId, $event.event)"
        @open-environment-regenerate="openEnvironmentRegenerateDialog"
        @regenerate-environment="regenerateEnvironmentAsset"
        @add-prop="addPropAsset"
        @remove-prop="removePropAsset"
        @upload-prop-image="handlePropImageUpload($event.propId, $event.event)"
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
      :scene-edit-dialog-open="sceneEditDialogOpen"
      :set-scene-edit-dialog-open="setSceneEditDialogState"
      :editing-scene="editingScene"
      :scene-edit-asset-reference-options="sceneEditAssetReferenceOptions"
      :scene-edit-selected-asset-ids="sceneEditSelectedAssetIds"
      :handle-scene-save="handleSceneSave"
      :handle-scene-asset-references-save="handleSceneAssetReferencesSave"
      :image-preview-open="imagePreviewOpen"
      :set-image-preview-open="setImagePreviewState"
      :image-preview-src="imagePreviewSrc"
      :image-preview-alt="imagePreviewAlt"
    />
  </div>
</template>
