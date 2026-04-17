<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import type { ProjectSortBy, ProjectStatusFilter } from '~/lib/projects-page'

const props = defineProps<{
  searchKeyword: string
  statusFilter: ProjectStatusFilter
  sortBy: ProjectSortBy
  projectsCount: number
  totalProjects: number
}>()

const emit = defineEmits<{
  (event: 'update:searchKeyword', value: string): void
  (event: 'update:statusFilter', value: ProjectStatusFilter): void
  (event: 'update:sortBy', value: ProjectSortBy): void
}>()

const searchKeywordModel = computed({
  get: () => props.searchKeyword,
  set: (value: string) => emit('update:searchKeyword', value)
})

const statusFilterModel = computed({
  get: () => props.statusFilter,
  set: (value: ProjectStatusFilter) => emit('update:statusFilter', value)
})

const sortByModel = computed({
  get: () => props.sortBy,
  set: (value: ProjectSortBy) => emit('update:sortBy', value)
})
</script>

<template>
  <Card class="mb-6">
    <CardContent class="pt-6">
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(280px,1fr)_160px_160px_auto] lg:items-center">
        <div class="relative">
          <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            v-model="searchKeywordModel"
            class="pl-10"
            placeholder="搜索项目..."
          />
        </div>
        <Select v-model="statusFilterModel">
          <SelectTrigger class="h-10 w-full">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              全部状态
            </SelectItem>
            <SelectItem value="in_progress">
              进行中
            </SelectItem>
            <SelectItem value="completed">
              已完成
            </SelectItem>
            <SelectItem value="draft">
              草稿
            </SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="sortByModel">
          <SelectTrigger class="h-10 w-full">
            <SelectValue placeholder="最近更新" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">
              最近更新
            </SelectItem>
            <SelectItem value="created">
              创建时间
            </SelectItem>
            <SelectItem value="name">
              名称排序
            </SelectItem>
          </SelectContent>
        </Select>
        <div class="text-xs text-muted-foreground lg:text-right">
          当前页 {{ projectsCount }} 条 · 共 {{ totalProjects }} 条
        </div>
      </div>
    </CardContent>
  </Card>
</template>
