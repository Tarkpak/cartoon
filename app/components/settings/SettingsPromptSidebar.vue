<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  FileText
} from 'lucide-vue-next'
import type { PromptFlowStage } from '#shared/types/prompt-template'
import type { PromptTemplateGroup } from '@/composables/useSettingsPrompts'

const props = defineProps<{
  groupedPromptTemplates: PromptTemplateGroup[]
  selectedPromptId: string | null
  workflowLabel: string
  promptCount: number
  promptsLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'select-prompt', id: string): void
  (e: 'toggle-stage', stage: PromptFlowStage): void
}>()

const CATEGORY_ICON_CLASS: Record<string, string> = {
  blue: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/40 dark:border-blue-900',
  green: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-900',
  purple: 'text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-900',
  orange: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-300 dark:bg-orange-950/40 dark:border-orange-900'
}

function getIconClass(color: string) {
  return CATEGORY_ICON_CLASS[color] || 'text-muted-foreground bg-muted border-border'
}
</script>

<template>
  <div class="flex w-72 flex-shrink-0 flex-col border-r bg-muted/30">
    <div class="border-b px-4 py-4">
      <h2 class="text-base font-semibold">
        提示词配置
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ workflowLabel }}
      </p>
      <p class="mt-2 text-xs text-muted-foreground">
        共 {{ promptCount }} 个模板
      </p>
    </div>

    <div
      v-if="props.promptsLoading && props.groupedPromptTemplates.length === 0"
      class="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground"
    >
      加载模板中...
    </div>

    <div
      v-else
      class="flex-1 overflow-y-auto py-1"
    >
      <div
        v-for="group in props.groupedPromptTemplates"
        :key="group.stage"
        class="select-none"
      >
        <div
          class="flex cursor-pointer items-center gap-2 px-2 py-2 transition-colors hover:bg-accent/50"
          @click="emit('toggle-stage', group.stage)"
        >
          <component
            :is="group.expanded ? ChevronDown : ChevronRight"
            class="h-4 w-4 flex-shrink-0 text-muted-foreground"
          />
          <div
            class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border"
            :class="getIconClass(group.color)"
          >
            <component
              :is="group.icon"
              class="h-3.5 w-3.5"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">
              {{ group.name }}
            </div>
            <div class="text-[11px] text-muted-foreground">
              {{ group.templates.length }} 个模板
            </div>
          </div>
        </div>

        <div
          v-show="group.expanded"
          class="pb-1"
        >
          <button
            v-for="template in group.templates"
            :key="template.id"
            type="button"
            class="flex w-full items-start gap-2 py-2 pl-7 pr-2 text-left transition-colors"
            :class="template.id === props.selectedPromptId ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'"
            @click="emit('select-prompt', template.id)"
          >
            <div
              class="mt-1 flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full border-2"
              :class="template.id === props.selectedPromptId ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <div
                v-if="template.id === props.selectedPromptId"
                class="h-1.5 w-1.5 rounded-full bg-primary"
              />
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm">{{ template.name }}</span>
                <span
                  v-if="template.isCustomized"
                  class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                >
                  已改
                </span>
              </div>
              <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {{ template.description }}
              </p>
            </div>
          </button>
        </div>
      </div>

      <div
        v-if="props.groupedPromptTemplates.length === 0"
        class="px-4 py-8 text-center text-sm text-muted-foreground"
      >
        <FileText class="mx-auto mb-2 h-8 w-8 opacity-30" />
        当前工作流下没有可配置模板
      </div>
    </div>
  </div>
</template>
