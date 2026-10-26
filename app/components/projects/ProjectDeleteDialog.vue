<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import ConfirmBody from '@/components/ui/confirm/ConfirmBody.vue'
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
    <DialogContent
      class="max-w-sm gap-5 p-5"
      hide-close
    >
      <ConfirmBody
        title="删除项目"
        variant="destructive"
      >
        <template v-if="projectToDelete?.collaboration">
          确定删除「{{ projectToDelete.title }}」吗？删除后所有成员都无法再访问这个项目。云端会保留迁移备份，但这里无法恢复。
        </template>
        <template v-else>
          确定删除「{{ projectToDelete?.title }}」吗？项目里的场景、素材和视频会被永久删除，无法恢复。
        </template>
      </ConfirmBody>
      <DialogFooter class="pt-0">
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
          删除项目
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
