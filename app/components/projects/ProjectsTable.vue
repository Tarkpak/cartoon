<script setup lang="ts">
import { Clapperboard, Loader2, Trash2, Users } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import { projectAccessCan } from '#shared/types/project'
import {
  formatProjectDateTime,
  formatProjectRelativeTime,
  resolveProjectProgress,
  type Project
} from '~/lib/projects-page'
import {
  SCRIPT_PARSE_MODE_LABELS,
  normalizeScriptParseMode,
  type ScriptParseMode
} from '#shared/types/script'
import ProjectSyncBadges from './ProjectSyncBadges.vue'

const props = defineProps<{
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

function resolveScriptParseModeLabel(mode?: ScriptParseMode): string {
  return SCRIPT_PARSE_MODE_LABELS[normalizeScriptParseMode(mode)]
}

function resolveOwner(project: Project): string {
  if (!project.access || project.access.isOwner) return ''
  return project.ownerDisplayName || project.ownerAccount || ''
}

// Only show the owner column when some project belongs to someone else.
const showOwnerColumn = computed(() => props.projects.some(project => !!resolveOwner(project)))
const columnCount = computed(() => (showOwnerColumn.value ? 8 : 7))
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
    v-else
    :class="cn('overflow-hidden rounded-xl bg-muted/15', $props.class)"
  >
    <Table
      class="min-w-[880px] table-fixed"
      container-class="h-full"
    >
      <TableHeader>
        <TableRow>
          <TableHead class="whitespace-nowrap">
            项目名称
          </TableHead>
          <TableHead class="w-[140px] whitespace-nowrap">
            画风
          </TableHead>
          <TableHead
            v-if="showOwnerColumn"
            class="w-[110px] whitespace-nowrap"
          >
            创建成员
          </TableHead>
          <TableHead class="w-[90px] whitespace-nowrap">
            剧本类型
          </TableHead>
          <TableHead class="w-[64px] whitespace-nowrap">
            比例
          </TableHead>
          <TableHead class="w-[170px] whitespace-nowrap">
            出片进度
          </TableHead>
          <TableHead class="w-[96px] whitespace-nowrap">
            更新
          </TableHead>
          <TableHead class="w-[84px] whitespace-nowrap text-right">
            <span class="sr-only">操作</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="project in projects"
          :key="project.id"
          class="group cursor-pointer hover:bg-muted/50"
          tabindex="0"
          @click="emit('open-project', project)"
          @keydown.enter.self="emit('open-project', project)"
        >
          <TableCell>
            <div class="flex min-w-0 items-center gap-3">
              <div class="flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                <LazyImage
                  v-if="project.coverImage"
                  :image="project.coverImage"
                  :alt="`${project.title} 封面`"
                  class="h-full w-full object-cover"
                  placeholder-class="bg-muted"
                />
                <Clapperboard
                  v-else
                  class="h-4 w-4 text-muted-foreground/50"
                />
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                  class="min-w-0 max-w-full truncate font-medium"
                  :title="project.title"
                >{{ project.title }}</span>
                <ProjectSyncBadges
                  :project="project"
                  @resolve-sync-conflict="emit('resolve-sync-conflict', $event)"
                />
              </div>
            </div>
          </TableCell>
          <TableCell
            class="truncate text-sm text-muted-foreground"
            :title="getStyleName(project.styleId)"
          >
            {{ getStyleName(project.styleId) }}
          </TableCell>
          <TableCell
            v-if="showOwnerColumn"
            class="truncate text-sm text-muted-foreground"
            :title="resolveOwner(project) || '我'"
          >
            {{ resolveOwner(project) || '我' }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-sm text-muted-foreground">
            {{ resolveScriptParseModeLabel(project.scriptParseMode) }}
          </TableCell>
          <TableCell class="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {{ project.aspectRatio }}
          </TableCell>
          <TableCell>
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
                  class="h-full rounded-full"
                  :class="resolveProjectProgress(project).percent === 100 ? 'bg-success' : 'bg-primary'"
                  :style="{ width: `${resolveProjectProgress(project).percent}%` }"
                />
              </div>
              <p class="text-xs tabular-nums text-muted-foreground">
                {{ resolveProjectProgress(project).label }}
              </p>
            </div>
          </TableCell>
          <TableCell
            class="whitespace-nowrap text-sm text-muted-foreground"
            :title="`更新于 ${formatProjectDateTime(project.updatedAt)}`"
          >
            {{ formatProjectRelativeTime(project.updatedAt) }}
          </TableCell>
          <TableCell
            class="text-right"
            @click.stop
          >
            <div class="inline-flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
          </TableCell>
        </TableRow>

        <TableRow v-if="projects.length === 0">
          <TableCell
            :colspan="columnCount"
            class="h-40 text-center"
          >
            <div class="flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <Clapperboard class="h-8 w-8 opacity-50" />
              <p class="text-sm">
                {{ hasActiveFilters ? '没有符合条件的项目' : '还没有项目' }}
              </p>
              <Button
                v-if="!hasActiveFilters"
                variant="link"
                @click="emit('open-create')"
              >
                新建视频项目
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
