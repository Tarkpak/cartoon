<script setup lang="ts">
import {
  Loader2,
  Plus,
  Upload,
  Download,
  RotateCcw
} from 'lucide-vue-next'
import type { StyleFormState } from '@/lib/style-preset-settings'
import SettingsStyleEditorDialog from '@/components/settings/SettingsStyleEditorDialog.vue'
import SettingsStyleOverview from '@/components/settings/SettingsStyleOverview.vue'
import SettingsStylePresetCatalog from '@/components/settings/SettingsStylePresetCatalog.vue'

const {
  styleConfigLoading,
  styleConfigSaving,
  allStylePresets,
  enabledStyleIdSet,
  styleDefaultId,
  styleSearchKeyword,
  styleCategoryFilter,
  styleEditorMode,
  styleEditingId,
  styleCrudSaving,
  styleDeletingId,
  styleResetting,
  styleImporting,
  styleExporting,
  styleImportInputRef,
  styleForm,
  enabledStyleCount,
  hasStyleSelection,
  hasStyleConfigChanges,
  filteredStylePresets,
  currentDefaultStyle,
  getStyleCategoryName,
  openCreateStyleEditor,
  openEditStyleEditor,
  closeStyleEditor,
  handleStyleEditorOpenChange,
  submitStyleEditor,
  deleteStylePreset,
  resetStylePresets,
  triggerStyleImport,
  handleStyleImport,
  exportStylePresets,
  toggleStyleEnabled,
  setDefaultStyle,
  enableAllStyles,
  saveStyleConfig
} = useStylePresetSettings()

function updateStyleFormField<K extends keyof StyleFormState>(
  key: K,
  value: StyleFormState[K]
) {
  styleForm[key] = value
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex-shrink-0 border-b px-6 py-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">
            画风预设配置
          </h2>
          <p class="text-sm text-muted-foreground">
            控制项目创建和工作台可选择的画风范围，并设置默认画风。
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <input
            ref="styleImportInputRef"
            type="file"
            accept=".json,application/json"
            class="hidden"
            @change="handleStyleImport"
          >

          <Button
            variant="outline"
            size="sm"
            :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
            @click="openCreateStyleEditor"
          >
            <Plus class="mr-1.5 h-4 w-4" />
            新增预设
          </Button>

          <Button
            variant="outline"
            size="sm"
            :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
            @click="triggerStyleImport"
          >
            <Upload class="mr-1.5 h-4 w-4" />
            {{ styleImporting ? '导入中...' : '导入' }}
          </Button>

          <Button
            variant="outline"
            size="sm"
            :disabled="styleConfigLoading || styleCrudSaving || styleExporting"
            @click="exportStylePresets"
          >
            <Download class="mr-1.5 h-4 w-4" />
            {{ styleExporting ? '导出中...' : '导出' }}
          </Button>

          <Button
            variant="outline"
            size="sm"
            :disabled="styleConfigLoading || styleCrudSaving || styleResetting"
            @click="resetStylePresets"
          >
            <RotateCcw class="mr-1.5 h-4 w-4" />
            {{ styleResetting ? '重置中...' : '重置默认' }}
          </Button>

          <Button
            variant="outline"
            size="sm"
            :disabled="styleConfigLoading || styleConfigSaving"
            @click="enableAllStyles"
          >
            全部启用
          </Button>

          <Button
            size="sm"
            :disabled="styleConfigLoading || styleConfigSaving || !hasStyleSelection || !hasStyleConfigChanges"
            @click="saveStyleConfig"
          >
            <Loader2
              v-if="styleConfigSaving"
              class="mr-1.5 h-4 w-4 animate-spin"
            />
            保存配置
          </Button>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <div
        v-if="styleConfigLoading"
        class="flex items-center justify-center py-12 text-muted-foreground"
      >
        <Loader2 class="h-6 w-6 animate-spin" />
        <span class="ml-2">加载画风配置中...</span>
      </div>

      <div
        v-else
        class="mx-auto max-w-5xl space-y-4"
      >
        <SettingsStyleOverview
          :all-style-presets="allStylePresets"
          :current-default-style="currentDefaultStyle"
          :enabled-style-count="enabledStyleCount"
          :style-default-id="styleDefaultId"
        />

        <SettingsStylePresetCatalog
          v-model:style-search-keyword="styleSearchKeyword"
          v-model:style-category-filter="styleCategoryFilter"
          :delete-style-preset="deleteStylePreset"
          :enabled-style-id-set="enabledStyleIdSet"
          :filtered-style-presets="filteredStylePresets"
          :get-style-category-name="getStyleCategoryName"
          :open-edit-style-editor="openEditStyleEditor"
          :set-default-style="setDefaultStyle"
          :style-default-id="styleDefaultId"
          :style-deleting-id="styleDeletingId"
          :style-editing-id="styleEditingId"
          :style-editor-mode="styleEditorMode"
          :toggle-style-enabled="toggleStyleEnabled"
        />
      </div>
    </div>

    <SettingsStyleEditorDialog
      :close-style-editor="closeStyleEditor"
      :handle-style-editor-open-change="handleStyleEditorOpenChange"
      :style-crud-saving="styleCrudSaving"
      :style-editor-mode="styleEditorMode"
      :style-editing-id="styleEditingId"
      :style-form="styleForm"
      :submit-style-editor="submitStyleEditor"
      @update-field="({ key, value }) => updateStyleFormField(key, value)"
    />
  </div>
</template>
