<script setup lang="ts">
import { LayoutGrid, List, Search } from 'lucide-vue-next'
import type { ProjectSortBy, ProjectStatusFilter, ProjectViewMode } from '~/lib/projects-page'

const props = defineProps<{
  searchKeyword: string
  statusFilter: ProjectStatusFilter
  sortBy: ProjectSortBy
  viewMode: ProjectViewMode
}>()

const emit = defineEmits<{
  (event: 'update:searchKeyword', value: string): void
  (event: 'update:statusFilter', value: ProjectStatusFilter): void
  (event: 'update:sortBy', value: ProjectSortBy): void
  (event: 'update:viewMode', value: ProjectViewMode): void
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
  <div class="flex flex-wrap items-center gap-2">
    <div class="relative w-full sm:w-72">
      <Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="projects-search"
        v-model="searchKeywordModel"
        class="h-9 pl-9"
        placeholder="搜索项目名称"
        aria-label="搜索项目"
      />
    </div>
    <Select v-model="statusFilterModel">
      <SelectTrigger
        class="h-9 w-32"
        aria-label="按状态筛选"
      >
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
      <SelectTrigger
        class="h-9 w-32"
        aria-label="排序方式"
      >
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
    <div
      class="ml-auto hidden items-center gap-0.5 rounded-lg bg-muted/40 p-0.5 lg:flex"
      role="group"
      aria-label="显示方式"
    >
      <IconActionButton
        label="卡片视图"
        :active="viewMode === 'grid'"
        @click="emit('update:viewMode', 'grid')"
      >
        <LayoutGrid class="h-3.5 w-3.5" />
      </IconActionButton>
      <IconActionButton
        label="列表视图"
        :active="viewMode === 'list'"
        @click="emit('update:viewMode', 'list')"
      >
        <List class="h-3.5 w-3.5" />
      </IconActionButton>
    </div>
  </div>
</template>
