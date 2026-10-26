<script setup lang="ts">
defineProps<{
  currentPage: number
  totalPages: number
  totalProjects: number
  pageSize: number
  pageSizeOptions: number[]
  loading: boolean
}>()

const emit = defineEmits<{
  (event: 'page-change', page: number): void
  (event: 'page-size-change', value: string): void
}>()
</script>

<template>
  <!-- One page needs no pagination; the count lives in the header. -->
  <div
    v-if="totalPages > 1"
    class="flex flex-col gap-3 pt-3 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="text-xs tabular-nums text-muted-foreground">
      第 {{ currentPage }} / {{ totalPages }} 页
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
              {{ size }} 个
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
</template>
