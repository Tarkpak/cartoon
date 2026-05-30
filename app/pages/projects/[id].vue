<script setup lang="ts">
import type { ProjectWorkbenchStage } from '#shared/types/project'
import { resolveProjectWorkbenchPath } from '#shared/types/project'

definePageMeta({
  layout: 'default',
  hideSidebar: true
})

const route = useRoute()

const projectId = computed(() => {
  const raw = route.params.id
  return typeof raw === 'string' ? raw.trim() : ''
})

function normalizeStage(value: unknown): ProjectWorkbenchStage | undefined {
  if (value === 'parse' || value === 'assets' || value === 'videos' || value === 'final') {
    return value
  }
  return undefined
}

const stage = computed<ProjectWorkbenchStage | undefined>(() => {
  const queryStage = Array.isArray(route.query.stage) ? route.query.stage[0] : route.query.stage
  return normalizeStage(queryStage)
})

watch(
  () => [projectId.value, stage.value] as const,
  ([id, nextStage]) => {
    if (id) {
      void navigateTo(resolveProjectWorkbenchPath(id, nextStage), { replace: true })
      return
    }
    void navigateTo('/projects', { replace: true })
  },
  { immediate: true }
)
</script>

<template>
  <div class="sr-only" aria-live="polite">Redirecting...</div>
</template>
