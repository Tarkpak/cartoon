<script setup lang="ts">
import { Check, Loader2 } from 'lucide-vue-next'

defineProps<{
  stages: Array<{
    key: string
    label: string
    status: 'pending' | 'running' | 'done'
    progress?: string
    progressTitle?: string
    hasError?: boolean
  }>
  activeStage: string
  autoRunError?: string | null
  saveError?: string | null
  saveWarning?: string | null
}>()

const emit = defineEmits<{
  'select-stage': [stage: string]
}>()
</script>

<template>
  <div class="space-y-2">
    <nav class="flex items-center" aria-label="工作台阶段">
      <template
        v-for="(stage, idx) in stages"
        :key="stage.key"
      >
        <div
          v-if="idx > 0"
          class="mx-1 h-px w-4 shrink-0 transition-colors duration-300"
          :class="stages[idx - 1].status === 'done' ? 'bg-emerald-500/50' : 'bg-border'"
          aria-hidden="true"
        />
        <button
          type="button"
          class="group inline-flex h-8 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.98]"
          :class="activeStage === stage.key
            ? 'bg-primary font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90'
            : stage.status === 'running'
              ? 'font-medium text-primary hover:bg-primary/10'
              : stage.status === 'done'
                ? 'font-medium text-foreground hover:bg-muted'
                : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'"
          :aria-current="activeStage === stage.key ? 'step' : undefined"
          :title="stage.progressTitle"
          @click="emit('select-stage', stage.key)"
        >
          <span
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
            :class="activeStage === stage.key
              ? 'bg-primary-foreground/20 text-primary-foreground'
              : stage.status === 'done'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : stage.status === 'running'
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted text-muted-foreground'"
          >
            <Loader2
              v-if="stage.status === 'running'"
              class="h-3.5 w-3.5 animate-spin"
            />
            <Check
              v-else-if="stage.status === 'done'"
              class="h-3.5 w-3.5"
              :stroke-width="2.5"
            />
            <span v-else>{{ idx + 1 }}</span>
          </span>
          <span class="whitespace-nowrap">{{ stage.label }}</span>
          <span
            v-if="stage.progress"
            class="inline-flex items-center gap-1 whitespace-nowrap font-normal tabular-nums"
            :class="activeStage === stage.key ? 'text-primary-foreground/80' : 'text-muted-foreground'"
          >
            {{ stage.progress }}
            <span
              v-if="stage.hasError"
              class="h-1.5 w-1.5 rounded-full bg-destructive"
              aria-label="有失败项"
            />
          </span>
        </button>
      </template>
    </nav>
    <p
      v-if="autoRunError"
      class="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
    >
      {{ autoRunError }}
    </p>
    <p
      v-if="saveError"
      class="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
    >
      {{ saveError }}
    </p>
    <p
      v-if="saveWarning"
      class="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300"
    >
      {{ saveWarning }}
    </p>
  </div>
</template>
