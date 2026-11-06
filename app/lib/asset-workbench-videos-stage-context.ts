import { inject, provide, type InjectionKey } from 'vue'
import type { ScriptParseMode } from '#shared/types/script'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type { ParseProgressDisplayState } from '~/lib/asset-workbench-parse-progress'
import type {
  DisplayAsset,
  QueueSummary,
  SceneChatMentionCandidate,
  SceneChatMessage,
  SceneDescriptionMentionItem,
  SceneDescriptionRenderSegment,
  SceneVideoBadge,
  SceneVoiceReferenceSummary
} from '~/lib/asset-workbench-types'

export interface EpisodePlanItemForVideoStage {
  id: string
  title: string
  index: number
  startOffset: number
  endOffset: number
  charCount: number
  episodeHook?: string
  humiliationOrThreat?: string
  reversalPoint?: string
  emotionalCurve?: string
  cliffhanger?: string
  payoffType?: string
  episodeAssets?: {
    characters?: Array<{ name: string }>
    props?: Array<{ name: string }>
    environments?: Array<{ location: string }>
  }
}

export interface ShotReview {
  videoUrl: string
  status: 'running' | 'passed' | 'issues' | 'repairing' | 'error'
  summary: string
  issues: Array<{ severity: string, reason: string, suggestion: string }>
  unverified: string[]
}

/**
 * Everything the videos stage reads and does, provided by the workbench page.
 * Replaces ~75 props passed through the page template.
 */
export interface VideosStageState {
  canExport?: boolean
  scenes: SceneData[]
  projectName: string
  projectAspectRatio: string
  scriptParseMode?: ScriptParseMode
  episodePlan: EpisodePlanItemForVideoStage[]
  episodeOverviews?: Record<string, string>
  selectedSceneId: string
  /** Read-only projects can still browse scenes, preview and (with export permission) download. */
  readOnly?: boolean
  selectedScene: SceneData | null
  shotReviews: Record<string, ShotReview>
  reviewRepairDrafts: Record<string, { before: string, description: string, videoUrl: string }>
  queueSummary: QueueSummary
  autoRunning: boolean
  parsing: boolean
  parseProgress?: ParseProgressDisplayState
  sceneChatOpenSceneId: string | null
  sceneChatCurrentMessages: SceneChatMessage[]
  sceneChatComposerAssets: DisplayAsset[]
  sceneChatComposerText: string
  sceneChatMentionOpen: boolean
  sceneChatMentionCandidates: SceneChatMentionCandidate[]
  sceneChatMentionActiveIndex: number
  sceneChatUploading: boolean
  sceneChatApplying: boolean
  sceneChatError: string | null
  sceneChatCanSubmit: boolean
  resolveScenePreviousLastFrameReferenceEnabled: (sceneId: string) => boolean
  resolveSceneContinuityLinkReason: (sceneId: string) => string
  canUsePreviousLastFrameReference: (sceneId: string) => boolean
  exportingScriptDocx: boolean
  resolveSceneVideoBadge: (scene: SceneData) => SceneVideoBadge
  resolveSceneVoiceReferenceSummary: (scene: SceneData) => SceneVoiceReferenceSummary
  resolveSceneDescriptionRenderSegments: (scene: SceneData) => SceneDescriptionRenderSegment[]
  resolveSceneDescriptionSecondaryMentionItems: (scene: SceneData) => SceneDescriptionMentionItem[]
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  resolveSceneEnvironmentReferenceImageForMode: (
    scene: SceneData,
    mode: '单视角' | '四视角'
  ) => string | undefined
  sceneEnvironmentAssetOptions: Array<{
    id: string
    label: string
    hasReference: boolean
    previewImage?: string
  }>
  resolveSceneEnvironmentReferenceAssetSelection: (sceneId: string) => string
  resolveSceneNarrationVoiceOptions: (scene: SceneData) => Array<{
    assetId: string
    name: string
    locked: boolean
    source: 'manual' | 'auto'
  }>
  resolveSceneNarrationVoiceReferenceSelection: (sceneId: string) => string
  supportsNarrationVoiceReference: boolean
  isSceneBusy: (scene: SceneData) => boolean
  isScenePreparing: (scene: SceneData) => boolean
  canMergeSceneByIndex: (index: number) => boolean
  normalizeWorkflowText: (value: string) => string
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  setSceneChatInputRef: (element: unknown) => void
  setSceneChatMentionListRef: (element: unknown) => void
  setSceneChatComposerText: (value: string) => void
}

export interface VideosStageActions {
  exportFormattedScriptDocx: () => void
  goToParse?: () => void
  parseEpisode: (episodeId: string) => void | Promise<void>
  selectScene: (sceneId: string) => void
  openSceneEdit: (scene: SceneData) => void
  toggleSceneChat: (scene: SceneData) => void
  handleSplitScene: (sceneId: string) => void
  handleMergeWithNextScene: (sceneId: string) => void
  handleDeleteScene: (scene: SceneData) => void
  generateSceneBaseline: (sceneId: string) => void
  retryScene: (sceneId: string) => void
  openDirector: (sceneId: string) => void
  retryShotReview: (sceneId: string) => void
  repairShotFromReview: (sceneId: string) => void | Promise<void>
  confirmReviewRepairVideo: (sceneId: string) => void | Promise<void>
  applySubtitleErasure: (scene: Partial<SceneData> & { id: string }) => Promise<void>
  openSceneVideoHistory: (sceneId: string) => void
  setScenePreviousLastFrameReference: (sceneId: string, enabled: boolean) => void
  setSceneEnvironmentCaptureMode: (sceneId: string, mode: '单视角' | '四视角') => void
  setSceneEnvironmentReferenceAsset: (sceneId: string, assetId: string) => void | Promise<void>
  setSceneNarrationVoiceReference: (sceneId: string, assetId: string) => void | Promise<void>
  previewImage: (src: string | undefined, alt: string) => void
  closeSceneChat: () => void
  handleSceneChatComposerInput: () => void
  handleSceneChatComposerCursor: () => void
  handleSceneChatComposerKeydown: (event: KeyboardEvent) => void
  applySceneChatMention: (candidate: SceneChatMentionCandidate) => void
  removeSceneChatComposerAsset: (assetId: string) => void
  handleSceneChatImageUpload: (event: Event) => void
  submitSceneChat: (sceneId: string) => void
  selectSceneDescriptionVersion: (sceneId: string, versionId: string) => void
}

export interface VideosStageContext {
  /** Reactive: read fields directly (refs are unwrapped). */
  state: VideosStageState
  actions: VideosStageActions
}

const videosStageContextKey: InjectionKey<VideosStageContext> = Symbol('asset-workbench-videos-stage')

export function provideVideosStageContext(context: VideosStageContext) {
  provide(videosStageContextKey, context)
}

export function useVideosStageContext(): VideosStageContext {
  const context = inject(videosStageContextKey, null)
  if (!context) throw new Error('VideosStage must be rendered inside the asset workbench page')
  return context
}
