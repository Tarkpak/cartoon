<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { Loader2, TriangleAlert } from 'lucide-vue-next'
import { useSettingsModelTest } from '@/composables/useSettingsModelTest'
import SettingsModelTestControls from '@/components/settings/SettingsModelTestControls.vue'
import SettingsModelTestResultPanel from '@/components/settings/SettingsModelTestResultPanel.vue'
import SettingsModelTestSidebar from '@/components/settings/SettingsModelTestSidebar.vue'

const {
  loading,
  models,
  modelCatalogError,
  activeTab,
  customPrompts,
  referenceImages,
  videoReferenceImages,
  videoReferenceVideos,
  videoReferenceVideoNames,
  videoFirstFrame,
  videoLastFrame,
  videoAudioReferences,
  videoAudioReferenceNames,
  testResults,
  groupedModels,
  currentSelectedModel,
  currentTtsAudioUrl,
  currentImageModelSupportsReference,
  currentImageModelRequiresReference,
  currentImageModelMaxReferenceImages,
  currentVideoModelSupportsImageReference,
  currentVideoModelSupportsReference,
  currentVideoModelSupportsVideoReference,
  currentVideoModelSupportsFirstLastFrame,
  currentVideoModelSupportsAudioReference,
  currentVideoModelRequiresReference,
  currentVideoModelMaxReferenceImages,
  currentVideoModelMaxReferenceVideos,
  currentVideoModelMaxReferenceAudios,
  currentVideoModelSupportsBothImageModes,
  videoImageInputMode,
  currentImageModelAspectRatioOptions,
  currentImageModelSizeOptions,
  currentImageModelSizeSelectionMode,
  currentImageModelSizeHelp,
  currentImageModelQualityOptions,
  imageAspectRatio,
  imageSize,
  imageQuality,
  canRunImageTest,
  canRunVideoTest,
  fileInputRef,
  promptEditorRef,
  imagePromptIsEmpty,
  imageMentionOpen,
  imageMentionCandidates,
  imageMentionActiveIndex,
  referencePreviewOpen,
  referencePreviewSrc,
  referencePreviewAlt,
  insertImageMention,
  handlePromptTextareaInput,
  handlePromptTextareaCursorChange,
  handlePromptTextareaFocus,
  handlePromptTextareaCompositionStart,
  handlePromptTextareaCompositionEnd,
  handlePromptTextareaBlur,
  handlePromptTextareaKeydown,
  handleReferenceImageUpload,
  removeReferenceImage,
  handleVideoReferenceImageUpload,
  removeVideoReferenceImage,
  handleVideoReferenceVideoUpload,
  removeVideoReferenceVideo,
  handleVideoFirstFrameUpload,
  handleVideoLastFrameUpload,
  clearVideoFirstFrame,
  clearVideoLastFrame,
  handleVideoAudioReferenceUpload,
  removeVideoAudioReference,
  clearVideoAudioReference,
  triggerFileInput,
  openReferenceImagePreview,
  selectTestModel,
  toggleProvider,
  retryLoadModels,
  testModel
} = useSettingsModelTest()

function setFileInputElement(element: Element | ComponentPublicInstance | null) {
  const component = element as (ComponentPublicInstance & { inputElement?: HTMLInputElement }) | null
  fileInputRef.value = element instanceof HTMLInputElement
    ? element
    : component?.inputElement instanceof HTMLInputElement ? component.inputElement : null
}

