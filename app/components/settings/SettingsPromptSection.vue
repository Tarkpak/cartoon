<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert
} from 'lucide-vue-next'
import SettingsTextInputDialog from '@/components/settings/SettingsTextInputDialog.vue'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'
import SettingsDirectorPreferencesEditor from '@/components/settings/SettingsDirectorPreferencesEditor.vue'
import SettingsPlainPromptEditor from '@/components/settings/SettingsPlainPromptEditor.vue'
import type { PromptTemplate } from '#shared/types/prompt-template'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const {
  promptsLoading,
  promptProfileBusy,
  promptProfiles,
  activePromptProfileId,
  activePromptProfile,
  isActiveReadonlyPromptProfile,
  canRenameActivePromptProfile,
  canDeleteActivePromptProfile,
  directorPreferences,
  directorPreferencesSaving,
  directorPreferencesError,
  promptTemplates,
  activePromptStage,
  activePromptStageTemplates,
  activatePromptProfile,
  createPromptProfile,
  updatePromptProfileName,
  deletePromptProfile,
  saveDirectorPreferences,
  selectPrompt,
  handlePromptUpdate
} = useSettingsPrompts()

const DIRECTOR_EDITOR_ID = 'director_preferences'
const REPLACED_SCRIPT_TEMPLATE_IDS = new Set([
  'script_parsing',
  'script_parsing_episode_drama_context'
])
const PROMPT_EDITOR_ORDER: Record<string, number> = {
  script_episode_plan: 10,
  director_preferences: 20,
  scene_description_refinement: 30,
  video_import_script_generation: 40,
  origin_explainer_planning: 50,
  character_sheet: 10,
  character_regeneration: 20,
  environment_reference_generation: 30,
  prop_asset_generation: 40,
  scene_video_generation: 10,
  origin_explainer_video_generation: 20
}

type PromptEditorOption = {
  id: string
  name: string
  description: string
  isCustomized: boolean
}

const selectedEditorId = ref('')

const editableStageTemplates = computed(() => {
  return activePromptStageTemplates.value.filter(template => !REPLACED_SCRIPT_TEMPLATE_IDS.has(template.id))
})

const promptEditorOptions = computed<PromptEditorOption[]>(() => {
  const options = editableStageTemplates.value.map(template => ({
    id: template.id,
    name: template.name,
    description: template.description,
    isCustomized: template.isCustomized
  }))

  if (activePromptStage.value === 'parse') {
    options.push({
      id: DIRECTOR_EDITOR_ID,
      name: '分镜解析提示词',
      description: '控制剧本拆场、镜头语言、节奏、表演与连续性。',
      isCustomized: false
    })
  }

  return options.sort((left, right) => {
    return (PROMPT_EDITOR_ORDER[left.id] ?? Number.MAX_SAFE_INTEGER)
      - (PROMPT_EDITOR_ORDER[right.id] ?? Number.MAX_SAFE_INTEGER)
  })
})

const selectedEditorOption = computed(() => {
  return promptEditorOptions.value.find(option => option.id === selectedEditorId.value) || null
})

const selectedStandardTemplate = computed<PromptTemplate | null>(() => {
  if (!selectedEditorId.value || selectedEditorId.value === DIRECTOR_EDITOR_ID) return null
  return promptTemplates.value.find(template => template.id === selectedEditorId.value) || null
})

watch([activePromptStage, promptEditorOptions], () => {
  if (promptEditorOptions.value.some(option => option.id === selectedEditorId.value)) return

  const nextId = promptEditorOptions.value[0]?.id || ''
  selectedEditorId.value = nextId
  if (nextId && nextId !== DIRECTOR_EDITOR_ID) {
    selectPrompt(nextId)
  }
}, { immediate: true })

function handleSelectEditor(templateId: string) {
  selectedEditorId.value = templateId
  if (templateId !== DIRECTOR_EDITOR_ID) {
    selectPrompt(templateId)
  }
}

type TextDialogMode = 'create' | 'rename'

const textDialogOpen = ref(false)
const textDialogMode = ref<TextDialogMode>('create')
const textDialogError = ref('')

