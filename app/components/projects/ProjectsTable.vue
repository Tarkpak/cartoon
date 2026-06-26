<script setup lang="ts">
import { Loader2, Trash2, Video } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import {
  formatProjectDateTime,
  formatProjectRelativeTime,
  type Project
} from '~/lib/projects-page'
import {
  SCRIPT_PARSE_MODE_LABELS,
  normalizeScriptParseMode,
  type ScriptParseMode
} from '#shared/types/script'

defineProps<{
  class?: string
  projects: Project[]
  loading: boolean
  error: string | null
  currentPage: number
  totalPages: number
  totalProjects: number
  pageSize: number
  pageSizeOptions: number[]
  hasActiveFilters: boolean
  statusMap: Record<string, { label: string, variant: 'default' | 'secondary' | 'success' | 'warning' }>
  getStyleName: (styleId: string) => string
}>()

const emit = defineEmits<{
  (event: 'open-create'): void
  (event: 'open-project', project: Project): void
  (event: 'confirm-delete', project: Project, domEvent: Event): void
  (event: 'page-change', page: number): void
  (event: 'page-size-change', value: string): void
}>()

function resolveScriptParseModeLabel(mode?: ScriptParseMode): string {
  const normalizedMode = normalizeScriptParseMode(mode)
  return SCRIPT_PARSE_MODE_LABELS[normalizedMode]
}
</script>