function setPromptEditorElement(element: Element | ComponentPublicInstance | null) {
  promptEditorRef.value = element instanceof HTMLDivElement ? element : null
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden xl:flex-row">
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center"
    >
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      <span class="ml-2 text-muted-foreground">加载模型列表...</span>
    </div>

    <div
      v-else-if="!models && modelCatalogError"
      class="flex flex-1 items-center justify-center p-6"
    >
      <div class="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <div class="flex items-start gap-2">
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="font-medium">
              模型列表加载失败
            </p>
            <p class="mt-1 break-words text-xs">
              {{ modelCatalogError }}
            </p>
            <Button
              variant="outline"
              size="sm"
              class="mt-3 h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              @click="retryLoadModels"
            >
              重试
            </Button>
          </div>
        </div>
      </div>
    </div>

    <template v-else-if="models">
      <SettingsModelTestSidebar
        v-model:active-tab="activeTab"
        :current-selected-model="currentSelectedModel"
        :grouped-models="groupedModels"
        @select-model="({ type, modelId }) => selectTestModel(type, modelId)"
        @toggle-provider="toggleProvider"
      />

      <div class="flex flex-1 flex-col overflow-hidden">
        <SettingsModelTestControls
          v-model:active-tab="activeTab"
          v-model:custom-prompts="customPrompts"
          v-model:image-aspect-ratio="imageAspectRatio"
          v-model:image-size="imageSize"
          v-model:image-quality="imageQuality"
          :can-run-image-test="canRunImageTest"
          :can-run-video-test="canRunVideoTest"
          :current-image-model-aspect-ratio-options="currentImageModelAspectRatioOptions"
          :current-image-model-size-options="currentImageModelSizeOptions"
          :current-image-model-size-selection-mode="currentImageModelSizeSelectionMode"
          :current-image-model-size-help="currentImageModelSizeHelp"
          :current-image-model-quality-options="currentImageModelQualityOptions"
          :current-image-model-requires-reference="currentImageModelRequiresReference"
          :current-image-model-max-reference-images="currentImageModelMaxReferenceImages"
          :current-image-model-supports-reference="currentImageModelSupportsReference"
          :current-video-model-supports-image-reference="currentVideoModelSupportsImageReference"
          :current-video-model-supports-reference="currentVideoModelSupportsReference"
          :current-video-model-supports-video-reference="currentVideoModelSupportsVideoReference"
          :current-video-model-supports-first-last-frame="currentVideoModelSupportsFirstLastFrame"
          :current-video-model-supports-audio-reference="currentVideoModelSupportsAudioReference"
          :current-video-model-requires-reference="currentVideoModelRequiresReference"
          :current-video-model-max-reference-images="currentVideoModelMaxReferenceImages"
          :current-video-model-max-reference-videos="currentVideoModelMaxReferenceVideos"
          :current-video-model-max-reference-audios="currentVideoModelMaxReferenceAudios"
          :current-video-model-supports-both-image-modes="currentVideoModelSupportsBothImageModes"
          v-model:video-image-input-mode="videoImageInputMode"
          :set-file-input-ref="setFileInputElement"
          :handle-prompt-textarea-blur="handlePromptTextareaBlur"
          :handle-prompt-textarea-composition-end="handlePromptTextareaCompositionEnd"
          :handle-prompt-textarea-composition-start="handlePromptTextareaCompositionStart"
          :handle-prompt-textarea-cursor-change="handlePromptTextareaCursorChange"
          :handle-prompt-textarea-focus="handlePromptTextareaFocus"
          :handle-prompt-textarea-input="handlePromptTextareaInput"
          :handle-prompt-textarea-keydown="handlePromptTextareaKeydown"
          :handle-reference-image-upload="handleReferenceImageUpload"
          :image-mention-active-index="imageMentionActiveIndex"
          :image-mention-candidates="imageMentionCandidates"
          :image-mention-open="imageMentionOpen"
          :image-prompt-is-empty="imagePromptIsEmpty"
          :insert-image-mention="insertImageMention"
          :open-reference-image-preview="openReferenceImagePreview"
          :set-prompt-editor-ref="setPromptEditorElement"
          :reference-images="referenceImages"
          :video-reference-images="videoReferenceImages"
          :video-reference-videos="videoReferenceVideos"
          :video-reference-video-names="videoReferenceVideoNames"
          :video-first-frame="videoFirstFrame"
          :video-last-frame="videoLastFrame"
          :video-audio-references="videoAudioReferences"
          :video-audio-reference-names="videoAudioReferenceNames"
          :remove-reference-image="removeReferenceImage"
          :remove-video-reference-image="removeVideoReferenceImage"
          :remove-video-reference-video="removeVideoReferenceVideo"
          :handle-video-reference-image-upload="handleVideoReferenceImageUpload"
          :handle-video-reference-video-upload="handleVideoReferenceVideoUpload"
          :handle-video-first-frame-upload="handleVideoFirstFrameUpload"
          :handle-video-last-frame-upload="handleVideoLastFrameUpload"
          :clear-video-first-frame="clearVideoFirstFrame"
          :clear-video-last-frame="clearVideoLastFrame"
          :handle-video-audio-reference-upload="handleVideoAudioReferenceUpload"
          :remove-video-audio-reference="removeVideoAudioReference"
          :clear-video-audio-reference="clearVideoAudioReference"
          :test-results="testResults"
          :trigger-file-input="triggerFileInput"
          :test-model="testModel"
        />

        <SettingsModelTestResultPanel
          :active-tab="activeTab"
          :current-tts-audio-url="currentTtsAudioUrl"
          :test-results="testResults"
        />

        <ImagePreview
          v-model:open="referencePreviewOpen"
          :alt="referencePreviewAlt"
          :src="referencePreviewSrc"
        />
      </div>
    </template>
  </div>
</template>