const deleteDialogOpen = ref(false)
const deleteDialogError = ref('')

const activateError = ref('')

const textDialogConfig = computed(() => {
  switch (textDialogMode.value) {
    case 'rename':
      return {
        title: '重命名配置方案',
        description: '为当前配置方案设置新名称。',
        label: '配置名称',
        confirmText: '保存',
        initialValue: activePromptProfile.value?.name || ''
      }
    case 'create':
    default:
      return {
        title: '新建配置方案',
        description: '创建一个新的配置方案。',
        label: '配置名称',
        confirmText: '创建',
        initialValue: '新配置方案'
      }
  }
})

const deleteDialogDescription = computed(() => {
  return activePromptProfile.value
    ? `确定删除配置「${activePromptProfile.value.name}」吗？此操作不可撤销。`
    : ''
})

function openTextDialog(mode: TextDialogMode) {
  textDialogMode.value = mode
  textDialogError.value = ''
  textDialogOpen.value = true
}

function handleCreateProfile() {
  // Let the dropdown release its body interaction lock before opening a modal.
  setTimeout(() => openTextDialog('create'), 0)
}

function handleRenameProfile() {
  if (!activePromptProfile.value || !canRenameActivePromptProfile.value) return
  setTimeout(() => openTextDialog('rename'), 0)
}

async function handleTextDialogConfirm(name: string) {
  textDialogError.value = ''

  if (textDialogMode.value === 'rename') {
    if (!activePromptProfile.value) return
    const success = await updatePromptProfileName(
      activePromptProfile.value.id,
      name,
      activePromptProfile.value.description
    )
    if (success) {
      textDialogOpen.value = false
    } else {
      textDialogError.value = '更新配置方案失败，请稍后重试'
    }
    return
  }

  const success = await createPromptProfile(name, '', true)
  if (success) {
    textDialogOpen.value = false
  } else {
    textDialogError.value = '创建配置方案失败，请稍后重试'
  }
}

function handleDeleteProfile() {
  if (!activePromptProfile.value || !canDeleteActivePromptProfile.value) return
  setTimeout(() => {
    deleteDialogError.value = ''
    deleteDialogOpen.value = true
  }, 0)
}

async function handleDeleteConfirm() {
  if (!activePromptProfile.value) return
  deleteDialogError.value = ''
  const success = await deletePromptProfile(activePromptProfile.value.id)
  if (success) {
    deleteDialogOpen.value = false
  } else {
    deleteDialogError.value = '删除配置方案失败，请稍后重试'
  }
}

async function handleActivateProfile(profileId: string) {
  activateError.value = ''
  const success = await activatePromptProfile(profileId)
  if (!success) {
    activateError.value = '切换配置方案失败，请稍后重试'
  }
}

