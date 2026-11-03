import { inject, provide, type InjectionKey } from 'vue'
import type { LibraryAsset } from '#shared/types/library'
import type { CharacterData } from '~/composables/useAssetWorkbench'
import type {
  PropAsset,
  PropAssetCategory,
  PropAssetMediaType
} from '~/composables/useAssetWorkflowMeta'
import type {
  AutoStageKey,
  AssetTab,
  EnvironmentAssetCard,
  EnvironmentCropCaptureMode
} from '~/lib/asset-workbench-types'

/**
 * Everything the assets stage reads and does, provided by the workbench page.
 * Replaces ~30 props and ~35 events passed through the page template.
 */
export interface AssetsStageState {
  toolbarActive?: boolean
  scenesCount: number
  characters: CharacterData[]
  environmentAssetCards: EnvironmentAssetCard[]
  propAssets: PropAsset[]
  autoRunning: boolean
  readOnly?: boolean
  canSaveToLibrary?: boolean
  savingLibraryAssetKey?: string | null
  parseStageLabel?: string
  characterReadyCount: number
  characterGeneratingCount: number
  characterMissingCount: number
  editingCharacterId: string | null
  characterEditDraft: {
    id: string
    name: string
    appearance: string
    role: string
  }
  uploadingCharacterId: string | null
  uploadingArkCharacterId: string | null
  uploadingCharacterVoiceId: string | null
  uploadingEnvironmentAssetId: string | null
  uploadingPropId: string | null
  uploadingPropVoiceId: string | null
  uploadingPropVideoId?: string | null
  /** 当前分镜视频模型是否支持视频参考；null 表示未知 */
  videoReferenceSupported?: boolean | null
  generatingPropId: string | null
  getCharacterSceneCount: (character: CharacterData) => number
  getEnvironmentSceneSummary: (asset: EnvironmentAssetCard) => string
  getEnvironmentMotherCandidates: (asset: EnvironmentAssetCard) => Array<{ id: string, label: string }>
  getEnvironmentSelectedMotherId: (assetId: string) => string | undefined
  hasEnvironmentRepresentativeScene: (assetId: string) => boolean
  getPropUsageCount: (propId: string) => number
  setCharacterEditDraft: (draft: { name: string, role: string, appearance: string }) => void
}

export interface AssetsStageActions {
  addCharacter: () => void
  removeCharacter: (characterId: string) => void
  selectStage: (stage: AutoStageKey) => void
  previewImage: (payload: { src: string | undefined, alt: string }) => void
  startCharacterEdit: (character: CharacterData) => void
  addCharacterVariant: (character: CharacterData) => void
  removeCharacterVariant: (characterId: string) => void
  cancelCharacterEdit: () => void
  saveCharacterEdit: () => void
  saveCharacterEditRegenerate: () => void
  generateCharacter: (characterId: string) => void
  openCharacterRegenerate: (character: CharacterData) => void
  openCharacterHistory: (characterId: string) => void
  uploadCharacterImage: (payload: { characterId: string, event: Event }) => void
  ingestCharacterArkAsset: (characterId: string) => void
  selectCharacterArkAsset: (character: CharacterData) => void
  uploadCharacterVoice: (payload: { characterId: string, event: Event }) => void
  updateCharacterVoiceLock: (payload: { characterId: string, locked: boolean }) => void
  editEnvironmentScene: (assetId: string) => void
  uploadEnvironmentImage: (payload: { assetId: string, event: Event }) => void
  openEnvironmentCrop: (payload: { assetId: string, captureMode: EnvironmentCropCaptureMode }) => void
  openEnvironmentRegenerate: (assetId: string) => void
  openEnvironmentHistory: (assetId: string) => void
  regenerateEnvironment: (assetId: string) => void
  updateEnvironmentMother: (payload: { assetId: string, motherAssetId: string }) => void
  addProp: (payload: {
    name: string
    description: string
    category: PropAssetCategory
    mediaType?: PropAssetMediaType
  }) => void
  removeProp: (propId: string) => void
  generateProp: (propId: string) => void
  uploadPropImage: (payload: { propId: string, event: Event }) => void
  uploadPropVoice: (payload: { propId: string, event: Event }) => void
  uploadPropVideo: (payload: { propId: string, event: Event }) => void
  updatePropVoiceLock: (payload: { propId: string, locked: boolean }) => void
  openPropHistory: (propId: string) => void
  importLibraryAsset: (payload: { asset: LibraryAsset, targetId?: string, createNew: boolean, tab: AssetTab }) => void
  saveAssetsToLibrary: (tab: AssetTab) => void
  saveAssetToLibrary: (payload: { tab: AssetTab, targetId: string }) => void
}

export interface AssetsStageContext {
  /** Reactive: read fields directly (refs are unwrapped). */
  state: AssetsStageState
  actions: AssetsStageActions
}

const assetsStageContextKey: InjectionKey<AssetsStageContext> = Symbol('asset-workbench-assets-stage')

export function provideAssetsStageContext(context: AssetsStageContext) {
  provide(assetsStageContextKey, context)
}

export function useAssetsStageContext(): AssetsStageContext {
  const context = inject(assetsStageContextKey, null)
  if (!context) throw new Error('AssetsStage must be rendered inside the asset workbench page')
  return context
}
