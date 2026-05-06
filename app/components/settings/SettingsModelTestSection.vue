<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { useSettingsModelTest } from '@/composables/useSettingsModelTest'
import SettingsModelTestControls from '@/components/settings/SettingsModelTestControls.vue'
import SettingsModelTestResultPanel from '@/components/settings/SettingsModelTestResultPanel.vue'
import SettingsModelTestSidebar from '@/components/settings/SettingsModelTestSidebar.vue'

const {
  loading,
  models,
  activeTab,
  customPrompts,
  referenceImages,
  testResults,
  groupedModels,
  currentSelectedModel,
  currentTtsAudioUrl,
  currentImageModelSupportsReference,
  currentImageModelRequiresReference,
  currentImageModelAspectRatioOptions,
  currentImageModelQualityOptions,
  imageAspectRatio,
  imageQuality,
  canRunImageTest,
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
  triggerFileInput,
  openReferenceImagePreview,
  selectTestModel,
  toggleProvider,
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
  <div class="h-full flex overflow-hidden">
    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center"
    >
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      <span class="ml-2 text-muted-foreground">加载模型配置...</span>
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
          v-model:image-quality="imageQuality"
          :can-run-image-test="canRunImageTest"
          :current-image-model-aspect-ratio-options="currentImageModelAspectRatioOptions"
          :current-image-model-quality-options="currentImageModelQualityOptions"
          :current-image-model-requires-reference="currentImageModelRequiresReference"
          :current-image-model-supports-reference="currentImageModelSupportsReference"
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
          :remove-reference-image="removeReferenceImage"
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
