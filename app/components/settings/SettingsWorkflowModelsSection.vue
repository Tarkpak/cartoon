<script setup lang="ts">
import {
  Loader2,
  Info
} from 'lucide-vue-next'
import SettingsWorkflowCategorySection from '@/components/settings/SettingsWorkflowCategorySection.vue'
import SettingsWorkflowGlobalDefaults from '@/components/settings/SettingsWorkflowGlobalDefaults.vue'
import SettingsWorkflowSidebar from '@/components/settings/SettingsWorkflowSidebar.vue'
import {
  WORKFLOW_CATEGORY_CONFIG,
  useSettingsWorkflowModels
} from '@/composables/useSettingsWorkflowModels'

const {
  models,
  selectedModels,
  workflowLoading,
  workflowSaving,
  workflowCategories,
  activeCategory,
  activeCategoryMeta,
  activeCategoryWorkflows,
  klingV3OmniOptions,
  seedanceVideoOptions,
  videoAudioDefaults,
  imageGenerationOptions,
  completionNotificationOptions,
  getCapabilityLabel,
  getProviderLabel,
  selectWorkflowCategory,
  updateWorkflowModel,
  updateVideoGenerationModelOptions,
  updateWorkflowGeminiImageSize,
  updateWorkflowOpenaiImageQuality,
  updateWorkflowSeedanceVideoQuality,
  updateVideoAudioDefaults,
  updateCompletionNotificationOptions,
  updateGlobalWorkflowDefault,
  toSelectString
} = useSettingsWorkflowModels()

const ACTIVE_CATEGORY_ICON_CLASS: Record<string, string> = {
  blue: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900',
  green: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900',
  purple: 'text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-900'
}

const activeCategoryIconClass = computed(() => {
  return ACTIVE_CATEGORY_ICON_CLASS[activeCategoryMeta.value.color] || 'text-muted-foreground bg-muted border-border'
})
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <div
      v-if="workflowLoading"
      class="flex flex-1 items-center justify-center"
    >
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      <span class="ml-2 text-muted-foreground">加载配置中...</span>
    </div>

    <template v-else>
      <SettingsWorkflowSidebar
        :active-category="activeCategory"
        :categories="workflowCategories"
        @select-category="selectWorkflowCategory"
      />

      <div class="flex flex-1 flex-col overflow-hidden">
        <div class="border-b px-6 py-4">
          <div class="flex items-center gap-3">
            <div
              class="flex h-11 w-11 items-center justify-center rounded-xl border"
              :class="activeCategoryIconClass"
            >
              <component
                :is="WORKFLOW_CATEGORY_CONFIG[activeCategory]?.icon"
                class="h-5 w-5"
              />
            </div>
            <div>
              <h2 class="text-lg font-semibold">
                {{ activeCategoryMeta.name }}
              </h2>
              <p class="text-sm text-muted-foreground">
                {{ activeCategoryMeta.description }}
              </p>
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-6">
          <div class="mx-auto max-w-5xl space-y-4">
            <div class="flex items-start gap-2 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
              <Info class="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p>系统会根据当前流程的能力要求自动筛选可用模型。</p>
                <p class="mt-1">
                  未单独配置的流程会继承该类型的全局默认模型，红色标签表示该流程的必需能力要求。
                </p>
              </div>
            </div>

            <SettingsWorkflowGlobalDefaults
              v-if="models"
              :active-category="activeCategory"
              :models="models"
              :selected-models="selectedModels"
              :workflows="activeCategoryWorkflows"
              :workflow-saving="workflowSaving"
              :kling-v3-omni-options="klingV3OmniOptions"
              :seedance-video-options="seedanceVideoOptions"
              :video-audio-defaults="videoAudioDefaults"
              :image-generation-options="imageGenerationOptions"
              :completion-notification-options="completionNotificationOptions"
              :update-global-workflow-default="updateGlobalWorkflowDefault"
              :update-video-generation-model-options="updateVideoGenerationModelOptions"
              :update-workflow-gemini-image-size="updateWorkflowGeminiImageSize"
              :update-workflow-openai-image-quality="updateWorkflowOpenaiImageQuality"
              :update-workflow-seedance-video-quality="updateWorkflowSeedanceVideoQuality"
              :update-video-audio-defaults="updateVideoAudioDefaults"
              :update-completion-notification-options="updateCompletionNotificationOptions"
            />

            <SettingsWorkflowCategorySection
              :get-capability-label="getCapabilityLabel"
              :get-provider-label="getProviderLabel"
              :to-select-string="toSelectString"
              :update-workflow-model="updateWorkflowModel"
              :workflow-saving="workflowSaving"
              :workflows="activeCategoryWorkflows"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
