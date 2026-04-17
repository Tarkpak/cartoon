<script setup lang="ts">
import { CheckCircle2, Loader2 } from 'lucide-vue-next'

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
  <div class="space-y-1.5">
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-1.5 rounded-md border border-primary/20 bg-primary/[0.04] p-1.5">
      <Button
        v-for="stage in stages"
        :key="stage.key"
        type="button"
        variant="ghost"
        class="h-9 rounded-md border px-2 text-left transition focus-visible:outline-none"
        :class="[
          activeStage === stage.key
            ? 'border-primary/40 bg-accent text-foreground shadow-sm'
            : stage.status === 'done'
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : stage.status === 'running'
                ? 'border-primary/30 bg-primary/[0.06]'
                : 'border-input bg-background hover:border-primary/25'
        ]"
        @click="emit('select-stage', stage.key)"
      >
        <div class="flex items-center justify-between gap-1.5">
          <span class="text-[12px] font-medium truncate">{{ stage.label }}</span>
          <CheckCircle2
            v-if="stage.status === 'done'"
            class="h-3.5 w-3.5 shrink-0 text-emerald-600"
          />
          <Loader2
            v-else-if="stage.status === 'running'"
            class="h-3.5 w-3.5 shrink-0 animate-spin text-primary"
          />
          <span
            v-else
            class="text-[10px] shrink-0 text-muted-foreground"
          >待执行</span>
        </div>
      </Button>
    </div>
    <p
      v-if="autoRunError"
      class="text-xs text-destructive"
    >
      {{ autoRunError }}
    </p>
    <p
      v-if="saveError"
      class="text-xs text-destructive"
    >
      {{ saveError }}
    </p>
  </div>
</template>
