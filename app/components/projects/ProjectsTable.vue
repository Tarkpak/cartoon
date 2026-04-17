<script setup lang="ts">
import { Loader2, Trash2, Video } from 'lucide-vue-next'
import {
  formatProjectDateTime,
  formatProjectRelativeTime,
  type Project
} from '~/lib/projects-page'

defineProps<{
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
</script>

<template>
  <div
    v-if="loading"
    class="flex items-center justify-center py-12"
  >
    <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
  </div>

  <div
    v-else-if="error"
    class="py-12 text-center text-destructive"
  >
    {{ error }}
  </div>

  <Card v-else>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[250px]">
            项目名称
          </TableHead>
          <TableHead>描述</TableHead>
          <TableHead class="w-[100px]">
            画风
          </TableHead>
          <TableHead class="w-[80px]">
            比例
          </TableHead>
          <TableHead class="w-[80px]">
            场景数
          </TableHead>
          <TableHead class="w-[80px]">
            状态
          </TableHead>
          <TableHead class="w-[180px]">
            更新时间
          </TableHead>
          <TableHead class="w-[140px] text-right">
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
          <TableCell>
            <span class="text-sm">{{ getStyleName(project.styleId) }}</span>
          </TableCell>
          <TableCell>
            <Badge variant="outline">
              {{ project.aspectRatio }}
            </Badge>
          </TableCell>
          <TableCell>
            <div class="flex items-center gap-1">
              <Video class="h-3.5 w-3.5 text-muted-foreground" />
              <span>{{ project.totalScenes }}</span>
            </div>
          </TableCell>
          <TableCell>
            <Badge :variant="statusMap[project.status || 'draft']?.variant || 'secondary'">
              {{ statusMap[project.status || 'draft']?.label || '草稿' }}
            </Badge>
          </TableCell>
          <TableCell class="text-sm">
            <div class="flex flex-col">
              <span>{{ formatProjectRelativeTime(project.updatedAt) }}</span>
              <span class="text-xs text-muted-foreground">
                {{ formatProjectDateTime(project.updatedAt) }}
              </span>
            </div>
          </TableCell>
          <TableCell class="text-right">
            <div class="inline-flex items-center gap-1">
              <Button
                size="sm"
                class="h-8 px-3 text-xs"
                @click.stop="emit('open-project', project)"
              >
                进入
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 text-muted-foreground opacity-100 transition-opacity hover:text-destructive focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                title="删除项目"
                @click="emit('confirm-delete', project, $event)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </TableCell>
        </TableRow>

        <TableRow v-if="projects.length === 0">
          <TableCell
            :colspan="8"
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

    <div class="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
