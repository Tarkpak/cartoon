<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loader2, FileText, Lock, Plus, TriangleAlert } from 'lucide-vue-next'
import SettingsPromptSidebar from '@/components/settings/SettingsPromptSidebar.vue'
import SettingsTextInputDialog from '@/components/settings/SettingsTextInputDialog.vue'
import SettingsConfirmDialog from '@/components/settings/SettingsConfirmDialog.vue'

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
  groupedPromptTemplates,
  activatePromptProfile,
  createPromptProfile,
  updatePromptProfileName,
  deletePromptProfile,
  selectPrompt,
  togglePromptStage,
  handlePromptUpdate,
  handlePromptSaved
} = useSettingsPrompts()

const promptFlowLabel = '解析 → 资产 → 视频'

type TextDialogMode = 'create' | 'rename' | 'copy'

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
    case 'copy':
      return {
        title: '创建可编辑副本',
        description: '将复制当前默认配置内容并切换到新副本，原默认配置会完整保留。',
        label: '副本名称',
        confirmText: '创建',
        initialValue: '我的配置'
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

function handleCreateEditableCopy() {
  openTextDialog('copy')
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

  // create / copy 共用同一接口：可编辑副本由后端基于当前默认内容复制
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
  <div class="h-full flex overflow-hidden">
    <div
      v-if="promptsLoading && !selectedPromptTemplate"
      class="flex flex-1 items-center justify-center text-muted-foreground"
    >
      <Loader2 class="h-6 w-6 animate-spin" />
      <span class="ml-2 text-sm">加载提示词模板中...</span>
    </div>

    <template v-else>
      <SettingsPromptSidebar
        :grouped-prompt-templates="groupedPromptTemplates"
        :active-profile-id="activePromptProfileId"
        :active-profile-readonly="isActiveReadonlyPromptProfile"
        :can-rename-profile="canRenameActivePromptProfile"
        :can-delete-profile="canDeleteActivePromptProfile"
        :profile-busy="promptProfileBusy"
        :profiles="promptProfiles"
        :prompt-count="promptTemplates.length"
        :prompts-loading="promptsLoading"
        :selected-prompt-id="selectedPromptId"
        :workflow-label="promptFlowLabel"
        @activate-profile="handleActivateProfile"
        @create-profile="handleCreateProfile"
        @delete-profile="handleDeleteProfile"
        @rename-profile="handleRenameProfile"
        @select-prompt="selectPrompt"
        @toggle-stage="togglePromptStage"
      />

      <div class="@container flex min-w-0 flex-1 flex-col overflow-hidden">
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
          v-if="isActiveReadonlyPromptProfile"
          class="flex flex-shrink-0 flex-col gap-3 border-b bg-amber-50 px-6 py-3 @2xl:flex-row @2xl:items-start dark:bg-amber-950/30"
        >
          <div class="flex min-w-0 flex-1 items-start gap-3">
            <Lock class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
                「默认配置」为只读基准模板，不可直接编辑
              </p>
              <p class="mt-0.5 text-xs leading-5 text-amber-700/90 dark:text-amber-300/80">
                创建一份可编辑副本（自动复制当前内容并切换过去）即可开始修改；原默认配置会完整保留，可在左侧「配置方案」随时切回。
              </p>
            </div>
          </div>
          <Button
            size="sm"
            class="flex-shrink-0"
            :disabled="promptProfileBusy"
            @click="handleCreateEditableCopy"
          >
            <Plus class="mr-1.5 h-4 w-4" />
            创建可编辑副本
          </Button>
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
