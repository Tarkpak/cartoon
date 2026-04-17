<script setup lang="ts">
import { Loader2, Merge, MessageCircle, Split, Trash2 } from 'lucide-vue-next'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  SceneChatMentionCandidate,
  SceneChatMessage,
  SceneDescriptionMentionItem,
  SceneDescriptionRenderSegment,
  SceneVideoBadge
} from '~/lib/asset-workbench-types'
import { toImageSrc } from '~/lib/media'

const props = defineProps<{
  scene: SceneData
  index: number
  selected: boolean
  canMergeWithNext: boolean
  chatOpen: boolean
  chatMessages: SceneChatMessage[]
  chatComposerAssets: DisplayAsset[]
  chatComposerText: string
  chatMentionOpen: boolean
  chatMentionCandidates: SceneChatMentionCandidate[]
  chatMentionActiveIndex: number
  chatUploading: boolean
  chatApplying: boolean
  chatError: string | null
  chatCanSubmit: boolean
  resolveSceneVideoBadge: (scene: SceneData) => SceneVideoBadge
  resolveSceneDescriptionRenderSegments: (scene: SceneData) => SceneDescriptionRenderSegment[]
  resolveSceneDescriptionSecondaryMentionItems: (scene: SceneData) => SceneDescriptionMentionItem[]
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  isSceneBusy: (scene: SceneData) => boolean
  isScenePreparing: (scene: SceneData) => boolean
  normalizeWorkflowText: (value: string) => string
  resolveDisplayAssetById: (assetId: string) => DisplayAsset | undefined
  resolveDisplayAssetTypeLabel: (type: DisplayAsset['type']) => string
  setSceneChatInputRef: (element: unknown) => void
  setSceneChatMentionListRef: (element: unknown) => void
  setSceneChatComposerText: (value: string) => void
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

const videoBadge = computed(() => props.resolveSceneVideoBadge(props.scene))
const descriptionSegments = computed(() => props.resolveSceneDescriptionRenderSegments(props.scene))
const secondaryMentions = computed(() => props.resolveSceneDescriptionSecondaryMentionItems(props.scene))
const sceneBusy = computed(() => props.isSceneBusy(props.scene))
const scenePreparing = computed(() => props.isScenePreparing(props.scene))
</script>

<template>
  <div
    class="relative cursor-pointer rounded-md border p-3 transition group"
    :class="selected ? 'border-primary bg-primary/5' : 'hover:border-primary/50'"
    title="单击选中，双击编辑场景详情"
    @click="onSelectScene(scene.id)"
    @dblclick.stop="onOpenSceneEdit(scene)"
  >
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xs text-muted-foreground">
          场景 {{ index + 1 }}
        </div>
        <div class="truncate text-sm font-medium">
          {{ scene.title }}
        </div>
      </div>
      <div class="flex items-center gap-1">
        <Badge
          :variant="scene.referenceStatus === 'done' ? 'secondary' : scene.referenceStatus === 'error' ? 'destructive' : scene.referenceStatus === 'generating' ? 'default' : 'outline'"
          class="text-[10px]"
        >
          {{ scene.referenceStatus === 'done' ? '环境图就绪' : scene.referenceStatus === 'error' ? '环境图失败' : scene.referenceStatus === 'generating' ? '环境图生成中' : '环境图待生成' }}
        </Badge>
        <Badge
          :variant="videoBadge.variant"
          class="text-[10px]"
        >
          {{ videoBadge.label }}
        </Badge>

        <div class="flex max-w-0 items-center gap-1 overflow-hidden opacity-0 transition-all duration-200 group-hover:max-w-40 group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            title="对话修改场景"
            :disabled="sceneBusy"
            @click.stop="onToggleSceneChat(scene)"
          >
            <MessageCircle class="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            title="拆分场景"
            :disabled="sceneBusy"
            @click.stop="onHandleSplitScene(scene.id)"
          >
            <Split class="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            title="与下一场景合并"
            :disabled="!canMergeWithNext"
            @click.stop="onHandleMergeWithNextScene(scene.id)"
          >
            <Merge class="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0 text-destructive hover:text-destructive"
            title="删除场景"
            :disabled="sceneBusy"
            @click.stop="onHandleDeleteScene(scene)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>

    <div class="mt-1 break-words text-xs leading-6 text-muted-foreground">
      <template
        v-for="(segment, segmentIndex) in descriptionSegments"
        :key="`scene_desc_segment_${scene.id}_${segmentIndex}`"
      >
        <span
          v-if="segment.type === 'text'"
          class="whitespace-pre-wrap"
        >
          {{ segment.text }}
        </span>
        <Button
          v-else-if="segment.asset?.referenceImage"
          type="button"
          variant="ghost"
          class="mx-0.5 inline-flex h-7 max-w-[140px] items-center gap-1 rounded border bg-muted/30 px-1 align-middle"
          @click.stop="onPreviewImage(segment.asset.referenceImage, `${scene.title} · ${segment.asset.name}`)"
        >
          <img
            :src="toImageSrc(segment.asset.referenceImage)"
            :alt="`${segment.asset.name} 参考图`"
            class="h-5 w-5 rounded border object-cover"
          >
          <span class="truncate text-[10px]">
            {{ segment.asset.name }}
          </span>
        </Button>
        <Badge
          v-else-if="segment.asset"
          variant="outline"
          class="mx-0.5 inline-flex max-w-[140px] align-middle text-[10px]"
        >
          <span class="truncate">
            {{ segment.asset.name }}
          </span>
        </Badge>
      </template>
    </div>

    <div
      v-if="secondaryMentions.length > 0"
      class="mt-1 flex flex-wrap items-center gap-1.5"
    >
      <template
        v-for="mention in secondaryMentions"
        :key="`scene_mention_${scene.id}_${mention.token}`"
      >
        <Button
          v-if="mention.asset?.referenceImage"
          type="button"
          variant="ghost"
          class="h-8 max-w-[180px] gap-1 rounded border bg-muted/30 px-1.5"
          @click.stop="onPreviewImage(mention.asset.referenceImage, `${scene.title} · ${mention.asset.name}`)"
        >
          <img
            :src="toImageSrc(mention.asset.referenceImage)"
            :alt="`${mention.asset.name} 参考图`"
            class="h-6 w-6 rounded border object-cover"
          >
          <span class="truncate text-[10px]">
            {{ mention.asset.name }}
          </span>
        </Button>
        <Badge
          v-else
          variant="outline"
          class="max-w-[180px] text-[10px]"
        >
          <span class="truncate">
            {{ mention.asset?.name || mention.token }}
          </span>
        </Badge>
      </template>
    </div>

    <div class="mt-2 flex flex-wrap gap-1">
      <Badge
        v-if="scene.setting?.location"
        variant="outline"
        class="text-[10px]"
      >
        {{ scene.setting.location }}
      </Badge>
      <Badge
        v-if="scene.setting?.timeOfDay"
        variant="outline"
        class="text-[10px]"
      >
        {{ scene.setting.timeOfDay }}
      </Badge>
      <Badge
        variant="outline"
        class="text-[10px]"
      >
        {{ scene.duration }}s
      </Badge>
    </div>

    <div class="mt-3 flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        class="h-7 px-2 text-xs"
        :disabled="sceneBusy"
        @click.stop="onGenerateSceneBaseline(scene.id)"
      >
        <Loader2
          v-if="scene.referenceStatus === 'generating'"
          class="mr-1 h-3.5 w-3.5 animate-spin"
        />
        {{ resolveSceneReferenceImage(scene) ? '重新生成环境图' : '生成环境图' }}
      </Button>
      <Button
        size="sm"
        class="h-7 px-2 text-xs"
        :disabled="sceneBusy"
        @click.stop="onRetryScene(scene.id)"
      >
        <Loader2
          v-if="scene.videoStatus === 'generating' || scenePreparing"
          class="mr-1 h-3.5 w-3.5 animate-spin"
        />
        {{ scenePreparing ? '准备中' : scene.videoUrl ? '重生成视频' : '生成视频' }}
      </Button>
    </div>

    <AssetWorkbenchSceneChatPanel
      v-if="chatOpen"
      :scene-id="scene.id"
      :scene-title="scene.title"
      :messages="chatMessages"
      :composer-assets="chatComposerAssets"
      :composer-text="chatComposerText"
      :mention-open="chatMentionOpen"
      :mention-candidates="chatMentionCandidates"
      :mention-active-index="chatMentionActiveIndex"
      :uploading="chatUploading"
      :applying="chatApplying"
      :error="chatError"
      :can-submit="chatCanSubmit"
      :resolve-display-asset-by-id="resolveDisplayAssetById"
      :resolve-display-asset-type-label="resolveDisplayAssetTypeLabel"
      :set-input-ref="setSceneChatInputRef"
      :set-mention-list-ref="setSceneChatMentionListRef"
      :set-composer-text="setSceneChatComposerText"
      :on-composer-input="onHandleSceneChatComposerInput"
      :on-composer-cursor="onHandleSceneChatComposerCursor"
      :on-composer-keydown="onHandleSceneChatComposerKeydown"
      :on-apply-mention="onApplySceneChatMention"
      :on-remove-composer-asset="onRemoveSceneChatComposerAsset"
      :on-handle-upload="onHandleSceneChatImageUpload"
      :on-submit="onSubmitSceneChat"
      :on-close="onCloseSceneChat"
      :on-preview-image="onPreviewImage"
    />

    <p
      v-if="scene.videoStatus === 'error' && scene.videoError"
      class="mt-2 text-xs text-destructive"
    >
      {{ normalizeWorkflowText(scene.videoError) }}
    </p>
  </div>
</template>
