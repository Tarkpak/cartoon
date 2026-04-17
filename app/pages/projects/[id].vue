<script setup lang="ts">
import { resolveProjectWorkbenchPath } from '#shared/types/project'

const route = useRoute()
const projectId = route.params.id as string

// 统一跳转到 asset-workbench
const targetPath = resolveProjectWorkbenchPath(projectId)

await navigateTo(targetPath, { redirectCode: 302 })
</script>

<template>
  <div />
</template>
