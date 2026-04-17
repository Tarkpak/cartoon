<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  AutoStageKey,
  DisplayAsset,
  QueueSummary,
  SceneChatMentionCandidate,
  SceneChatMessage,
  SceneDescriptionMentionItem,
  SceneDescriptionRenderSegment,
  SceneVideoBadge
} from '~/lib/asset-workbench-types'

const props = defineProps<{
  scenes: SceneData[]
  selectedSceneId: string
  selectedScene: SceneData | null
  queueSummary: QueueSummary
  autoRunning: boolean
  autoRunCurrentStage: AutoStageKey | null
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
  resolveSceneVideoBadge: (scene: SceneData) => SceneVideoBadge
  resolveSceneDescriptionRenderSegments: (scene: SceneData) => SceneDescriptionRenderSegment[]
  resolveSceneDescriptionSecondaryMentionItems: (scene: SceneData) => SceneDescriptionMentionItem[]
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  isSceneBusy: (scene: SceneData) => boolean
  isScenePreparing: (scene: SceneData) => boolean
  canMergeSceneByIndex: (index: number) => boolean
  normalizeWorkflowText: (value: string) => string
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  setSceneChatInputRef: (element: unknown) => void
  setSceneChatMentionListRef: (element: unknown) => void
  setSceneChatComposerText: (value: string) => void
  onRunVideosStep: () => void
  onRetryFailedQueueItems: () => void
  onSelectScene: (sceneId: string) => void
  onOpenSceneEdit: (scene: SceneData) => void
  onToggleSceneChat: (scene: SceneData) => void
  onHandleSplitScene: (sceneId: string) => void
  onHandleMergeWithNextScene: (sceneId: string) => void
  onHandleDeleteScene: (scene: SceneData) => void
  onGenerateSceneBaseline: (sceneId: string) => void
  onRetryScene: (sceneId: string) => void
  onPreviewImage: (src: string | undefined, alt: string) => void
  onCloseSceneChat: () => void
  onHandleSceneChatComposerInput: () => void
  onHandleSceneChatComposerCursor: () => void
  onHandleSceneChatComposerKeydown: (event: KeyboardEvent) => void
  onApplySceneChatMention: (candidate: SceneChatMentionCandidate) => void
  onRemoveSceneChatComposerAsset: (assetId: string) => void
  onHandleSceneChatImageUpload: (event: Event) => void
  onSubmitSceneChat: (sceneId: string) => void
}>()

const readySceneCount = computed(() => {
  return props.scenes.filter(scene => scene.frameStatus === 'done').length
})
</script>

