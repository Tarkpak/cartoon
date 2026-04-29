<script setup lang="ts">
import { Check, Loader2 } from 'lucide-vue-next'

defineProps<{
  stages: Array<{
    key: string
    label: string
    status: 'pending' | 'running' | 'done'
  }>
  activeStage: string
  autoRunError?: string | null
  saveError?: string | null
}>()

const emit = defineEmits<{
  'select-stage': [stage: string]
}>()
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-0">
      <template
        v-for="(stage, idx) in stages"
        :key="stage.key"
      >
        <!-- Connector line -->
        <div
          v-if="idx > 0"
          class="h-px flex-1 transition-colors duration-300"
          :class="stage.status === 'done' ? 'bg-emerald-500/40' : 'bg-border'"
        />
        <!-- Step button -->
        <Button
          type="button"
          variant="ghost"
          class="group relative h-auto gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200"
          :class="[
            activeStage === stage.key
              ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
              : stage.status === 'done'
                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                : stage.status === 'running'
                  ? 'bg-primary/10 text-primary hover:bg-primary/15'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
          ]"
          @click="emit('select-stage', stage.key)"
        >
          <!-- Step indicator -->
          <span
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors"
            :class="[
              activeStage === stage.key
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : stage.status === 'done'
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : stage.status === 'running'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted-foreground/10 text-muted-foreground'
            ]"
          >
            <Check
              v-if="stage.status === 'done'"
              class="h-3 w-3"
            />
            <Loader2
              v-else-if="stage.status === 'running'"
              class="h-3 w-3 animate-spin"
            />
            <span v-else>{{ idx + 1 }}</span>
          </span>
          <span class="whitespace-nowrap">{{ stage.label }}</span>
        </Button>
      </template>
    </div>
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
  </div>
</template>
