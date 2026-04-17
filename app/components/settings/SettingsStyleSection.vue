<script setup lang="ts">
import {
  Loader2,
  Plus,
  Upload,
  Download,
  RotateCcw,
  MoreHorizontal,
  CheckCheck
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

const showMoreMenu = ref(false)

function updateStyleFormField<K extends keyof StyleFormState>(
  key: K,
  value: StyleFormState[K]
) {
  styleForm[key] = value
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex-shrink-0 border-b bg-card/40 px-8 py-5">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-semibold tracking-tight">
            画风预设配置
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            管理项目创建时可选的画风范围与默认画风
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <input
            ref="styleImportInputRef"
            type="file"
            accept=".json,application/json"
            class="hidden"
            @change="handleStyleImport"
          >

          <!-- Secondary actions popover -->
          <div class="relative">
            <Button
              variant="outline"
              size="sm"
              class="h-9 gap-1.5 text-muted-foreground"
              :disabled="styleConfigLoading"
              @click="showMoreMenu = !showMoreMenu"
            >
              <MoreHorizontal class="h-4 w-4" />
              更多操作
            </Button>

            <Transition
              enter-active-class="transition duration-150 ease-out"
              enter-from-class="opacity-0 translate-y-1"
              enter-to-class="opacity-100 translate-y-0"
              leave-active-class="transition duration-100 ease-in"
              leave-from-class="opacity-100 translate-y-0"
              leave-to-class="opacity-0 translate-y-1"
            >
              <div
                v-if="showMoreMenu"
                class="absolute right-0 top-full z-30 mt-1.5 w-44 rounded-lg border bg-popover p-1 shadow-lg"
                @mouseleave="showMoreMenu = false"
              >
                <button
                  class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
                  @click="triggerStyleImport(); showMoreMenu = false"
                >
                  <Upload class="h-4 w-4 text-muted-foreground" />
                  {{ styleImporting ? '导入中...' : '导入预设' }}
                </button>
                <button
                  class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  :disabled="styleConfigLoading || styleCrudSaving || styleExporting"
                  @click="exportStylePresets(); showMoreMenu = false"
                >
                  <Download class="h-4 w-4 text-muted-foreground" />
                  {{ styleExporting ? '导出中...' : '导出预设' }}
                </button>
                <div class="my-1 border-t" />
                <button
                  class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  :disabled="styleConfigLoading || styleConfigSaving"
                  @click="enableAllStyles(); showMoreMenu = false"
                >
                  <CheckCheck class="h-4 w-4 text-muted-foreground" />
                  全部启用
                </button>
                <button
                  class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  :disabled="styleConfigLoading || styleCrudSaving || styleResetting"
                  @click="resetStylePresets(); showMoreMenu = false"
                >
                  <RotateCcw class="h-4 w-4" />
                  {{ styleResetting ? '重置中...' : '重置为默认' }}
                </button>
              </div>
            </Transition>
          </div>

          <!-- Primary actions -->
          <Button
            variant="outline"
            size="sm"
            class="h-9 gap-1.5"
            :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
            @click="openCreateStyleEditor"
          >
            <Plus class="h-4 w-4" />
            新增预设
          </Button>

          <Button
            size="sm"
            class="h-9 gap-1.5"
            :disabled="styleConfigLoading || styleConfigSaving || !hasStyleSelection || !hasStyleConfigChanges"
            @click="saveStyleConfig"
          >
            <Loader2
              v-if="styleConfigSaving"
              class="h-4 w-4 animate-spin"
            />
            保存配置
          </Button>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-8 py-6">
      <div
        v-if="styleConfigLoading"
        class="flex flex-col items-center justify-center py-24 text-muted-foreground"
      >
        <Loader2 class="h-8 w-8 animate-spin opacity-60" />
        <span class="mt-3 text-sm">加载画风配置中…</span>
      </div>

      <div
        v-else
        class="mx-auto max-w-[1400px] space-y-6"
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