async function handleDirectorPreferencesSave(content: string) {
  await saveDirectorPreferences(content)
}
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div
      v-if="promptsLoading"
      class="flex flex-1 items-center justify-center text-muted-foreground"
    >
      <Loader2 class="h-6 w-6 animate-spin" />
      <span class="ml-2 text-sm">加载提示词配置中...</span>
    </div>

    <template v-else>
      <div class="@container flex min-w-0 flex-1 flex-col overflow-hidden">
        <div class="bg-background px-4 py-2.5 md:px-6">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span class="shrink-0 text-sm font-medium text-muted-foreground">
                配置方案
              </span>
              <Select
                :model-value="activePromptProfileId"
                :disabled="promptProfileBusy || promptProfiles.length === 0"
                @update:model-value="handleActivateProfile(String($event))"
              >
                <SelectTrigger class="h-9 w-full text-sm sm:w-56">
                  <SelectValue placeholder="选择配置方案" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="profile in promptProfiles"
                    :key="profile.id"
                    :value="profile.id"
                  >
                    {{ profile.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-9 gap-1.5"
                    :disabled="promptProfileBusy"
                  >
                    <MoreHorizontal class="h-4 w-4" />
                    方案管理
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  class="w-44"
                >
                  <DropdownMenuLabel class="text-xs text-muted-foreground">
                    配置方案
                  </DropdownMenuLabel>
                  <DropdownMenuItem @select="handleCreateProfile">
                    <Plus class="h-4 w-4 text-muted-foreground" />
                    新建方案
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    :disabled="!canRenameActivePromptProfile"
                    @select="handleRenameProfile"
                  >
                    <Pencil class="h-4 w-4 text-muted-foreground" />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    :disabled="!canDeleteActivePromptProfile"
                    @select="handleDeleteProfile"
                  >
                    <Trash2 class="h-4 w-4" />
                    删除方案
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div class="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-2 xl:justify-end">
              <span class="shrink-0 text-sm font-medium text-muted-foreground">
                提示词
              </span>
              <Select
                :model-value="selectedEditorId"
                :disabled="promptEditorOptions.length === 0"
                @update:model-value="handleSelectEditor(String($event))"
              >
                <SelectTrigger class="h-9 w-full min-w-0 bg-background text-sm sm:w-[360px]">
                  <div
                    v-if="selectedEditorOption"
                    class="flex min-w-0 items-center gap-2"
                  >
                    <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ selectedEditorOption.name }}</span>
                    <span
                      v-if="selectedEditorOption.isCustomized && !isActiveReadonlyPromptProfile"
                      class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    >
                      已自定义
                    </span>
                  </div>
                  <SelectValue
                    v-else
                    placeholder="选择提示词"
                  />
                </SelectTrigger>
                <SelectContent class="max-h-[420px] sm:w-[420px]">
                  <SelectItem
                    v-for="option in promptEditorOptions"
                    :key="option.id"
                    :value="option.id"
                    class="items-start py-2 pl-2 pr-8"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <span class="truncate text-sm font-medium">{{ option.name }}</span>
                        <span
                          v-if="option.isCustomized && !isActiveReadonlyPromptProfile"
                          class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                        >
                          已自定义
                        </span>
                      </div>
                      <div class="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {{ option.description }}
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div
          v-if="activateError"
          class="flex flex-shrink-0 items-center gap-2 border-b bg-destructive/5 px-6 py-2.5 text-sm text-destructive"
        >
          <TriangleAlert class="h-4 w-4 flex-shrink-0" />
          <span class="min-w-0 flex-1">{{ activateError }}</span>
          <button
            type="button"
            class="flex-shrink-0 text-xs text-destructive/80 transition-colors hover:text-destructive"
            @click="activateError = ''"
          >
            关闭
          </button>
        </div>

        <SettingsDirectorPreferencesEditor
          v-if="selectedEditorId === DIRECTOR_EDITOR_ID"
          :content="directorPreferences"
          :readonly="isActiveReadonlyPromptProfile"
          :saving="directorPreferencesSaving"
          :error="directorPreferencesError"
          @create-profile="handleCreateProfile"
          @save="handleDirectorPreferencesSave"
        />

        <SettingsPlainPromptEditor
          v-else-if="selectedStandardTemplate"
          :key="selectedStandardTemplate.id"
          :template="selectedStandardTemplate"
          :readonly="isActiveReadonlyPromptProfile"
          @update="handlePromptUpdate"
        />

        <div
          v-else
          class="flex min-h-0 flex-1 flex-col items-center justify-center text-muted-foreground"
        >
          <FileText class="mb-3 h-10 w-10 opacity-20" />
          <p class="text-sm">当前阶段暂无可编辑提示词</p>
        </div>
      </div>
    </template>

    <SettingsTextInputDialog
      v-model:open="textDialogOpen"
      :title="textDialogConfig.title"
      :description="textDialogConfig.description"
      :label="textDialogConfig.label"
      :initial-value="textDialogConfig.initialValue"
      :confirm-text="textDialogConfig.confirmText"
      :busy="promptProfileBusy"
      :error="textDialogError"
      @confirm="handleTextDialogConfirm"
    />

    <SettingsConfirmDialog
      v-model:open="deleteDialogOpen"
      title="删除配置方案"
      :description="deleteDialogDescription"
      confirm-text="删除"
      :busy="promptProfileBusy"
      :error="deleteDialogError"
      @confirm="handleDeleteConfirm"
    />
  </div>
</template>
