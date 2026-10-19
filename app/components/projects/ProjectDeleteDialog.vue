<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import type { Project } from '~/lib/projects-page'

defineProps<{
  open: boolean
  projectToDelete: Project | null
  deleting: boolean
}>()

defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'delete'): void
}>()
</script>

<template>
  <Dialog
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogContent class="sm:max-w-[400px]">
      <DialogHeader>
        <DialogTitle>确认删除</DialogTitle>
        <DialogDescription>
          <template v-if="projectToDelete?.collaboration">确定要删除项目「{{ projectToDelete.title }}」吗？删除后，所有成员将无法继续访问此项目。云端保留迁移备份，当前页面不提供恢复操作。</template>
          <template v-else>确定要删除项目「{{ projectToDelete?.title }}」吗？此操作不可撤销，所有相关数据将被永久删除。</template>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          @click="$emit('update:open', false)"
        >
          取消
        </Button>
        <Button
          variant="destructive"
          :disabled="deleting"
          @click="$emit('delete')"
        >
          <Loader2
            v-if="deleting"
            class="mr-2 h-4 w-4 animate-spin"
          />
          确认删除
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
