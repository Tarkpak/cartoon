<script setup lang="ts">
import type { WorkflowCategoryKey, WorkflowCategorySummary } from '@/composables/useSettingsWorkflowModels'

const props = defineProps<{
  categories: WorkflowCategorySummary[]
  activeCategory: WorkflowCategoryKey
}>()

const emit = defineEmits<{
  (e: 'select-category', category: WorkflowCategoryKey): void
}>()

const CATEGORY_ICON_CLASS: Record<string, string> = {
  blue: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900',
  green: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900',
  purple: 'text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-900'
}

function getIconClass(color: string) {
  return CATEGORY_ICON_CLASS[color] || 'text-muted-foreground bg-muted border-border'
}
</script>

<template>
  <div class="flex w-64 flex-shrink-0 flex-col border-r bg-muted/30">
    <div class="border-b px-4 py-4">
      <h2 class="text-base font-semibold">
        业务模型配置
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        左侧切换模型类型，右侧查看对应业务模型详情。
      </p>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <button
        v-for="category in props.categories"
        :key="category.key"
        type="button"
        class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors"
        :class="category.key === props.activeCategory
          ? 'bg-primary/10 text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'"
        @click="emit('select-category', category.key)"
      >
        <div
          class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border"
          :class="getIconClass(category.color)"
        >
          <component
            :is="category.icon"
            class="h-4 w-4"
          />
        </div>

        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {{ category.name }}
          </div>
          <div class="mt-0.5 text-xs text-muted-foreground">
            {{ category.workflowCount }} 个流程
          </div>
        </div>
      </button>
    </div>
  </div>
</template>
