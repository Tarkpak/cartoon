<script setup lang="ts">
import {
  Loader2,
  Info,
  TriangleAlert
} from 'lucide-vue-next'
import SettingsWorkflowCategorySection from '@/components/settings/SettingsWorkflowCategorySection.vue'
import SettingsWorkflowGlobalDefaults from '@/components/settings/SettingsWorkflowGlobalDefaults.vue'
const {
  models,
  selectedModels,
  modelCatalogError,
  workflowLoading,
  workflowError,
  workflowSaving,
  activeCategory,
  activeCategoryWorkflows,
  klingV3OmniOptions,
  seedanceVideoOptions,
  videoAudioDefaults,
  imageGenerationOptions,
  getCapabilityLabel,
  getProviderLabel,
  reloadModelSettings,
  updateWorkflowModel,
  updateVideoGenerationModelOptions,
  updateWorkflowGeminiImageSize,
  updateWorkflowOpenaiImageQuality,
  updateWorkflowPanoramaSourceMode,
  updateWorkflowPanoramaCustomAspectRatio,
  updateWorkflowPanoramaCustomSize,
  updateWorkflowSeedanceVideoQuality,
  updateVideoAudioDefaults,
  updateGlobalWorkflowDefault,
  toSelectString
} = useSettingsWorkflowModels()
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div
      v-if="workflowLoading"
      class="flex flex-1 items-center justify-center"
    >
      <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      <span class="ml-2 text-muted-foreground">加载配置中...</span>
    </div>

    <template v-else>
      <div class="@container flex flex-1 flex-col overflow-hidden">
        <div
          v-if="modelCatalogError || workflowError"
          class="flex flex-shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-6 py-3 text-sm text-destructive"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="font-medium">
              模型分配配置加载失败
            </p>
            <p class="mt-1 break-words text-xs">
              {{ workflowError || modelCatalogError }}
            </p>
            <Button
              variant="outline"
              size="sm"
              class="mt-2 h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
              :disabled="workflowLoading"
              @click="reloadModelSettings"
            >
              <Loader2
                v-if="workflowLoading"
                class="mr-1.5 h-3.5 w-3.5 animate-spin"
              />
              重试
            </Button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div class="space-y-4">
            <div class="flex items-start gap-2 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
              <Info class="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <p>系统会根据当前流程的能力要求自动筛选可用模型。</p>
                <p class="mt-1">
                  切换全局默认会统一应用到该类型的所有流程；之后单独修改某个流程会形成局部覆盖。
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
              :update-global-workflow-default="updateGlobalWorkflowDefault"
              :update-video-generation-model-options="updateVideoGenerationModelOptions"
              :update-workflow-gemini-image-size="updateWorkflowGeminiImageSize"
              :update-workflow-openai-image-quality="updateWorkflowOpenaiImageQuality"
              :update-workflow-panorama-source-mode="updateWorkflowPanoramaSourceMode"
              :update-workflow-panorama-custom-aspect-ratio="updateWorkflowPanoramaCustomAspectRatio"
              :update-workflow-panorama-custom-size="updateWorkflowPanoramaCustomSize"
              :update-workflow-seedance-video-quality="updateWorkflowSeedanceVideoQuality"
              :update-video-audio-defaults="updateVideoAudioDefaults"
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
