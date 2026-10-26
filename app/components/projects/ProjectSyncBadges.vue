<script setup lang="ts">
import { projectAccessCan, PROJECT_ROLE_LABELS } from '#shared/types/project'
import type { Project } from '~/lib/projects-page'

defineProps<{
  project: Project
}>()

const emit = defineEmits<{
  (event: 'resolve-sync-conflict', project: Project): void
}>()
</script>

<template>
  <!-- Membership roles only: an admin sees every project, so "系统管理员" would be on every card. -->
  <Badge
    v-if="project.access && !project.access.isOwner && project.access.role !== 'admin'"
    variant="outline"
    class="shrink-0 whitespace-nowrap font-normal"
  >
    {{ PROJECT_ROLE_LABELS[project.access.role] }}
  </Badge>
  <Badge
    v-if="project.cloudSyncStatus === 'conflict'"
    variant="destructive"
    class="shrink-0 whitespace-nowrap"
    :title="`${project.cloudSyncError || '云端项目版本冲突'}。本地修改已保留，可点击处理同步冲突。`"
  >
    云同步冲突
  </Badge>
  <Button
    v-if="project.cloudSyncStatus === 'conflict' && (!project.access || projectAccessCan(project.access, 'edit'))"
    variant="outline"
    size="sm"
    class="h-6 shrink-0 px-2 text-xs"
    @click.stop="emit('resolve-sync-conflict', project)"
  >
    处理冲突
  </Button>
  <Badge
    v-else-if="project.cloudSyncStatus === 'pending' && project.cloudSyncError"
    variant="outline"
    class="shrink-0 whitespace-nowrap font-normal"
    :title="`云同步待重试：${project.cloudSyncError}`"
  >
    云同步待重试
  </Badge>
</template>
