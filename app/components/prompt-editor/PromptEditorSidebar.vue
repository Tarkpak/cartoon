<script setup lang="ts">
import { Plus, CheckCircle2 } from 'lucide-vue-next'
import type { PromptTemplate } from '#shared/types/prompt-template'
import {
  getPromptVariableTag,
  type PromptVariableValidation
} from '@/lib/prompt-editor'

defineProps<{
  template: PromptTemplate
  previewMode: boolean
  readonly: boolean
  previewVariables: Record<string, string>
  variableValidation: PromptVariableValidation
  isVarUnused: (varName: string) => boolean
}>()

const emit = defineEmits<{
  (e: 'insert-variable', variableName: string): void
  (e: 'update-preview-variable', payload: { name: string, value: string }): void
}>()
</script>

<template>
  <div class="w-72 flex-shrink-0 border-l flex flex-col overflow-hidden">
    <div class="flex-1 overflow-auto p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Plus class="h-4 w-4 text-muted-foreground" />
          <span class="text-sm font-medium">可用变量</span>
        </div>
        <span
          v-if="variableValidation.isValid"
          class="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"
        >
          <CheckCircle2 class="h-3 w-3" />
          校验通过
        </span>
      </div>
      <div class="space-y-2">
        <div
          v-for="variable in template.variables"
          :key="variable.name"
          class="group"
        >
          <Button
            variant="ghost"
            size="sm"
            :class="[
              'w-full h-auto min-w-0 justify-start p-2 rounded border transition-colors flex-col items-start gap-1 whitespace-normal text-left',
              isVarUnused(variable.name)
                ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20'
                : 'hover:bg-muted'
            ]"
            :disabled="readonly"
            @click="emit('insert-variable', variable.name)"
          >
            <code class="max-w-full break-all text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{{ getPromptVariableTag(variable.name) }}</code>
            <p class="w-full text-xs text-muted-foreground leading-5 break-words">
              {{ variable.description }}
            </p>
            <p
              v-if="variable.example"
              class="w-full text-xs text-muted-foreground/70 leading-5 break-words"
            >
              示例: {{ variable.example }}
            </p>
          </Button>
        </div>
      </div>
    </div>

    <div
      v-if="previewMode"
      class="border-t p-4"
    >
      <div class="text-sm font-medium mb-2">
        预览变量值
      </div>
      <div class="space-y-2 max-h-40 overflow-auto">
        <div
          v-for="variable in template.variables"
          :key="variable.name"
        >
          <label class="text-xs text-muted-foreground">{{ variable.name }}</label>
          <Input
            :model-value="previewVariables[variable.name] || ''"
            :placeholder="variable.example"
            class="h-7 text-xs"
            @update:model-value="emit('update-preview-variable', { name: variable.name, value: String($event ?? '') })"
          />
        </div>
      </div>
    </div>
  </div>
</template>
