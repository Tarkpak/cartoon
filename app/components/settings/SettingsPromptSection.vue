<script setup lang="ts">
import { Loader2, FileText } from 'lucide-vue-next'
import { PROJECT_WORKFLOW_LABELS } from '#shared/types/project'
import SettingsPromptSidebar from '@/components/settings/SettingsPromptSidebar.vue'

const {
  promptsLoading,
  promptProfileBusy,
  promptProfiles,
  activePromptProfileId,
  activePromptProfile,
  isActiveDefaultPromptProfile,
  canRenameActivePromptProfile,
  canDeleteActivePromptProfile,
  promptTemplates,
  selectedPromptId,
  selectedPromptTemplate,
  selectedPromptWorkflow,
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

async function handleCreateProfile() {
  const rawName = window.prompt('请输入新提示词配置名称', '新提示词配置')
  if (rawName === null) return

  const name = rawName.trim()
  if (!name) {
    window.alert('配置名称不能为空')
    return
  }

  const success = await createPromptProfile(name, '', true)
  if (!success) {
    window.alert('创建提示词配置失败，请稍后重试')
  }
}

async function handleRenameProfile() {
  if (!activePromptProfile.value || !canRenameActivePromptProfile.value) return

  const rawName = window.prompt('请输入新的配置名称', activePromptProfile.value.name)
  if (rawName === null) return

  const name = rawName.trim()
  if (!name) {
    window.alert('配置名称不能为空')
    return
  }

  const success = await updatePromptProfileName(
    activePromptProfile.value.id,
    name,
    activePromptProfile.value.description
  )
  if (!success) {
    window.alert('更新提示词配置失败，请稍后重试')
  }
}

async function handleDeleteProfile() {
  if (!activePromptProfile.value || !canDeleteActivePromptProfile.value) return

  const confirmed = window.confirm(`确定删除配置「${activePromptProfile.value.name}」吗？`)
  if (!confirmed) return

  const success = await deletePromptProfile(activePromptProfile.value.id)
  if (!success) {
    window.alert('删除提示词配置失败，请稍后重试')
  }
}

async function handleActivateProfile(profileId: string) {
  const success = await activatePromptProfile(profileId)
  if (!success) {
    window.alert('切换提示词配置失败，请稍后重试')
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
        :can-rename-profile="canRenameActivePromptProfile"
        :can-delete-profile="canDeleteActivePromptProfile"
        :profile-busy="promptProfileBusy"
        :profiles="promptProfiles"
        :prompt-count="promptTemplates.length"
        :prompts-loading="promptsLoading"
        :selected-prompt-id="selectedPromptId"
        :workflow-label="PROJECT_WORKFLOW_LABELS[selectedPromptWorkflow]"
        @activate-profile="handleActivateProfile"
        @create-profile="handleCreateProfile"
        @delete-profile="handleDeleteProfile"
        @rename-profile="handleRenameProfile"
        @select-prompt="selectPrompt"
        @toggle-stage="togglePromptStage"
      />

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="!selectedPromptTemplate"
          class="flex h-full flex-col items-center justify-center text-muted-foreground"
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
          :workflow="selectedPromptWorkflow"
          :readonly="isActiveDefaultPromptProfile"
          @update="handlePromptUpdate"
          @saved="handlePromptSaved"
        />
      </div>
    </template>
  </div>
</template>
