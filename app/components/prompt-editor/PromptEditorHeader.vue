<script setup lang="ts">
import {
  Save,
  RotateCcw,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  Download,
  Upload,
  GitCompare
} from 'lucide-vue-next'
import type { PromptTemplate } from '#shared/types/prompt-template'
import { promptCategoryColors, promptCategoryLabels } from '@/lib/prompt-editor'

defineProps<{
  template: PromptTemplate
  hasChanges: boolean
  readonly: boolean
  saving: boolean
  resetting: boolean
  showDiff: boolean
  isFullscreen: boolean
}>()

defineEmits<{
  (event: 'trigger-import' | 'export' | 'history' | 'reset' | 'toggle-diff' | 'save' | 'toggle-fullscreen'): void
}>()
</script>

<template>
  <div class="flex-shrink-0 border-b px-6 py-4">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-lg font-semibold">
            {{ template.name }}
          </h2>
          <span :class="['rounded px-2 py-0.5 text-xs', promptCategoryColors[template.category]]">
            {{ promptCategoryLabels[template.category] }}
          </span>
          <span
            v-if="template.isCustomized"
            class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900 dark:text-amber-300"
          >
            已修改
          </span>
          <span
            v-if="hasChanges"
            class="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300"
          >
            未保存
          </span>
          <span
            v-if="readonly"
            class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            默认配置只读
          </span>
        </div>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ template.description }}
        </p>
      </div>

      <div class="flex flex-shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          title="导入"
          :disabled="readonly"
          @click="$emit('trigger-import')"
        >
          <Upload class="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="导出"
          @click="$emit('export')"
        >
          <Download class="h-4 w-4" />
        </Button>
        <div class="mx-1 h-6 w-px bg-border" />

        <Button
          variant="outline"
          size="sm"
          :disabled="readonly"
          @click="$emit('history')"
        >
          <History class="mr-1.5 h-4 w-4" />
          历史
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="readonly || resetting || !template.isCustomized"
          @click="$emit('reset')"
        >
          <Loader2
            v-if="resetting"
            class="mr-1.5 h-4 w-4 animate-spin"
          />
          <RotateCcw
            v-else
            class="mr-1.5 h-4 w-4"
          />
          重置
        </Button>
        <Button
          v-if="hasChanges"
          variant="outline"
          size="sm"
          :disabled="readonly"
          @click="$emit('toggle-diff')"
        >
          <GitCompare class="mr-1.5 h-4 w-4" />
          {{ showDiff ? '隐藏差异' : '查看差异' }}
        </Button>
        <Button
          size="sm"
          :disabled="readonly || saving || !hasChanges"
          @click="$emit('save')"
        >
          <Loader2
            v-if="saving"
            class="mr-1.5 h-4 w-4 animate-spin"
          />
          <Save
            v-else
            class="mr-1.5 h-4 w-4"
          />
          保存
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :title="isFullscreen ? '退出全屏' : '全屏编辑'"
          @click="$emit('toggle-fullscreen')"
        >
          <Minimize2
            v-if="isFullscreen"
            class="h-4 w-4"
          />
          <Maximize2
            v-else
            class="h-4 w-4"
          />
        </Button>
      </div>
    </div>
  </div>
</template>
