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
  promptTemplates,
  selectedPromptId,
  selectedPromptTemplate,
  activePromptStageTemplates,
  activatePromptProfile,
  createPromptProfile,
  updatePromptProfileName,
  deletePromptProfile,
  selectPrompt,
  handlePromptUpdate,
  handlePromptSaved
} = useSettingsPrompts()

type TextDialogMode = 'create' | 'rename'

const textDialogOpen = ref(false)
const textDialogMode = ref<TextDialogMode>('create')
const textDialogError = ref('')

const deleteDialogOpen = ref(false)
const deleteDialogError = ref('')

const activateError = ref('')

const selectedPromptValue = computed({
  get: () => selectedPromptId.value || '',
  set: (templateId: string) => {
    if (!templateId) return
    selectPrompt(templateId)
  }
})

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
  openTextDialog('create')
}

function handleRenameProfile() {
  if (!activePromptProfile.value || !canRenameActivePromptProfile.value) return
  openTextDialog('rename')
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
  deleteDialogError.value = ''
  deleteDialogOpen.value = true
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
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <div
      v-if="promptsLoading && !selectedPromptTemplate"
      class="flex flex-1 items-center justify-center text-muted-foreground"
    >
      <Loader2 class="h-6 w-6 animate-spin" />
      <span class="ml-2 text-sm">加载提示词模板中...</span>
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
                模板
              </span>
              <Select
                v-if="activePromptStageTemplates.length > 0"
                v-model="selectedPromptValue"
              >
                <SelectTrigger class="h-9 w-full min-w-0 bg-background text-sm sm:w-[360px]">
                  <div
                    v-if="selectedPromptTemplate"
                    class="flex min-w-0 items-center gap-2"
                  >
                    <FileText class="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span class="truncate">{{ selectedPromptTemplate.name }}</span>
                    <span
                      v-if="selectedPromptTemplate.isCustomized && !isActiveReadonlyPromptProfile"
                      class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    >
                      已自定义
                    </span>
                  </div>
                  <span
                    v-else
                    class="text-muted-foreground"
                  >
                    选择提示词模板
                  </span>
                </SelectTrigger>
                <SelectContent class="max-h-[420px] sm:w-[420px]">
                  <SelectItem
                    v-for="template in activePromptStageTemplates"
                    :key="template.id"
                    :value="template.id"
                    class="items-start py-2 pl-2 pr-8"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-1.5">
                        <span class="truncate text-sm font-medium">{{ template.name }}</span>
                        <span
                          v-if="template.isCustomized && !isActiveReadonlyPromptProfile"
                          class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                        >
                          已自定义
                        </span>
                      </div>
                      <div class="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {{ template.description }}
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <span
                v-else
                class="text-sm text-muted-foreground"
              >
                当前阶段暂无模板
              </span>
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

        <div
          v-if="!selectedPromptTemplate"
          class="flex min-h-0 flex-1 flex-col items-center justify-center text-muted-foreground"
        >
          <FileText class="mb-3 h-12 w-12 opacity-20" />
          <p class="text-sm">
            请选择一个提示词模板进行编辑
          </p>
        </div>

        <PromptEditor
          v-else
          :key="selectedPromptTemplate.id"
          class="min-h-0 flex-1"
          :template="selectedPromptTemplate"
          :readonly="isActiveReadonlyPromptProfile"
          @update="handlePromptUpdate"
          @saved="handlePromptSaved"
        />
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