<template>
  <div
    v-if="loading"
    :class="cn('flex items-center justify-center py-12', $props.class)"
  >
    <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
  </div>

  <div
    v-else-if="error"
    :class="cn('py-12 text-center text-destructive', $props.class)"
  >
    {{ error }}
  </div>

  <Card
    v-else
    :class="cn('flex flex-col overflow-hidden', $props.class)"
  >
    <div class="min-h-0 flex-1 overflow-y-auto p-3 lg:hidden">
      <div
        v-if="projects.length > 0"
        class="grid gap-3"
      >
        <article
          v-for="project in projects"
          :key="project.id"
          class="rounded-md border border-border/70 bg-background/70 p-4 transition-colors hover:bg-accent/35"
          @click="emit('open-project', project)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="line-clamp-2 text-base font-semibold leading-6 text-foreground">
                {{ project.title }}
              </h3>
              <p class="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {{ project.description || '暂无描述' }}
              </p>
            </div>
            <Badge
              class="shrink-0"
              :variant="statusMap[project.status || 'draft']?.variant || 'secondary'"
            >
              {{ statusMap[project.status || 'draft']?.label || '草稿' }}
            </Badge>
          </div>

          <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p class="text-xs text-muted-foreground">
                画风
              </p>
              <p class="mt-1 font-medium text-foreground">
                {{ getStyleName(project.styleId) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">
                场景数
              </p>
              <div class="mt-1 flex items-center gap-1 font-medium text-foreground">
                <Video class="h-3.5 w-3.5 text-muted-foreground" />
                <span>{{ project.totalScenes }}</span>
              </div>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">
                剧本类型
              </p>
              <Badge
                variant="outline"
                class="mt-1"
              >
                {{ resolveScriptParseModeLabel(project.scriptParseMode) }}
              </Badge>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">
                比例
              </p>
              <Badge
                variant="outline"
                class="mt-1"
              >
                {{ project.aspectRatio }}
              </Badge>
            </div>
          </div>

          <div class="mt-4 grid gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <span class="text-foreground">{{ formatProjectRelativeTime(project.createdAt) }}</span>
              <span class="ml-1">创建</span>
              <p class="mt-0.5">
                {{ formatProjectDateTime(project.createdAt) }}
              </p>
            </div>
            <div>
              <span class="text-foreground">{{ formatProjectRelativeTime(project.updatedAt) }}</span>
              <span class="ml-1">更新</span>
              <p class="mt-0.5">
                {{ formatProjectDateTime(project.updatedAt) }}
              </p>
            </div>
          </div>

          <div class="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="删除项目"
              aria-label="删除项目"
              @click.stop="emit('confirm-delete', project, $event)"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </article>
      </div>

      <div
        v-else
        class="flex min-h-64 flex-col items-center justify-center text-muted-foreground"
      >
        <Video class="mb-2 h-10 w-10 opacity-50" />
        <p>{{ hasActiveFilters ? '没有匹配结果' : '暂无项目' }}</p>
        <Button
          v-if="!hasActiveFilters"
          variant="link"
          class="mt-2"
          @click="emit('open-create')"
        >
          创建第一个项目
        </Button>
      </div>
    </div>

    <Table
      class="min-w-[1430px]"
      container-class="hidden min-h-0 flex-1 lg:block"
    >
      <TableHeader>
        <TableRow>
          <TableHead class="w-[250px] whitespace-nowrap">
            项目名称
          </TableHead>
          <TableHead class="whitespace-nowrap">
            描述
          </TableHead>
          <TableHead class="w-[100px] whitespace-nowrap">
            画风
          </TableHead>
          <TableHead class="w-[96px] whitespace-nowrap">
            剧本类型
          </TableHead>
          <TableHead class="w-[80px] whitespace-nowrap">
            比例
          </TableHead>
          <TableHead class="w-[80px] whitespace-nowrap">
            场景数
          </TableHead>
          <TableHead class="w-[80px] whitespace-nowrap">
            状态
          </TableHead>
          <TableHead class="w-[180px] whitespace-nowrap">
            创建时间
          </TableHead>
          <TableHead class="w-[180px] whitespace-nowrap">
            更新时间
          </TableHead>
          <TableHead class="sticky right-0 top-0 z-30 w-[72px] whitespace-nowrap bg-background text-center shadow-none [[data-has-horizontal-overflow=true]_&]:shadow-[-16px_0_24px_-18px_hsl(var(--foreground)/0.75)]">
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="project in projects"
          :key="project.id"
          class="group cursor-pointer hover:bg-muted/50"
          @click="emit('open-project', project)"
        >
          <TableCell class="font-medium">
            {{ project.title }}
          </TableCell>
          <TableCell class="max-w-[300px] truncate text-muted-foreground">
            {{ project.description || '暂无描述' }}
          </TableCell>
          <TableCell class="whitespace-nowrap">
            <span class="text-sm">{{ getStyleName(project.styleId) }}</span>
          </TableCell>
          <TableCell class="whitespace-nowrap">
            <Badge variant="outline">
              {{ resolveScriptParseModeLabel(project.scriptParseMode) }}
            </Badge>
          </TableCell>
          <TableCell class="whitespace-nowrap">
            <Badge variant="outline">
              {{ project.aspectRatio }}
            </Badge>
          </TableCell>
          <TableCell class="whitespace-nowrap">
            <div class="flex items-center gap-1">
              <Video class="h-3.5 w-3.5 text-muted-foreground" />
              <span>{{ project.totalScenes }}</span>
            </div>
          </TableCell>
          <TableCell class="whitespace-nowrap">
            <Badge :variant="statusMap[project.status || 'draft']?.variant || 'secondary'">
              {{ statusMap[project.status || 'draft']?.label || '草稿' }}
            </Badge>
          </TableCell>
          <TableCell class="whitespace-nowrap text-sm">
            <div class="flex flex-col">
              <span>{{ formatProjectRelativeTime(project.createdAt) }}</span>
              <span class="text-xs text-muted-foreground">
                {{ formatProjectDateTime(project.createdAt) }}
              </span>
            </div>
          </TableCell>
          <TableCell class="whitespace-nowrap text-sm">
            <div class="flex flex-col">
              <span>{{ formatProjectRelativeTime(project.updatedAt) }}</span>
              <span class="text-xs text-muted-foreground">
                {{ formatProjectDateTime(project.updatedAt) }}
              </span>
            </div>
          </TableCell>
          <TableCell class="sticky right-0 z-20 w-[72px] whitespace-nowrap bg-background text-center shadow-none [[data-has-horizontal-overflow=true]_&]:shadow-[-16px_0_24px_-18px_hsl(var(--foreground)/0.75)]">
            <div class="inline-flex items-center justify-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground hover:text-destructive"
                title="删除项目"
                aria-label="删除项目"
                @click="emit('confirm-delete', project, $event)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </TableCell>
        </TableRow>

        <TableRow v-if="projects.length === 0">
          <TableCell
            :colspan="10"
            class="h-32 text-center"
          >
            <div class="flex flex-col items-center justify-center text-muted-foreground">
              <Video class="mb-2 h-10 w-10 opacity-50" />
              <p>{{ hasActiveFilters ? '没有匹配结果' : '暂无项目' }}</p>
              <Button
                v-if="!hasActiveFilters"
                variant="link"
                class="mt-2"
                @click="emit('open-create')"
              >
                创建第一个项目
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <div class="shrink-0 flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="text-xs text-muted-foreground">
        第 {{ currentPage }} / {{ totalPages }} 页，共 {{ totalProjects }} 条
      </div>
      <div class="flex items-center gap-2 self-end sm:self-auto">
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          <span>每页</span>
          <Select
            :model-value="String(pageSize)"
            @update:model-value="emit('page-size-change', String($event))"
          >
            <SelectTrigger class="h-8 w-[88px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="size in pageSizeOptions"
                :key="size"
                :value="String(size)"
              >
                {{ size }} 条
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="h-8 px-2.5 text-xs"
          :disabled="loading || currentPage <= 1"
          @click="emit('page-change', currentPage - 1)"
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="h-8 px-2.5 text-xs"
          :disabled="loading || currentPage >= totalPages"
          @click="emit('page-change', currentPage + 1)"
        >
          下一页
        </Button>
      </div>
    </div>
  </Card>
</template>
