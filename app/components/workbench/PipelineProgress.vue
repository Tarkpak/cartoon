<script setup lang="ts">
import type { PipelineStatus } from '~/composables/useWorkbench'

defineProps<{
  status: PipelineStatus
}>()
</script>

<template>
  <div
    v-if="status.running || status.progress === 100"
    class="mt-6"
  >
    <Card>
      <CardContent class="pt-6">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">{{ status.currentStep }}</span>
          <span class="text-sm text-muted-foreground">{{ status.progress }}%</span>
        </div>
        <div class="h-2 bg-muted rounded-full overflow-hidden">
          <div
            class="h-full bg-primary transition-all duration-300"
            :style="{ width: `${status.progress}%` }"
          />
        </div>
        <p
          v-if="status.error"
          class="mt-2 text-sm text-destructive"
        >
          {{ status.error }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
