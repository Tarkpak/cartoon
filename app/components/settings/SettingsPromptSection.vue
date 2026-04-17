<script setup lang="ts">
import { Loader2, FileText } from 'lucide-vue-next'
import { PROJECT_WORKFLOW_LABELS } from '#shared/types/project'
import SettingsPromptSidebar from '@/components/settings/SettingsPromptSidebar.vue'

const {
  promptsLoading,
  promptTemplates,
  selectedPromptId,
  selectedPromptTemplate,
  selectedPromptWorkflow,
  groupedPromptTemplates,
  selectPrompt,
  togglePromptCategory,
  handlePromptUpdate,
  handlePromptSaved
} = useSettingsPrompts()
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
        :prompt-count="promptTemplates.length"
        :prompts-loading="promptsLoading"
        :selected-prompt-id="selectedPromptId"
        :workflow-label="PROJECT_WORKFLOW_LABELS[selectedPromptWorkflow]"
        @select-prompt="selectPrompt"
        @toggle-category="togglePromptCategory"
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
          @update="handlePromptUpdate"
          @saved="handlePromptSaved"
        />
      </div>
    </template>
  </div>
</template>
