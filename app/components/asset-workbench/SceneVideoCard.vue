<script setup lang="ts">
import { resolveTimeOfDayText } from '#shared/types/script'
import { History, Loader2, Merge, MessageCircle, Split, Trash2 } from 'lucide-vue-next'
import type { SceneData } from '~/composables/useAssetWorkbench'
import type {
  DisplayAsset,
  SceneChatMentionCandidate,
  SceneChatMessage,
  SceneDescriptionMentionItem,
  SceneDescriptionRenderSegment,
  SceneVideoBadge,
  SceneVoiceReferenceSummary
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
  usePreviousLastFrameAsFirstFrame: boolean
  continuityLinkReason?: string
  canUsePreviousLastFrameReference: boolean
  resolveSceneVideoBadge: (scene: SceneData) => SceneVideoBadge
  resolveSceneVoiceReferenceSummary: (scene: SceneData) => SceneVoiceReferenceSummary
  resolveSceneDescriptionRenderSegments: (scene: SceneData) => SceneDescriptionRenderSegment[]
  resolveSceneDescriptionSecondaryMentionItems: (scene: SceneData) => SceneDescriptionMentionItem[]
  resolveSceneReferenceImage: (scene: SceneData) => string | undefined
  resolveSceneEnvironmentReferenceImageForMode: (
    scene: SceneData,
    mode: 'single' | 'four_view'
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
  onOpenSceneVideoHistory: (sceneId: string) => void
  onSetScenePreviousLastFrameReference: (sceneId: string, enabled: boolean) => void
  onSetSceneEnvironmentCaptureMode: (sceneId: string, mode: 'single' | 'four_view') => void
  onSetSceneEnvironmentReferenceAsset: (sceneId: string, assetId: string) => void | Promise<void>
  onSetSceneNarrationVoiceReference: (sceneId: string, assetId: string) => void | Promise<void>
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
const voiceReferenceSummary = computed(() => props.resolveSceneVoiceReferenceSummary(props.scene))
const descriptionSegments = computed(() => props.resolveSceneDescriptionRenderSegments(props.scene))
const secondaryMentions = computed(() => props.resolveSceneDescriptionSecondaryMentionItems(props.scene))
const inlineRenderedMentionAssetIdSet = computed(() => {
  const ids = new Set<string>()

  for (const segment of descriptionSegments.value) {
    if (segment.type !== 'asset' || !segment.asset?.id) continue
    ids.add(segment.asset.id)
  }

  return ids
})
const sceneReferenceImage = computed(() => props.resolveSceneReferenceImage(props.scene))
const sceneSingleViewReferenceImage = computed(() => {
  return props.resolveSceneEnvironmentReferenceImageForMode(props.scene, 'single')
})
const sceneFourViewReferenceImage = computed(() => {
  return props.resolveSceneEnvironmentReferenceImageForMode(props.scene, 'four_view')
})
const activeModeReferenceImage = computed(() => {
  if (sceneEnvironmentCaptureMode.value === 'four_view') {
    return sceneFourViewReferenceImage.value || sceneReferenceImage.value
  }
  return sceneSingleViewReferenceImage.value || sceneReferenceImage.value
})
const visibleSecondaryMentions = computed(() => {
  return secondaryMentions.value.filter((item) => {
    if (item.asset?.type === 'environment') return false
    if (!item.asset?.id) return true
    return !inlineRenderedMentionAssetIdSet.value.has(item.asset.id)
  })
})
const sceneBusy = computed(() => props.isSceneBusy(props.scene))
const scenePreparing = computed(() => props.isScenePreparing(props.scene))
const sceneVideoHistoryCount = computed(() => {
  return Array.isArray(props.scene.videoHistory) ? props.scene.videoHistory.length : 0
})
const continuitySwitchTitle = computed(() => {
  if (props.index === 0) return '首个场景没有上一镜头可承接'
  if (!props.canUsePreviousLastFrameReference) return '上一镜头还没有可用末帧，生成时会自动回退'
  return props.continuityLinkReason || '使用上一镜头末帧作为本镜头首帧参考'
})
const sceneEnvironmentCaptureMode = computed<'single' | 'four_view'>(() => {
  return props.scene.environmentCaptureMode === 'four_view' ? 'four_view' : 'single'
})
const sceneEnvironmentReferenceAssetSelection = computed(() => {
  return props.resolveSceneEnvironmentReferenceAssetSelection(props.scene.id) || '__auto__'
})
const hasNarration = computed(() => !!props.scene.narration?.trim())
const sceneNarrationVoiceOptions = computed(() => {
  return props.resolveSceneNarrationVoiceOptions(props.scene)
})
const sceneNarrationVoiceReferenceSelection = computed(() => {
  return props.resolveSceneNarrationVoiceReferenceSelection(props.scene.id) || '__auto__'
})

function handleSetSceneEnvironmentCaptureMode(mode: 'single' | 'four_view') {
  props.onSetSceneEnvironmentCaptureMode(props.scene.id, mode)
}

function handleSetSceneEnvironmentReferenceAsset(value: unknown) {
  const normalized = String(value ?? '').trim() || '__auto__'
  void props.onSetSceneEnvironmentReferenceAsset(props.scene.id, normalized)
}

function handleSetSceneNarrationVoiceReference(value: unknown) {
  const normalized = String(value ?? '').trim() || '__auto__'
  void props.onSetSceneNarrationVoiceReference(props.scene.id, normalized)
}
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
      v-if="visibleSecondaryMentions.length > 0"
      class="mt-1 flex flex-wrap items-center gap-1.5"
    >
      <template
        v-for="mention in visibleSecondaryMentions"
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

    <div
      v-if="voiceReferenceSummary.hasDialogue || hasNarration"
      class="mt-2 rounded-md border bg-muted/20 px-2 py-2"
      @click.stop
    >
      <AssetWorkbenchSceneVoiceReferenceSummary
        v-if="voiceReferenceSummary.hasDialogue"
        :summary="voiceReferenceSummary"
      />
      <div
        v-if="hasNarration"
        class="mt-1 flex flex-wrap items-center gap-1.5"
      >
        <Badge
          variant="outline"
          class="text-[10px]"
        >
          旁白音频
        </Badge>
        <Select
          :model-value="sceneNarrationVoiceReferenceSelection"
          @update:model-value="handleSetSceneNarrationVoiceReference"
        >
          <SelectTrigger
            class="h-6 min-w-[168px] max-w-[240px] px-2 text-[11px]"
            :disabled="sceneBusy || sceneNarrationVoiceOptions.length === 0"
          >
            <SelectValue placeholder="自动选择" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">
              自动选择（按场景）
            </SelectItem>
            <SelectItem
              v-for="option in sceneNarrationVoiceOptions"
              :key="`scene_narration_voice_${scene.id}_${option.assetId}`"
              :value="option.assetId"
            >
              <div class="flex items-center gap-1">
                <span class="truncate">
                  {{ option.name }}
                </span>
                <span
                  v-if="option.source === 'auto'"
                  class="shrink-0 text-[10px] text-muted-foreground"
                >
                  自动
                </span>
                <span
                  v-if="option.locked"
                  class="shrink-0 text-[10px] text-amber-600"
                >
                  锁定
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <span
          v-if="sceneNarrationVoiceOptions.length === 0"
          class="text-[10px] text-muted-foreground"
        >
          暂无可用旁白音频
        </span>
      </div>
    </div>

    <Button
      v-if="activeModeReferenceImage"
      type="button"
      variant="ghost"
      class="mt-3 inline-flex h-auto rounded-lg border bg-muted/20 p-2 hover:bg-muted/30"
      @click.stop="onPreviewImage(activeModeReferenceImage, `${scene.title} · 环境图`)"
    >
      <img
        :key="activeModeReferenceImage"
        :src="toImageSrc(activeModeReferenceImage)"
        :alt="`${scene.title} 环境图`"
        class="h-12 w-12 shrink-0 rounded-md border object-cover"
      >
    </Button>

    <div
      class="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 px-2 py-2"
      @click.stop
    >
      <span class="text-[11px] text-muted-foreground">环境引用视图</span>
      <Select
        :model-value="sceneEnvironmentReferenceAssetSelection"
        @update:model-value="handleSetSceneEnvironmentReferenceAsset"
      >
        <SelectTrigger
          class="h-6 min-w-[168px] max-w-[220px] px-2 text-[11px]"
          :disabled="sceneBusy"
        >
          <SelectValue placeholder="选择环境资产" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__auto__">
            自动（按场景环境）
          </SelectItem>
          <SelectItem
            v-for="asset in sceneEnvironmentAssetOptions"
            :key="`scene_env_asset_${scene.id}_${asset.id}`"
            :value="asset.id"
          >
            <div class="flex items-center gap-2">
              <img
                v-if="asset.previewImage"
                :src="toImageSrc(asset.previewImage)"
                :alt="`${asset.label} 预览`"
                class="h-5 w-5 rounded border object-cover"
              >
              <span class="truncate">
                {{ asset.label }}{{ asset.hasReference ? '' : '（未就绪）' }}
              </span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      <Button
        size="sm"
        class="h-6 px-2 text-[11px]"
        :variant="sceneEnvironmentCaptureMode === 'single' ? 'default' : 'outline'"
        :disabled="sceneBusy"
        @click.stop="handleSetSceneEnvironmentCaptureMode('single')"
      >
        单视图
      </Button>
      <Button
        size="sm"
        class="h-6 px-2 text-[11px]"
        :variant="sceneEnvironmentCaptureMode === 'four_view' ? 'default' : 'outline'"
        :disabled="sceneBusy"
        @click.stop="handleSetSceneEnvironmentCaptureMode('four_view')"
      >
        四视图
      </Button>
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
        {{ resolveTimeOfDayText(scene.setting.timeOfDay) }}
      </Badge>
      <Badge
        variant="outline"
        class="text-[10px]"
      >
        {{ scene.duration }}s
      </Badge>
    </div>

    <div
      v-if="index > 0"
      class="mt-3 flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-2 py-2"
      :title="continuitySwitchTitle"
      @click.stop
    >
      <div class="min-w-0">
        <div class="text-xs font-medium">
          承接上一镜头末帧
        </div>
        <div class="truncate text-[11px] text-muted-foreground">
          {{ continuityLinkReason || (canUsePreviousLastFrameReference ? '生成时使用上一镜头末帧作为首帧参考' : '上一镜头末帧生成后自动生效') }}
        </div>
      </div>
      <Switch
        :checked="usePreviousLastFrameAsFirstFrame"
        :disabled="sceneBusy"
        @update:checked="(checked) => onSetScenePreviousLastFrameReference(scene.id, checked)"
      />
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
        {{ scenePreparing ? '准备中' : scene.videoUrl ? '重新生成视频' : '生成视频' }}
      </Button>
      <Button
        v-if="sceneVideoHistoryCount > 0"
        size="sm"
        variant="ghost"
        class="h-7 px-2 text-xs"
        @click.stop.prevent="onOpenSceneVideoHistory(scene.id)"
      >
        <History class="mr-1 h-3.5 w-3.5" />
        历史 {{ sceneVideoHistoryCount }}
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
      v-if="scene.referenceStatus === 'error' && scene.referenceError"
      class="mt-2 text-xs text-destructive"
    >
      {{ normalizeWorkflowText(scene.referenceError) }}
    </p>
    <p
      v-if="scene.videoStatus === 'error' && scene.videoError"
      class="mt-2 text-xs text-destructive"
    >
      {{ normalizeWorkflowText(scene.videoError) }}
    </p>
  </div>
</template>
