<script setup lang="ts">
import { resolveProjectWorkbenchPath } from '#shared/types/project'

const route = useRoute()
const projectId = route.params.id as string

let targetPath = resolveProjectWorkbenchPath(projectId, 'classic')

try {
  const response = await $fetch<{
    success: boolean
    data?: {
      project?: {
        workflowType?: string
      }
    }
  }>(`/api/project/${projectId}`)

  targetPath = resolveProjectWorkbenchPath(
    projectId,
    response?.data?.project?.workflowType
  )
} catch (error) {
  console.error('[ProjectRedirect] 读取项目工作流失败，回退标准工作台:', error)
}

await navigateTo(targetPath, { redirectCode: 302 })
</script>

<template>
  <div />
</template>
