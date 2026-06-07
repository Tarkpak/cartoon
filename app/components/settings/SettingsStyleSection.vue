<script setup lang="ts">
import {
  Loader2,
  Plus,
  Upload,
  Download,
  RotateCcw,
  MoreHorizontal,
  CheckCheck,
  TriangleAlert
} from 'lucide-vue-next'
import type { StyleFormState } from '@/lib/style-preset-settings'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'
import SettingsStyleEditorDialog from '@/components/settings/SettingsStyleEditorDialog.vue'
import SettingsStyleOverview from '@/components/settings/SettingsStyleOverview.vue'
import SettingsStylePresetCatalog from '@/components/settings/SettingsStylePresetCatalog.vue'

const {
  styleConfigLoading,
  styleConfigError,
  styleConfigSaving,
  styleActionError,
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
  loadStyleConfig,
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
const deleteConfirmOpen = ref(false)
const resetConfirmOpen = ref(false)
const pendingDeleteStyleId = ref('')

const deleteConfirmDescription = computed(() => {
  return pendingDeleteStyleId.value
    ? `确定删除画风预设「${pendingDeleteStyleId.value}」吗？此操作不可撤销。`
    : ''
})

function updateStyleFormField<K extends keyof StyleFormState>(
  key: K,
  value: StyleFormState[K]
) {
  styleForm[key] = value
}

function requestDeleteStylePreset(styleId: string) {
  styleActionError.value = ''
  pendingDeleteStyleId.value = styleId
  deleteConfirmOpen.value = true
}

function requestResetStylePresets() {
  styleActionError.value = ''
  resetConfirmOpen.value = true
}

async function confirmDeleteStylePreset() {
  if (!pendingDeleteStyleId.value) return
  await deleteStylePreset(pendingDeleteStyleId.value)
  if (!styleActionError.value) {
    deleteConfirmOpen.value = false
    pendingDeleteStyleId.value = ''
  }
}

async function confirmResetStylePresets() {
  await resetStylePresets()
  if (!styleActionError.value) {
    resetConfirmOpen.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex-shrink-0 border-b px-6 py-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">
            画风预设
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            管理项目创建时可选的画风范围与默认画风
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <Input
            ref="styleImportInputRef"
            type="file"
            accept=".json,application/json"
            class="hidden"
            @change="handleStyleImport"
          />

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
                <Button
                  type="button"
                  variant="ghost"
                  class="h-auto w-full justify-start gap-2.5 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
                  @click="triggerStyleImport(); showMoreMenu = false"
                >
                  <Upload class="h-4 w-4 text-muted-foreground" />
                  {{ styleImporting ? '导入中...' : '导入预设' }}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  class="h-auto w-full justify-start gap-2.5 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  :disabled="styleConfigLoading || styleCrudSaving || styleExporting"
                  @click="exportStylePresets(); showMoreMenu = false"
                >
                  <Download class="h-4 w-4 text-muted-foreground" />
                  {{ styleExporting ? '导出中...' : '导出预设' }}
                </Button>
                <div class="my-1 border-t" />
                <Button
                  type="button"
                  variant="ghost"
                  class="h-auto w-full justify-start gap-2.5 rounded-md px-3 py-2 text-sm text-popover-foreground transition-colors hover:bg-accent"
                  :disabled="styleConfigLoading || styleConfigSaving"
                  @click="enableAllStyles(); showMoreMenu = false"
                >
                  <CheckCheck class="h-4 w-4 text-muted-foreground" />
                  全部启用
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  class="h-auto w-full justify-start gap-2.5 rounded-md px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  :disabled="styleConfigLoading || styleCrudSaving || styleResetting"
                  @click="requestResetStylePresets(); showMoreMenu = false"
                >
                  <RotateCcw class="h-4 w-4" />
                  {{ styleResetting ? '重置中...' : '重置为默认' }}
                </Button>
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
        v-else-if="styleConfigError && allStylePresets.length === 0"
        class="mx-auto flex max-w-3xl items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            画风预设加载失败
          </p>
          <p class="mt-1 break-words text-xs">
            {{ styleConfigError }}
          </p>
          <Button
            variant="outline"
            size="sm"
            class="mt-3 h-8 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            @click="loadStyleConfig"
          >
            重试
          </Button>
        </div>
      </div>

      <div
        v-else
        class="mx-auto max-w-[1400px] space-y-6"
      >
        <div
          v-if="styleConfigError || styleActionError"
          class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1 break-words">{{ styleActionError || styleConfigError }}</span>
        </div>

        <SettingsStyleOverview
          :all-style-presets="allStylePresets"
          :current-default-style="currentDefaultStyle"
          :enabled-style-count="enabledStyleCount"
          :style-default-id="styleDefaultId"
        />

        <SettingsStylePresetCatalog
          v-model:style-search-keyword="styleSearchKeyword"
          v-model:style-category-filter="styleCategoryFilter"
          :delete-style-preset="requestDeleteStylePreset"
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

    <SettingsConfirmDialog
      v-model:open="deleteConfirmOpen"
      title="删除画风预设"
      :description="deleteConfirmDescription"
      confirm-text="删除"
      :busy="styleDeletingId === pendingDeleteStyleId"
      :error="styleActionError"
      @confirm="confirmDeleteStylePreset"
    />

    <SettingsConfirmDialog
      v-model:open="resetConfirmOpen"
      title="重置画风预设"
      description="确定重置所有画风预设吗？此操作会恢复为系统默认预设。"
      confirm-text="重置"
      :busy="styleResetting"
      :error="styleActionError"
      @confirm="confirmResetStylePresets"
    />
  </div>
</template>
