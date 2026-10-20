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
  saveWarning?: string | null
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
          class="mx-1 h-px w-3 shrink-0 transition-colors duration-300"
          :class="stage.status === 'done' ? 'bg-emerald-500/40' : 'bg-border'"
        />
        <!-- Step button -->
        <Button
          type="button"
          variant="ghost"
          class="group relative h-8 gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150"
          :class="[
            activeStage === stage.key
              ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/15'
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
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors"
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
    <p
      v-if="saveWarning"
      class="rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300"
    >
      {{ saveWarning }}
    </p>
  </div>
</template>
