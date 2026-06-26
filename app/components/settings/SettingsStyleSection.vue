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
import SettingsStylePresetCatalog from '@/components/settings/SettingsStylePresetCatalog.vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

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
  <div class="flex h-full flex-col overflow-hidden">
    <div class="bg-background px-4 py-2.5 md:px-6">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span class="shrink-0 text-sm font-medium text-muted-foreground">
            画风范围
          </span>
          <span class="rounded-md border bg-muted/30 px-2.5 py-1 text-sm text-muted-foreground">
            总预设
            <span class="ml-1 font-semibold tabular-nums text-foreground">{{ allStylePresets.length }}</span>
          </span>
          <span class="rounded-md border bg-muted/30 px-2.5 py-1 text-sm text-muted-foreground">
            已启用
            <span class="ml-1 font-semibold tabular-nums text-foreground">{{ enabledStyleCount }}</span>
            <span class="text-muted-foreground/70"> / {{ allStylePresets.length }}</span>
          </span>
          <span class="min-w-0 rounded-md border bg-muted/30 px-2.5 py-1 text-sm text-muted-foreground">
            默认
            <span class="ml-1 font-medium text-foreground">{{ currentDefaultStyle?.name || '未设置' }}</span>
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Input
            ref="styleImportInputRef"
            type="file"
            accept=".json,application/json"
            class="hidden"
            @change="handleStyleImport"
          />

          <!-- Secondary actions -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                size="sm"
                class="h-9 gap-1.5 text-muted-foreground"
                :disabled="styleConfigLoading"
              >
                <MoreHorizontal class="h-4 w-4" />
                更多操作
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              class="w-44"
            >
              <DropdownMenuItem
                :disabled="styleConfigLoading || styleCrudSaving || styleImporting"
                @select="triggerStyleImport"
              >
                <Upload class="h-4 w-4 text-muted-foreground" />
                {{ styleImporting ? '导入中...' : '导入预设' }}
              </DropdownMenuItem>
              <DropdownMenuItem
                :disabled="styleConfigLoading || styleCrudSaving || styleExporting"
                @select="exportStylePresets"
              >
                <Download class="h-4 w-4 text-muted-foreground" />
                {{ styleExporting ? '导出中...' : '导出预设' }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                :disabled="styleConfigLoading || styleConfigSaving"
                @select="enableAllStyles"
              >
                <CheckCheck class="h-4 w-4 text-muted-foreground" />
                全部启用
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                :disabled="styleConfigLoading || styleCrudSaving || styleResetting"
                @select="requestResetStylePresets"
              >
                <RotateCcw class="h-4 w-4" />
                {{ styleResetting ? '重置中...' : '重置为默认' }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
      <div
        v-if="styleConfigLoading"
        class="flex flex-col items-center justify-center py-24 text-muted-foreground"
      >
        <Loader2 class="h-8 w-8 animate-spin opacity-60" />
        <span class="mt-3 text-sm">加载画风配置中…</span>
      </div>

      <div
        v-else-if="styleConfigError && allStylePresets.length === 0"
        class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
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
        class="space-y-4"
      >
        <div
          v-if="styleConfigError || styleActionError"
          class="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1 break-words">{{ styleActionError || styleConfigError }}</span>
        </div>

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
