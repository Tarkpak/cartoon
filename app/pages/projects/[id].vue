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

if (projectId.value) {
  await navigateTo(resolveProjectWorkbenchPath(projectId.value, undefined, stage.value), { replace: true })
} else {
  await navigateTo('/projects', { replace: true })
}
</script>
