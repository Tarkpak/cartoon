<script setup lang="ts">
import { useProjectSyncConflict } from '~/composables/useProjectSyncConflict'
import { Download, Loader2 } from 'lucide-vue-next'
import { projectAccessCan } from '#shared/types/project'
import { formatProjectDateTime, type Project } from '~/lib/projects-page'
import { getDisplayErrorMessage } from '~/lib/asset-workbench-values'

const props = defineProps<{ open: boolean, project: Project | null }>()
const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'resolved'): void
}>()
const { backup, loading, resolving, error, prepare, resolve, reset } = useProjectSyncConflict()
const downloading = ref(false)
const { toast } = useToast()
const canExport = computed(() => !props.project?.access || projectAccessCan(props.project.access, 'export'))

watch(() => [props.open, props.project?.id] as const, ([open, id]) => {
  if (open && id) void prepare(id)
  else reset()
}, { immediate: true })

function setOpen(open: boolean) {
  if (!resolving.value) emit('update:open', open)
}

async function downloadBackup() {
  if (!props.project || !backup.value || downloading.value) return
  downloading.value = true
  try {
    const data = await $fetch(`/api/project/${encodeURIComponent(props.project.id)}/sync-conflict/backup/${backup.value.backupId}`)
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `项目冲突备份-${backup.value.backupId}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) {
    error.value = getDisplayErrorMessage(cause, '下载备份失败')
  } finally {
    downloading.value = false
  }
}

async function handleResolve(strategy: 'local' | 'remote') {
  if (!props.project) return
  if (await resolve(props.project.id, strategy)) {
    toast.success(strategy === 'local' ? '本地版本已同步到云端' : '已使用云端版本', { description: '处理前的两份项目快照已保留在客户端备份中。' })
    emit('resolved')
    emit('update:open', false)
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="setOpen">
    <DialogContent class="sm:max-w-[560px]" @interact-outside="resolving && $event.preventDefault()" @escape-key-down="resolving && $event.preventDefault()">
      <DialogHeader>
        <DialogTitle>处理同步冲突</DialogTitle>
        <DialogDescription>项目「{{ project?.title }}」的本地和云端版本不同，请核对后选择保留的版本。</DialogDescription>
      </DialogHeader>

      <div v-if="loading" class="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 class="h-4 w-4 animate-spin" />正在读取云端版本并备份…
      </div>
      <template v-else-if="backup">
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-lg border p-3">
            <p class="text-sm font-medium">本地版本</p>
            <p class="mt-2 text-xs text-muted-foreground">{{ formatProjectDateTime(backup.localUpdatedAt) }}</p>
            <p class="mt-1 text-sm">{{ backup.localSceneCount }} 个分镜</p>
          </div>
          <div class="rounded-lg border p-3">
            <p class="text-sm font-medium">云端版本</p>
            <p class="mt-2 text-xs text-muted-foreground">{{ formatProjectDateTime(backup.remoteUpdatedAt) }}</p>
            <p class="mt-1 text-sm">{{ backup.remoteSceneCount }} 个分镜</p>
          </div>
        </div>
        <div class="space-y-2 text-sm text-muted-foreground">
          <p>两份项目快照已自动备份。备份包含剧本、资产信息及媒体地址，媒体文件仍使用原地址。</p>
          <Button v-if="canExport" size="sm" variant="outline" :disabled="downloading || !!resolving" @click="downloadBackup">
            <Loader2 v-if="downloading" class="mr-2 h-4 w-4 animate-spin" />
            <Download v-else class="mr-2 h-4 w-4" />下载两份备份
          </Button>
          <p>保留本地版本会更新云端；使用云端版本会替换本地内容。两边都有需要的修改时，请先下载备份核对，取消后手动合并。</p>
        </div>
      </template>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <DialogFooter class="flex-wrap gap-2">
        <Button variant="outline" :disabled="!!resolving" @click="setOpen(false)">取消</Button>
        <Button v-if="error" variant="outline" :disabled="loading || !!resolving" @click="project && prepare(project.id)">重新核对</Button>
        <Button variant="outline" :disabled="!backup || loading || !!resolving" @click="handleResolve('remote')">
          <Loader2 v-if="resolving === 'remote'" class="mr-2 h-4 w-4 animate-spin" />使用云端版本
        </Button>
        <Button :disabled="!backup || loading || !!resolving" @click="handleResolve('local')">
          <Loader2 v-if="resolving === 'local'" class="mr-2 h-4 w-4 animate-spin" />保留本地并同步
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
