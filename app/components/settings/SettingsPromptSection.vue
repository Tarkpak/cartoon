<script setup lang="ts">
import { Loader2, FileText, Lock, Plus } from 'lucide-vue-next'
import SettingsPromptSidebar from '@/components/settings/SettingsPromptSidebar.vue'

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

async function promptCreateProfile(message: string, defaultName: string) {
  const rawName = window.prompt(message, defaultName)
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

function handleCreateProfile() {
  return promptCreateProfile('请输入新提示词配置名称', '新提示词配置')
}

function handleCreateEditableCopy() {
  return promptCreateProfile('为可编辑副本命名（将复制当前默认配置内容）', '我的配置')
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

      <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="isActiveReadonlyPromptProfile"
          class="flex flex-shrink-0 items-start gap-3 border-b bg-amber-50 px-6 py-3 dark:bg-amber-950/30"
        >
          <Lock class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-amber-800 dark:text-amber-200">
              「默认配置」为只读基准模板，不可直接编辑
            </p>
            <p class="mt-0.5 text-xs leading-5 text-amber-700/90 dark:text-amber-300/80">
              创建一份可编辑副本（自动复制当前内容并切换过去）即可开始修改；原默认配置会完整保留，可在左侧「配置方案」随时切回。
            </p>
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
  </div>
</template>
