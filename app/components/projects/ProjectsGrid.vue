<script setup lang="ts">
import { Clapperboard, Loader2, Plus, Trash2, Users } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import { projectAccessCan } from '#shared/types/project'
import { SCRIPT_PARSE_MODE_LABELS, normalizeScriptParseMode } from '#shared/types/script'
import {
  formatProjectDateTime,
  formatProjectRelativeTime,
  resolveProjectProgress,
  type Project
} from '~/lib/projects-page'
import ProjectSyncBadges from './ProjectSyncBadges.vue'

defineProps<{
  class?: string
  projects: Project[]
  loading: boolean
  error: string | null
  hasActiveFilters: boolean
  getStyleName: (styleId: string) => string
}>()

const emit = defineEmits<{
  (event: 'open-create'): void
  (event: 'open-project', project: Project): void
  (event: 'manage-members', project: Project): void
  (event: 'resolve-sync-conflict', project: Project): void
  (event: 'confirm-delete', project: Project, domEvent: Event): void
}>()

function resolveMeta(project: Project, styleName: string): string {
  const mode = SCRIPT_PARSE_MODE_LABELS[normalizeScriptParseMode(project.scriptParseMode)]
  return [styleName, mode, project.aspectRatio].filter(Boolean).join(' · ')
}

function resolveOwner(project: Project): string {
  if (!project.access || project.access.isOwner) return ''
  return project.ownerDisplayName || project.ownerAccount || ''
}
</script>

<template>
  <div
    v-if="loading"
    :class="cn('flex items-center justify-center py-16', $props.class)"
  >
    <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
  </div>

  <div
    v-else-if="error"
    :class="cn('py-16 text-center text-sm text-destructive', $props.class)"
  >
    {{ error }}
  </div>

  <div
    v-else-if="projects.length === 0"
    :class="cn('flex flex-col items-center justify-center gap-3 rounded-xl bg-muted/20 py-16 text-center', $props.class)"
  >
    <Clapperboard class="h-10 w-10 text-muted-foreground/50" />
    <div>
      <p class="text-sm font-medium">
        {{ hasActiveFilters ? '没有符合条件的项目' : '还没有项目' }}
      </p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ hasActiveFilters ? '换个关键词或状态试试。' : '新建一个项目，把剧本变成视频。' }}
      </p>
    </div>
    <Button
      v-if="!hasActiveFilters"
      class="gap-2"
      @click="emit('open-create')"
    >
      <Plus class="h-4 w-4" />
      新建视频项目
    </Button>
  </div>

  <div
    v-else
    :class="cn('grid content-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]', $props.class)"
  >
    <article
      v-for="project in projects"
      :key="project.id"
      class="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-muted/25 transition-[background-color,box-shadow] hover:bg-muted/40 hover:shadow-[0_10px_30px_hsl(var(--foreground)/0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabindex="0"
      :aria-label="`打开项目 ${project.title}`"
      @click="emit('open-project', project)"
      @keydown.enter.self="emit('open-project', project)"
    >
      <!-- Cover -->
      <div class="relative aspect-video overflow-hidden bg-muted">
        <LazyImage
          v-if="project.coverImage"
          :image="project.coverImage"
          :alt="`${project.title} 封面`"
          class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          placeholder-class="bg-muted"
        />
        <div
          v-else
          class="flex h-full w-full items-center justify-center text-muted-foreground/40"
        >
          <Clapperboard class="h-8 w-8" />
        </div>
        <!-- Actions appear on hover/focus so the cover stays clean -->
        <div
          v-if="projectAccessCan(project.access, 'manage_members') || projectAccessCan(project.access, 'delete')"
          class="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg bg-background/90 p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          @click.stop
        >
          <IconActionButton
            v-if="projectAccessCan(project.access, 'manage_members')"
            label="管理项目成员"
            @click="emit('manage-members', project)"
          >
            <Users class="h-3.5 w-3.5" />
          </IconActionButton>
          <IconActionButton
            v-if="projectAccessCan(project.access, 'delete')"
            label="删除项目"
            destructive
            @click="emit('confirm-delete', project, $event)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </IconActionButton>
        </div>
      </div>

      <!-- Details -->
      <div class="flex flex-1 flex-col gap-2 p-3">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <h3
            class="min-w-0 max-w-full truncate text-sm font-semibold"
            :title="project.title"
          >
            {{ project.title }}
          </h3>
          <ProjectSyncBadges
            :project="project"
            @resolve-sync-conflict="emit('resolve-sync-conflict', $event)"
          />
        </div>

        <div class="space-y-1">
          <div
            class="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            :aria-valuenow="resolveProjectProgress(project).percent"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="resolveProjectProgress(project).label"
          >
            <div
              class="h-full rounded-full transition-[width]"
              :class="resolveProjectProgress(project).percent === 100 ? 'bg-success' : 'bg-primary'"
              :style="{ width: `${resolveProjectProgress(project).percent}%` }"
            />
          </div>
          <p class="text-xs tabular-nums text-muted-foreground">
            {{ resolveProjectProgress(project).label }}
          </p>
        </div>

        <div class="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span
            class="min-w-0 truncate"
            :title="resolveMeta(project, getStyleName(project.styleId))"
          >
            {{ resolveMeta(project, getStyleName(project.styleId)) }}
          </span>
          <span
            class="shrink-0"
            :title="`更新于 ${formatProjectDateTime(project.updatedAt)}`"
          >
            {{ formatProjectRelativeTime(project.updatedAt) }}
          </span>
        </div>
        <p
          v-if="resolveOwner(project)"
          class="truncate text-xs text-muted-foreground"
        >
          创建：{{ resolveOwner(project) }}
        </p>
      </div>
    </article>
  </div>
</template>