<template>
  <div
    v-if="scenes.length === 0"
    class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
  >
    <p class="text-sm">
      请先完成"剧本解析"步骤
    </p>
  </div>
  <template v-else>
    <!-- Stats & actions -->
    <div class="shrink-0 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-blue-500" />
          场景 {{ scenes.length }}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          环境图就绪 {{ readySceneCount }}
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span class="inline-block h-2 w-2 rounded-full bg-violet-500" />
          视频完成 {{ queueSummary.done }}
        </div>
        <div
          v-if="queueSummary.error > 0"
          class="flex items-center gap-1.5 text-xs text-destructive"
        >
          <span class="inline-block h-2 w-2 rounded-full bg-destructive" />
          失败 {{ queueSummary.error }}
        </div>
        <div
          v-if="queueSummary.running > 0"
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Loader2 class="h-3 w-3 animate-spin text-primary" />
          运行中 {{ queueSummary.running }}
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Button
          size="sm"
          :disabled="autoRunning"
          class="gap-2"
          @click="onRunVideosStep()"
        >
          <Loader2
            v-if="autoRunning && autoRunCurrentStage === 'videos'"
            class="h-3.5 w-3.5 animate-spin"
          />
          批量生成场景视频
        </Button>
        <Button
          size="sm"
          variant="outline"
          :disabled="autoRunning || queueSummary.error === 0"
          @click="onRetryFailedQueueItems()"
        >
          重试失败场景
        </Button>
      </div>
    </div>

    <!-- Scene grid -->
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden xl:grid-cols-2">
      <div class="min-h-0 space-y-2 overflow-y-auto pr-1">
        <AssetWorkbenchSceneVideoCard
          v-for="(scene, idx) in scenes"
          :key="scene.id"
          :scene="scene"
          :index="idx"
          :selected="selectedSceneId === scene.id"
          :can-merge-with-next="canMergeSceneByIndex(idx)"
          :chat-open="sceneChatOpenSceneId === scene.id"
          :chat-messages="sceneChatCurrentMessages"
          :chat-composer-assets="sceneChatComposerAssets"
          :chat-composer-text="sceneChatComposerText"
          :chat-mention-open="sceneChatMentionOpen"
          :chat-mention-candidates="sceneChatMentionCandidates"
          :chat-mention-active-index="sceneChatMentionActiveIndex"
          :chat-uploading="sceneChatUploading"
          :chat-applying="sceneChatApplying"
          :chat-error="sceneChatError"
          :chat-can-submit="sceneChatCanSubmit"
          :resolve-scene-video-badge="resolveSceneVideoBadge"
          :resolve-scene-description-render-segments="resolveSceneDescriptionRenderSegments"
          :resolve-scene-description-secondary-mention-items="resolveSceneDescriptionSecondaryMentionItems"
          :resolve-scene-reference-image="resolveSceneReferenceImage"
          :is-scene-busy="isSceneBusy"
          :is-scene-preparing="isScenePreparing"
          :normalize-workflow-text="normalizeWorkflowText"
          :resolve-display-asset-by-id="resolveDisplayAssetById"
          :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
          :set-scene-chat-input-ref="setSceneChatInputRef"
          :set-scene-chat-mention-list-ref="setSceneChatMentionListRef"
          :set-scene-chat-composer-text="setSceneChatComposerText"
          :on-select-scene="onSelectScene"
          :on-open-scene-edit="onOpenSceneEdit"
          :on-toggle-scene-chat="onToggleSceneChat"
          :on-handle-split-scene="onHandleSplitScene"
          :on-handle-merge-with-next-scene="onHandleMergeWithNextScene"
          :on-handle-delete-scene="onHandleDeleteScene"
          :on-generate-scene-baseline="onGenerateSceneBaseline"
          :on-retry-scene="onRetryScene"
          :on-preview-image="onPreviewImage"
          :on-close-scene-chat="onCloseSceneChat"
          :on-handle-scene-chat-composer-input="onHandleSceneChatComposerInput"
          :on-handle-scene-chat-composer-cursor="onHandleSceneChatComposerCursor"
          :on-handle-scene-chat-composer-keydown="onHandleSceneChatComposerKeydown"
          :on-apply-scene-chat-mention="onApplySceneChatMention"
          :on-remove-scene-chat-composer-asset="onRemoveSceneChatComposerAsset"
          :on-handle-scene-chat-image-upload="onHandleSceneChatImageUpload"
          :on-submit-scene-chat="onSubmitSceneChat"
        />
      </div>

      <!-- Video preview panel -->
      <div class="min-h-0 flex flex-col rounded-lg border bg-muted/5">
        <template v-if="selectedScene">
          <div class="px-4 py-3 border-b">
            <div class="text-xs font-medium text-muted-foreground">
              视频预览
            </div>
          </div>
          <div class="flex-1 flex items-center justify-center p-4">
            <div class="w-full aspect-video overflow-hidden rounded-lg bg-black/90">
              <video
                v-if="selectedScene.videoUrl"
                :src="selectedScene.videoUrl"
                controls
                class="h-full w-full"
              />
              <div
                v-else
                class="flex h-full w-full items-center justify-center"
              >
                <span class="text-xs text-gray-400">等待生成视频</span>
              </div>
            </div>
          </div>
        </template>
        <div
          v-else
          class="flex flex-1 items-center justify-center"
        >
          <p class="text-sm text-muted-foreground/60">
            选择场景以预览视频
          </p>
        </div>
      </div>
    </div>
  </template>
</template>
